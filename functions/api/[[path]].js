/**
 * functions/api/[[path]].js
 * Cloudflare Pages Function — proxy seguro entre PWA y VPS
 *
 * Variables de entorno en Cloudflare Pages:
 *   OC_USER          → usuario de la app
 *   OC_PASS          → contraseña de la app
 *   OC_AGENT_SECRET  → Bearer token para hablar con agent-api en el VPS
 *   OC_API_URL       → URL pública del agent-api (ej: https://tu-ip-o-dominio:3000)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json'
};

export async function onRequest(context) {
  const { request, env } = context;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '') || '/';

  // =====================
  // RUTA: /api/auth — Login usuario/contraseña
  // =====================
  if (path === '/auth' && request.method === 'POST') {
    return handleAuth(request, env);
  }

  // =====================
  // RUTAS PROTEGIDAS — requieren session token
  // =====================
  const sessionToken = request.headers.get('X-Session-Token') || '';
  if (!isValidSession(sessionToken, env)) {
    return json({ ok: false, error: 'Sesión no válida' }, 401);
  }

  // Proxy al VPS
  return proxyToVPS(path, request, env);
}

// =====================
// AUTH
// =====================
async function handleAuth(request, env) {
  try {
    const { user, pass } = await request.json();

    if (!env.OC_USER || !env.OC_PASS) {
      return json({ ok: false, error: 'Variables de entorno no configuradas' }, 500);
    }

    if (user === env.OC_USER && pass === env.OC_PASS) {
      // Generar session token simple
      const session = btoa(`${user}:${Date.now()}:${Math.random().toString(36)}`);
      return json({ ok: true, session });
    }

    // Delay anti fuerza bruta
    await new Promise(r => setTimeout(r, 1000));
    return json({ ok: false, error: 'Credenciales incorrectas' }, 401);

  } catch {
    return json({ ok: false, error: 'Error en autenticación' }, 500);
  }
}

// =====================
// SESSION CHECK (simple, stateless)
// =====================
function isValidSession(token, env) {
  if (!token) return false;
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    // Verificar que el usuario es correcto y el token no es muy viejo (24h)
    const user = parts[0];
    const ts = parseInt(parts[1]);
    const age = Date.now() - ts;
    return user === env.OC_USER && age < 86400000; // 24 horas
  } catch {
    return false;
  }
}

// =====================
// PROXY AL VPS
// =====================
async function proxyToVPS(path, request, env) {
  if (!env.OC_API_URL || !env.OC_AGENT_SECRET) {
    return json({ ok: false, error: 'Backend no configurado. Añade OC_API_URL y OC_AGENT_SECRET en Cloudflare.' }, 500);
  }

  const targetUrl = `${env.OC_API_URL.replace(/\/$/, '')}${path}`;

  try {
    const init = {
      method: request.method,
      headers: {
        'Authorization': `Bearer ${env.OC_AGENT_SECRET}`,
        'Content-Type': 'application/json'
      }
    };

    if (request.method === 'POST') {
      init.body = await request.text();
    }

    const res = await fetch(targetUrl, init);
    const data = await res.text();

    return new Response(data, {
      status: res.status,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return json({ ok: false, error: 'No se pudo contactar con el VPS', detail: err.message }, 502);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
