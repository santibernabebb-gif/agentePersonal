/**
 * agent-api.js
 * Backend puente entre la PWA y OpenClaw/scripts del VPS
 * Ejecutar en el VPS: node agent-api.js
 * Puerto: 3000 (configurable con PORT=xxxx)
 *
 * Variables de entorno requeridas:
 *   AGENT_APP_SECRET  → token secreto que usa la PWA para autenticarse
 *   OPENCLAW_WS_URL   → WebSocket de OpenClaw (default: ws://127.0.0.1:18789)
 *   PORT              → puerto del servidor (default: 3000)
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const AGENT_SECRET = process.env.AGENT_APP_SECRET || '';
const OPENCLAW_WS = process.env.OPENCLAW_WS_URL || 'ws://127.0.0.1:18789';

if (!AGENT_SECRET) {
  console.error('ERROR: AGENT_APP_SECRET no está definido. Saliendo.');
  process.exit(1);
}

// =====================
// MIDDLEWARES
// =====================
app.use(express.json());
app.use(cors({
  origin: '*', // Cloudflare Pages Worker hace de proxy, así que aceptamos todo
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Auth middleware
function auth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.replace('Bearer ', '').trim();
  if (!token || token !== AGENT_SECRET) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  next();
}

// Logger simple
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// =====================
// HEALTH
// =====================
app.get('/health', auth, (req, res) => {
  res.json({
    ok: true,
    status: 'online',
    timestamp: new Date().toISOString(),
    openclaw_ws: OPENCLAW_WS
  });
});

// =====================
// CHAT → OpenClaw via WebSocket
// =====================
app.post('/chat', auth, async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'Mensaje vacío' });
  }

  try {
    const reply = await sendToOpenClaw(message.trim());
    res.json({ ok: true, response: reply });
  } catch (err) {
    console.error('Error conectando con OpenClaw:', err.message);
    res.status(502).json({ ok: false, error: 'No se pudo contactar con OpenClaw', detail: err.message });
  }
});

// =====================
// SKILLS → OpenClaw
// =====================
app.get('/skills', auth, async (req, res) => {
  try {
    const reply = await sendToOpenClaw('__list_skills__');
    // Intentar parsear si OpenClaw devuelve JSON de skills
    let skills = [];
    try { skills = JSON.parse(reply); } catch { skills = []; }
    res.json({ ok: true, skills });
  } catch (err) {
    // Si falla devolver lista vacía en lugar de error
    res.json({ ok: true, skills: [] });
  }
});

// =====================
// REMIND → Recordatorio
// =====================
app.post('/remind', auth, async (req, res) => {
  const { text, when } = req.body;
  if (!text) return res.status(400).json({ ok: false, error: 'Falta el texto del recordatorio' });

  try {
    const msg = when
      ? `Recuérdame ${when}: ${text}`
      : `Añade recordatorio: ${text}`;
    const reply = await sendToOpenClaw(msg);
    res.json({ ok: true, response: reply });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Error al crear recordatorio' });
  }
});

// =====================
// WebSocket helper → OpenClaw
// =====================
function sendToOpenClaw(message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout esperando respuesta de OpenClaw'));
      try { ws.close(); } catch {}
    }, 30000); // 30s timeout

    let ws;
    try {
      ws = new WebSocket(OPENCLAW_WS);
    } catch (e) {
      clearTimeout(timeout);
      return reject(new Error('No se pudo crear conexión WebSocket'));
    }

    let responseChunks = [];

    ws.on('open', () => {
      // Enviar mensaje en formato que OpenClaw espera
      ws.send(JSON.stringify({
        type: 'message',
        content: message,
        channel: 'api'
      }));
    });

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());

        // Detectar fin de respuesta
        if (parsed.type === 'done' || parsed.done === true) {
          clearTimeout(timeout);
          ws.close();
          resolve(responseChunks.join('') || parsed.content || 'OK');
          return;
        }

        // Acumular chunks de respuesta
        if (parsed.content) responseChunks.push(parsed.content);
        if (parsed.response) responseChunks.push(parsed.response);
        if (parsed.text) responseChunks.push(parsed.text);

        // Si es un mensaje completo directo
        if (parsed.type === 'response' && parsed.content) {
          clearTimeout(timeout);
          ws.close();
          resolve(parsed.content);
        }

      } catch {
        // Si no es JSON, acumular como texto plano
        responseChunks.push(data.toString());
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message}`));
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (responseChunks.length > 0) {
        resolve(responseChunks.join(''));
      }
    });
  });
}

// =====================
// START
// =====================
app.listen(PORT, '127.0.0.1', () => {
  console.log(`agent-api corriendo en http://127.0.0.1:${PORT}`);
  console.log(`OpenClaw WS: ${OPENCLAW_WS}`);
  console.log('Listo para recibir peticiones.');
});
