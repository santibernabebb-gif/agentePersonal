/**
 * Cloudflare Pages Function: /api/*
 *
 * App -> /api/auth -> sesión firmada
 * App -> /api/chat|health|skills|remind -> proxy seguro al VPS
 *
 * Variables en Cloudflare Pages:
 *   OC_USER            usuario de la app
 *   OC_PASS            contraseña de la app
 *   OC_AGENT_SECRET    secret Bearer para hablar con agent-api del VPS
 *   OC_API_URL         URL del backend VPS. Ej: https://agent.santisystems.es o http://TU_IP:3000 para prueba
 *   OC_SESSION_SECRET  opcional. Si no existe, usa OC_AGENT_SECRET para firmar sesiones
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Session-Token',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const ALLOWED_PROXY = new Set(['/health', '/chat', '/skills', '/remind']);

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';

  if (path === '/auth' && request.method === 'POST') {
    return handleAuth(request, env);
  }

  if (!ALLOWED_PROXY.has(path)) {
    return json({ ok: false, error: 'Ruta no permitida' }, 404);
  }

  const sessionToken = request.headers.get('X-Session-Token') || '';
  const valid = await isValidSession(sessionToken, env);
  if (!valid) {
    return json({ ok: false, error: 'Sesión no válida' }, 401);
  }

  return proxyToVPS(path, request, env);
}

async function handleAuth(request, env) {
  try {
    const { user, pass } = await request.json();

    if (!env.OC_USER || !env.OC_PASS || !env.OC_AGENT_SECRET) {
      return json({ ok: false, error: 'Faltan variables OC_USER, OC_PASS u OC_AGENT_SECRET en Cloudflare.' }, 500);
    }

    const okUser = timingSafeEqual(String(user || ''), String(env.OC_USER));
    const okPass = timingSafeEqual(String(pass || ''), String(env.OC_PASS));

    if (!okUser || !okPass) {
      await sleep(900);
      return json({ ok: false, error: 'Credenciales incorrectas' }, 401);
    }

    const exp = Date.now() + 24 * 60 * 60 * 1000;
    const nonce = cryptoRandomString(16);
    const payload = `${env.OC_USER}.${exp}.${nonce}`;
    const sig = await sign(payload, sessionSecret(env));
    return json({ ok: true, session: `${payload}.${sig}`, expiresAt: exp });
  } catch (err) {
    return json({ ok: false, error: 'Error en autenticación', detail: err.message }, 500);
  }
}

async function isValidSession(token, env) {
  if (!token || !env.OC_USER) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const [user, expRaw, nonce, sig] = parts;
  const exp = Number(expRaw);
  if (user !== env.OC_USER || !Number.isFinite(exp) || Date.now() > exp) return false;
  const payload = `${user}.${expRaw}.${nonce}`;
  const expected = await sign(payload, sessionSecret(env));
  return timingSafeEqual(sig, expected);
}

async function proxyToVPS(path, request, env) {
  if (!env.OC_API_URL || !env.OC_AGENT_SECRET) {
    return json({ ok: false, error: 'Backend no configurado. Añade OC_API_URL y OC_AGENT_SECRET en Cloudflare.' }, 500);
  }

  const targetUrl = `${String(env.OC_API_URL).replace(/\/$/, '')}${path}`;

  try {
    const init = {
      method: request.method,
      headers: {
        'Authorization': `Bearer ${env.OC_AGENT_SECRET}`,
        'Content-Type': 'application/json'
      }
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.text();
    }

    const res = await fetch(targetUrl, init);
    const text = await res.text();
    return new Response(text || '{}', {
      status: res.status,
      headers: CORS
    });
  } catch (err) {
    return json({ ok: false, error: 'No se pudo contactar con el VPS', detail: err.message }, 502);
  }
}

function sessionSecret(env) {
  return env.OC_SESSION_SECRET || env.OC_AGENT_SECRET || 'missing-secret';
}

async function sign(payload, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return base64url(sig);
}

function base64url(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cryptoRandomString(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
