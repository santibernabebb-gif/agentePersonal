/**
 * agent-api.js
 * Backend puente entre la PWA y el agente real de OpenClaw del VPS.
 */

const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const AGENT_SECRET = process.env.AGENT_APP_SECRET || '';
const OPENCLAW_AGENT = process.env.OPENCLAW_AGENT || 'main';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/usr/bin/openclaw';
const COMMAND_TIMEOUT_MS = Number(process.env.COMMAND_TIMEOUT_MS || 120000);

if (!AGENT_SECRET) {
  console.error('ERROR: AGENT_APP_SECRET no está definido. Saliendo.');
  process.exit(1);
}

app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();

  if (!token || token !== AGENT_SECRET) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  next();
}

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.get('/health', auth, (_req, res) => {
  res.json({
    ok: true,
    status: 'online',
    bridge: 'openclaw-cli',
    openclaw_agent: OPENCLAW_AGENT,
    timestamp: new Date().toISOString()
  });
});

app.post('/chat', auth, async (req, res) => {
  const message = String(req.body?.message || '').trim();

  if (!message) {
    return res.status(400).json({ ok: false, error: 'Mensaje vacío' });
  }

  try {
    const response = await sendToOpenClaw(message);
    return res.json({ ok: true, response });
  } catch (err) {
    console.error('Error llamando a OpenClaw CLI:', err);
    return res.status(502).json({
      ok: false,
      error: 'No se pudo contactar con el agente real del VPS',
      detail: err.message
    });
  }
});

app.post('/manuales', auth, async (req, res) => {
  const query = String(req.body?.query || req.body?.message || '').trim();

  if (!query) {
    return res.status(400).json({ ok: false, error: 'Consulta vacía' });
  }

  try {
    const raw = await buscarManuales(query);

    if (!raw.trim()) {
      return res.json({
        ok: true,
        response: `No he encontrado nada claro en los manuales para: "${query}".`
      });
    }

    const prompt = `
Eres un asistente técnico informático para soporte a usuarios funcionarios.

Responde SOLO usando los fragmentos de manuales que aparecen abajo.

Pregunta:
${query}

Fragmentos encontrados:
${raw}

Instrucciones:
- Da una solución práctica paso a paso.
- Di claramente en qué archivo/manual aparece.
- Si hay varios manuales, menciona los más relevantes.
- Si la información no es suficiente, dilo.
- No inventes datos fuera de los fragmentos.
`;

    const response = await sendToOpenClaw(prompt);
    return res.json({ ok: true, response, raw });
  } catch (err) {
    console.error('Error consultando manuales:', err);
    return res.status(500).json({
      ok: false,
      error: 'Error consultando manuales',
      detail: err.message
    });
  }
});

app.get('/skills', auth, async (_req, res) => {
  return res.json({
    ok: true,
    skills: [
      {
        id: 'chat',
        name: 'ChatGPT / OpenClaw',
        icon: '🧠',
        description: 'Hablar con el agente principal del VPS'
      },
      {
        id: 'manuales',
        name: 'Manuales internos',
        icon: '📚',
        description: 'Buscar soluciones en los manuales subidos a la VPS'
      }
    ]
  });
});

app.post('/remind', auth, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const when = String(req.body?.when || '').trim();

  if (!text) {
    return res.status(400).json({ ok: false, error: 'Falta el texto del recordatorio' });
  }

  const message = when
    ? `Recuérdame ${when}: ${text}`
    : `Crea un recordatorio para esto: ${text}`;

  try {
    const response = await sendToOpenClaw(message);
    return res.json({ ok: true, response });
  } catch (err) {
    console.error('Error creando recordatorio con OpenClaw CLI:', err);
    return res.status(502).json({ ok: false, error: 'Error al crear recordatorio', detail: err.message });
  }
});

function buscarManuales(query) {
  return new Promise((resolve, reject) => {
    execFile(
      '/usr/local/bin/buscar-manuales',
      [query],
      {
        timeout: 60000,
        maxBuffer: 1024 * 1024 * 6,
        env: {
          ...process.env,
          HOME: process.env.HOME || '/root'
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr || stdout || error.message;
          return reject(new Error(detail));
        }

        resolve(stdout || '');
      }
    );
  });
}

function sendToOpenClaw(message) {
  return new Promise((resolve, reject) => {
    execFile(
      OPENCLAW_BIN,
      ['agent', '--agent', OPENCLAW_AGENT, '--message', message],
      {
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 8,
        env: {
          ...process.env,
          HOME: process.env.HOME || '/root'
        }
      },
      (error, stdout, stderr) => {
        const cleanStdout = cleanOpenClawOutput(stdout || '');
        const cleanStderr = cleanOpenClawOutput(stderr || '');

        if (error) {
          const detail = cleanStderr || cleanStdout || error.message;
          return reject(new Error(detail));
        }

        const reply = cleanStdout || cleanStderr;
        if (!reply) {
          return reject(new Error('OpenClaw no devolvió respuesta'));
        }

        resolve(reply);
      }
    );
  });
}

function cleanOpenClawOutput(output) {
  if (!output) return '';

  let text = output
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r/g, '')
    .trim();

  const marker = text.lastIndexOf('◇');
  if (marker !== -1) {
    text = text.slice(marker + 1).trim();
  }

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('🦞 OpenClaw'))
    .filter(line => !line.startsWith('│'));

  return lines.join('\n').trim();
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`agent-api corriendo en http://127.0.0.1:${PORT}`);
  console.log(`OpenClaw CLI: ${OPENCLAW_BIN} agent --agent ${OPENCLAW_AGENT}`);
  console.log('Listo para recibir peticiones.');
});

