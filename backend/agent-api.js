/**
 * agent-api.js
 * Puente privado entre la PWA y el agente que ya vive en el VPS.
 *
 * Flujo previsto:
 *   App -> Cloudflare Pages Function -> agent-api en VPS -> OpenClaw/ChatGPT auth/skills
 *
 * Importante:
 * - Este proceso NO debe guardar credenciales de ChatGPT.
 * - El "cerebro" sigue siendo tu OpenClaw/ChatGPT autenticado en el VPS.
 * - Por defecto escucha solo en 127.0.0.1 para poner Nginx/Cloudflare Tunnel delante.
 *
 * Variables:
 *   AGENT_APP_SECRET   obligatorio. Debe coincidir con OC_AGENT_SECRET en Cloudflare.
 *   PORT               opcional. Default 3000.
 *   LISTEN_HOST        opcional. Default 127.0.0.1. Usa 0.0.0.0 solo para pruebas controladas.
 *   OPENCLAW_WS_URL    opcional. Default ws://127.0.0.1:18789.
 *   AGENT_COMMAND      opcional. Comando real que recibe el mensaje por stdin y devuelve respuesta por stdout.
 *                      Ejemplo: AGENT_COMMAND="/root/agent-queue/send-message.sh"
 *   TG_REMIND_CMD      opcional. Comando para recordatorios simples. Ejemplo: /usr/local/bin/tg-remind
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const LISTEN_HOST = process.env.LISTEN_HOST || '127.0.0.1';
const AGENT_SECRET = process.env.AGENT_APP_SECRET || '';
const OPENCLAW_WS = process.env.OPENCLAW_WS_URL || 'ws://127.0.0.1:18789';
const AGENT_COMMAND = process.env.AGENT_COMMAND || '';
const TG_REMIND_CMD = process.env.TG_REMIND_CMD || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

if (!AGENT_SECRET || AGENT_SECRET === 'PON_AQUI_TU_SECRET_MUY_LARGO') {
  console.error('ERROR: define AGENT_APP_SECRET con un valor largo y secreto.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cors({
  origin: ALLOWED_ORIGIN || false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || !timingSafeEqual(token, AGENT_SECRET)) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }
  next();
}

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', auth, async (_req, res) => {
  const ws = await probeOpenClaw(1200);
  res.json({
    ok: true,
    status: 'online',
    timestamp: new Date().toISOString(),
    listen_host: LISTEN_HOST,
    port: PORT,
    mode: AGENT_COMMAND ? 'command' : 'websocket',
    openclaw: ws
  });
});

app.post('/chat', auth, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'Mensaje vacío' });
  if (message.length > 12000) return res.status(413).json({ ok: false, error: 'Mensaje demasiado largo' });

  try {
    const response = await sendToAgent(message);
    res.json({ ok: true, response });
  } catch (err) {
    console.error('Error /chat:', err);
    res.status(502).json({
      ok: false,
      error: 'No se pudo contactar con el agente real del VPS',
      detail: err.message,
      hint: 'Si falla WebSocket, configura AGENT_COMMAND apuntando al mismo flujo que usa Telegram/OpenClaw.'
    });
  }
});

app.get('/skills', auth, async (_req, res) => {
  // No inventamos skills. Mientras no haya endpoint real, devolvemos lista vacía limpia.
  res.json({
    ok: true,
    skills: [],
    note: 'Skills no conectadas todavía. El chat sí debe ir por el agente real.'
  });
});

app.post('/remind', auth, async (req, res) => {
  const text = String(req.body?.text || req.body?.message || '').trim();
  const when = String(req.body?.when || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Falta el texto del recordatorio' });

  try {
    // Si tienes tg-remind y mandas segundos exactos, se puede usar directo.
    // Para lenguaje natural, se lo pasamos al cerebro para que decida.
    if (TG_REMIND_CMD && /^\d+$/.test(when)) {
      const out = await runCommand(TG_REMIND_CMD, [`${when}`, text], '', 15000);
      return res.json({ ok: true, response: out || 'Recordatorio enviado al comando.' });
    }

    const msg = when ? `Recuérdame ${when}: ${text}` : `Recuérdame esto: ${text}`;
    const response = await sendToAgent(msg);
    res.json({ ok: true, response });
  } catch (err) {
    res.status(502).json({ ok: false, error: 'Error creando recordatorio', detail: err.message });
  }
});

async function sendToAgent(message) {
  // Modo recomendado si ya tienes un script/cola que usa Telegram/OpenClaw/ChatGPT auth.
  if (AGENT_COMMAND) {
    return runCommand(AGENT_COMMAND, [], message, 120000);
  }
  // Modo provisional: intenta hablar con el gateway local de OpenClaw.
  return sendToOpenClawWS(message);
}

function runCommand(commandLine, args = [], input = '', timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const parts = splitCommand(commandLine);
    const cmd = parts.shift();
    const finalArgs = [...parts, ...args];
    const child = spawn(cmd, finalArgs, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timeout ejecutando ${cmd}`));
    }, timeoutMs);

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout.trim() || 'OK');
      reject(new Error((stderr || stdout || `Comando terminó con código ${code}`).trim()));
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function splitCommand(str) {
  // Parser sencillo para comandos con comillas básicas.
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str))) out.push(m[1] || m[2] || m[3]);
  return out;
}

function sendToOpenClawWS(message) {
  return new Promise((resolve, reject) => {
    let ws;
    let settled = false;
    let responseChunks = [];
    const timeout = setTimeout(() => finish(new Error('Timeout esperando respuesta de OpenClaw')), 60000);

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws?.close(); } catch {}
      if (err) reject(err);
      else resolve((value || responseChunks.join('') || 'OK').trim());
    }

    try {
      ws = new WebSocket(OPENCLAW_WS);
    } catch (e) {
      return finish(new Error('No se pudo crear conexión WebSocket'));
    }

    ws.on('open', () => {
      // Probamos un formato conservador, pero puede que tu OpenClaw necesite otro adaptador.
      ws.send(JSON.stringify({
        type: 'message',
        content: message,
        channel: 'app',
        source: 'openclaw-app'
      }));
    });

    ws.on('message', data => {
      const raw = data.toString();
      try {
        const parsed = JSON.parse(raw);
        if (parsed.error) return finish(new Error(String(parsed.error)));
        const piece = parsed.content || parsed.response || parsed.text || parsed.message || '';
        if (piece) responseChunks.push(String(piece));
        if (parsed.type === 'response' && piece) return finish(null, String(piece));
        if (parsed.type === 'done' || parsed.done === true || parsed.final === true) return finish(null);
      } catch {
        responseChunks.push(raw);
      }
    });

    ws.on('error', err => finish(new Error(`WebSocket error: ${err.message}`)));
    ws.on('close', () => {
      if (!settled && responseChunks.length) finish(null);
      else if (!settled) finish(new Error('OpenClaw cerró la conexión sin respuesta'));
    });
  });
}

function probeOpenClaw(timeoutMs) {
  return new Promise(resolve => {
    let ws;
    let done = false;
    const timer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
    function finish(ok, detail) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws?.close(); } catch {}
      resolve({ reachable: ok, url: OPENCLAW_WS, detail });
    }
    try {
      ws = new WebSocket(OPENCLAW_WS);
      ws.on('open', () => finish(true, 'connect ok'));
      ws.on('error', err => finish(false, err.message));
    } catch (err) {
      finish(false, err.message);
    }
  });
}

app.use((_req, res) => res.status(404).json({ ok: false, error: 'Ruta no encontrada' }));

app.listen(PORT, LISTEN_HOST, () => {
  console.log(`agent-api corriendo en http://${LISTEN_HOST}:${PORT}`);
  console.log(`Modo: ${AGENT_COMMAND ? `command (${AGENT_COMMAND})` : `websocket (${OPENCLAW_WS})`}`);
});
