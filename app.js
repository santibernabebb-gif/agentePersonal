// =====================
// STATE
// =====================
const state = {
  token: null,
  url: null,
  isRecording: false,
  recognition: null
};

// =====================
// STORAGE
// =====================
const Store = {
  save(key, val) {
    try { localStorage.setItem(key, btoa(encodeURIComponent(JSON.stringify(val)))); } catch {}
  },
  load(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(decodeURIComponent(atob(raw)));
    } catch { return null; }
  },
  remove(key) { localStorage.removeItem(key); }
};

// =====================
// INIT
// =====================
function init() {
  showScreen('login');
}

// =====================
// SCREENS
// =====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
  });
  const el = document.getElementById('screen-' + name);
  if (el) {
    requestAnimationFrame(() => {
      el.style.display = 'flex';
      requestAnimationFrame(() => el.classList.add('active'));
    });
  }
}

// =====================
// LOGIN — Step 1: usuario y contraseña
// =====================
async function handleCredentials() {
  const user = document.getElementById('user-input').value.trim();
  const pass = document.getElementById('pass-input').value.trim();

  if (!user || !pass) { toast('Introduce usuario y contraseña'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Verificando...';

  try {
    const res = await fetch('/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass })
    });

    const data = await res.json();

    if (data.ok) {
      // Credenciales OK — cargar config guardada
      const saved = Store.load('oc_config');
      if (saved && saved.token && saved.url) {
        state.token = saved.token;
        state.url = saved.url;
        bootApp();
      } else {
        // Primera vez — ir a configuración
        showScreen('setup');
        document.getElementById('setup-back-btn').style.display = 'none';
      }
    } else {
      toast('Usuario o contraseña incorrectos');
      document.getElementById('pass-input').value = '';
    }
  } catch {
    toast('Error de conexión con el servidor');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Entrar';
  }
}

// Enter en el campo de contraseña
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pass-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCredentials();
  });
  document.getElementById('user-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pass-input').focus();
  });
});

// =====================
// SETUP — Configurar VPS
// =====================
function openSetup() {
  const saved = Store.load('oc_config');
  if (saved) {
    // Rellenar con valores actuales
    const parts = saved.url ? saved.url.replace('http://', '').split(':') : ['', '48001'];
    document.getElementById('setup-ip').value = parts[0] || '';
    document.getElementById('setup-port').value = parts[1] || '48001';
    document.getElementById('setup-token').value = saved.token || '';
  }
  document.getElementById('setup-back-btn').style.display = 'flex';
  document.getElementById('setup-status').style.display = 'none';
  showScreen('setup');
}

function closeSetup() {
  if (state.token && state.url) {
    showScreen('app');
  } else {
    showScreen('login');
  }
}

async function saveSetup() {
  const ip = document.getElementById('setup-ip').value.trim();
  const port = document.getElementById('setup-port').value.trim() || '48001';
  const token = document.getElementById('setup-token').value.trim();

  if (!ip) { toast('Introduce la IP de tu VPS'); return; }
  if (!token) { toast('Introduce tu Gateway Token'); return; }

  const url = `http://${ip}:${port}`;

  // Mostrar estado
  document.getElementById('setup-status').style.display = 'flex';

  // Guardar
  state.token = token;
  state.url = url;
  Store.save('oc_config', { token, url });

  // Intentar conectar
  try {
    await checkAgentStatus();
    toast('¡Conectado correctamente!');
    setTimeout(() => bootApp(), 800);
  } catch {
    document.getElementById('setup-status').style.display = 'none';
    toast('Guardado. No se pudo verificar la conexión ahora.');
    setTimeout(() => bootApp(), 1200);
  }
}

// =====================
// BOOT APP
// =====================
function bootApp() {
  showScreen('app');
  document.getElementById('info-url').textContent = state.url || '—';
  checkAgentStatus();
  loadSkills();
}

// =====================
// TABS
// =====================
function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
}

// =====================
// AGENT STATUS
// =====================
async function checkAgentStatus() {
  const dot = document.getElementById('agent-dot');
  const stat = document.getElementById('stat-status');
  try {
    const res = await fetchAgent('/api/v1/health', 'GET');
    if (res) {
      dot.classList.add('online');
      if (stat) stat.textContent = 'Online';
    }
  } catch {
    dot.className = 'agent-dot';
    if (stat) stat.textContent = 'Sin conexión';
  }
}

