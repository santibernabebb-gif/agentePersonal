// Cloudflare Pages Function
// Ruta: /functions/auth.js
// Variables de entorno que debes crear en Cloudflare Pages:
//   OC_USER → tu nombre de usuario
//   OC_PASS → tu contraseña

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await request.json();
    const { user, pass } = body;

    // Verificar que las variables de entorno están configuradas
    if (!env.OC_USER || !env.OC_PASS) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Variables de entorno no configuradas'
      }), { status: 500, headers });
    }

    // Comparar credenciales
    const userOk = user === env.OC_USER;
    const passOk = pass === env.OC_PASS;

    if (userOk && passOk) {
      // Generar token de sesión simple
      const sessionToken = btoa(`${user}:${Date.now()}:${Math.random()}`);
      return new Response(JSON.stringify({
        ok: true,
        session: sessionToken
      }), { status: 200, headers });
    } else {
      // Espera 1 segundo para evitar fuerza bruta
      await new Promise(r => setTimeout(r, 1000));
      return new Response(JSON.stringify({
        ok: false,
        error: 'Credenciales incorrectas'
      }), { status: 401, headers });
    }

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Error en el servidor'
    }), { status: 500, headers });
  }
}

// Manejar preflight CORS
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