// =====================
// FETCH
// =====================
async function fetchAgent(path, method = 'GET', body = null) {
  const headers = {
    'Authorization': `Bearer ${state.token}`,
    'Content-Type': 'application/json'
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(state.url + path, opts);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// =====================
// SKILLS
// =====================
async function loadSkills() {
  const grid = document.getElementById('skills-list');
  try {
    const data = await fetchAgent('/api/v1/skills', 'GET');
    const skills = data.skills || data || [];
    const count = Array.isArray(skills) ? skills.length : 0;
    document.getElementById('skills-count').textContent = count;
    document.getElementById('stat-skills').textContent = count;

    if (count === 0) {
      grid.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:20px 0;grid-column:1/-1">No hay skills instaladas aún</p>';
      return;
    }

    grid.innerHTML = skills.map(s => `
      <div class="skill-card" onclick="useSkill('${escapeHtml(s.name || s.id || '')}')">
        <div class="skill-icon">${s.icon || '⚡'}</div>
        <div class="skill-name">${escapeHtml(s.name || s.id || 'Sin nombre')}</div>
        <div class="skill-desc">${escapeHtml(s.description || '')}</div>
      </div>
    `).join('');
  } catch {
    grid.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:20px 0;grid-column:1/-1">Configura la conexión para ver las skills</p>';
  }
}

function useSkill(name) {
  switchTab('chat', document.querySelector('.tab[data-tab="chat"]'));
  document.getElementById('msg-input').value = `Usa la skill: ${name}`;
  document.getElementById('msg-input').focus();
}

// =====================
// CHAT
// =====================
function addMessage(text, role) {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    <div class="msg-bubble">${escapeHtml(text)}</div>
    <span class="msg-time">${formatTime(new Date())}</span>
  `;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function addThinking() {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg-thinking';
  div.id = 'thinking';
  div.innerHTML = '<span></span><span></span><span></span>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  document.getElementById('agent-dot').classList.add('busy');
  document.getElementById('agent-dot').classList.remove('online');
}

function removeThinking() {
  const el = document.getElementById('thinking');
  if (el) el.remove();
  document.getElementById('agent-dot').classList.remove('busy');
  document.getElementById('agent-dot').classList.add('online');
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;

  if (!state.token || !state.url) {
    toast('Configura la conexión primero');
    openSetup();
    return;
  }

  input.value = '';
  input.style.height = 'auto';
  addMessage(text, 'user');
  addThinking();

  try {
    const data = await fetchAgent('/api/v1/chat', 'POST', { message: text });
    removeThinking();
    const reply = data.response || data.message || data.content || data.reply || JSON.stringify(data);
    addMessage(reply, 'agent');
  } catch {
    removeThinking();
    addMessage('No se pudo contactar con el agente. Verifica la configuración.', 'agent');
  }
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// =====================
// VOICE
// =====================
function toggleVoice() {
  if (state.isRecording) stopVoice();
  else startVoice();
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Tu navegador no soporta voz. Usa Chrome.'); return; }

  state.recognition = new SR();
  state.recognition.lang = 'es-ES';
  state.recognition.continuous = false;
  state.recognition.interimResults = false;

  state.recognition.onresult = e => {
    document.getElementById('msg-input').value = e.results[0][0].transcript;
    stopVoice();
    sendMessage();
  };
  state.recognition.onerror = () => { stopVoice(); toast('No se captó audio.'); };
  state.recognition.onend = () => stopVoice();
  state.recognition.start();

  state.isRecording = true;
  document.getElementById('voice-btn').classList.add('recording');
  document.getElementById('voice-indicator').style.display = 'flex';
}

function stopVoice() {
  if (state.recognition) { state.recognition.stop(); state.recognition = null; }
  state.isRecording = false;
  document.getElementById('voice-btn').classList.remove('recording');
  document.getElementById('voice-indicator').style.display = 'none';
}

function cancelVoice() { stopVoice(); }

// =====================
// LOGOUT
// =====================
function logout() {
  if (!confirm('¿Cerrar sesión?')) return;
  Store.remove('oc_config');
  state.token = null;
  state.url = null;
  document.getElementById('user-input').value = '';
  document.getElementById('pass-input').value = '';
  document.getElementById('messages').innerHTML = '<div class="msg-system"><span>Conectado a tu agente OpenClaw</span></div>';
  showScreen('login');
}

// =====================
// UTILS
// =====================
function togglePassword(id) {
  const inp = document.getElementById(id);
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function formatTime(d) {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Start
init();
