// =====================
// STATE
// =====================
const state = {
  token: null,
  url: null,
  biometricAvailable: false,
  isRecording: false,
  mediaRecorder: null,
  recognition: null,
  messages: []
};

// =====================
// STORAGE (encrypted with btoa - basic obfuscation)
// =====================
const Store = {
  save(key, val) { localStorage.setItem(key, btoa(encodeURIComponent(JSON.stringify(val)))); },
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
async function init() {
  // Siempre empieza por el login de usuario/contraseña
  showScreen('login');
  document.getElementById('login-credentials').style.display = 'flex';
  document.getElementById('login-setup').style.display = 'none';
  document.getElementById('login-biometric').style.display = 'none';
}

// =====================
// STEP 1 — Verificar usuario y contraseña via Worker
// =====================
async function handleCredentials() {
  const user = document.getElementById('user-input').value.trim();
  const pass = document.getElementById('pass-input').value.trim();

  if (!user || !pass) { toast('Introduce usuario y contraseña'); return; }

  const btn = document.querySelector('#login-credentials .btn-primary');
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
      state.session = data.session;
      // Credenciales correctas — ver si ya tiene token guardado
      const saved = Store.load('oc_creds');
      if (saved && saved.token && saved.url) {
        state.token = saved.token;
        state.url = saved.url;
        await bootApp();
      } else {
        // Primera vez — pedir Gateway Token y URL
        document.getElementById('login-credentials').style.display = 'none';
        document.getElementById('login-setup').style.display = 'flex';
      }
    } else {
      toast('Usuario o contraseña incorrectos');
      document.getElementById('pass-input').value = '';
    }
  } catch {
    toast('Error de conexión. Inténtalo de nuevo.');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Entrar';
  }
}

// =====================
// STEP 2 — Gateway Token + URL (solo primera vez)
// =====================
async function handleLogin() {
  const token = document.getElementById('token-input').value.trim();
  const url = document.getElementById('url-input').value.trim();

  if (!token) { toast('Introduce tu Gateway Token'); return; }
  if (!url) { toast('Introduce la URL de tu OpenClaw'); return; }

  const cleanUrl = url.replace(/\/$/, '');
  state.token = token;
  state.url = cleanUrl;

  Store.save('oc_creds', { token, url: cleanUrl });
  await bootApp();
}

function showTokenLogin() {
  document.getElementById('login-biometric').style.display = 'none';
  document.getElementById('login-setup').style.display = 'flex';
}

async function handleBiometric() {
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: 'required',
        rpId: window.location.hostname
      }
    });
    await bootApp();
  } catch (e) {
    if (e.name !== 'NotAllowedError') {
      toast('Biometría fallida');
      showTokenLogin();
    }
  }
}

// =====================
// APP BOOT
// =====================
async function bootApp() {
  showScreen('app');
  updatePanel();
  checkAgentStatus();
  loadSkills();
  addSystemMessage('Conectado · ' + formatTime(new Date()));
}

// =====================
// SCREENS & TABS
// =====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = name === 'login' ? 'screen-login' : 'screen-app';
  const el = document.getElementById(target);
  if (el) {
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('active'));
  }
}

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
  try {
    const res = await fetchAgent('/api/v1/health', 'GET');
    if (res && res.status === 'ok') {
      dot.classList.add('online');
      document.getElementById('stat-status').textContent = 'Online';
    } else {
      dot.className = 'agent-dot';
      document.getElementById('stat-status').textContent = 'Desconectado';
    }
  } catch {
    dot.className = 'agent-dot';
    document.getElementById('stat-status').textContent = 'Sin conexión';
  }
}

// =====================
// FETCH AGENT
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
    document.getElementById('skills-count').textContent = skills.length;
    document.getElementById('stat-skills').textContent = skills.length;

    if (skills.length === 0) {
      grid.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:20px 0;grid-column:1/-1">No hay skills instaladas aún</p>';
      return;
    }

    grid.innerHTML = skills.map(s => `
      <div class="skill-card" onclick="useSkill('${s.name || s.id}')">
        <div class="skill-icon">${s.icon || '⚡'}</div>
        <div class="skill-name">${s.name || s.id}</div>
        <div class="skill-desc">${s.description || ''}</div>
      </div>
    `).join('');
  } catch {
    grid.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:20px 0;grid-column:1/-1">No se pudieron cargar las skills</p>';
  }
}

function useSkill(name) {
  switchTab('chat', document.querySelector('.tab[data-tab="chat"]'));
  document.getElementById('msg-input').value = `Usa la skill: ${name}`;
  document.getElementById('msg-input').focus();
}

// =====================
// PANEL
// =====================
function updatePanel() {
  document.getElementById('info-url').textContent = state.url || '—';
  document.getElementById('info-bio').textContent = state.biometricAvailable ? 'Disponible ✓' : 'No disponible';
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
  return div;
}

function addSystemMessage(text) {
  const msgs = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg-system';
  div.innerHTML = `<span>${text}</span>`;
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

  input.value = '';
  input.style.height = 'auto';
  addMessage(text, 'user');
  addThinking();

  try {
    const data = await fetchAgent('/api/v1/chat', 'POST', { message: text });
    removeThinking();
    const reply = data.response || data.message || data.content || JSON.stringify(data);
    addMessage(reply, 'agent');
  } catch (e) {
    removeThinking();
    addMessage('Error al conectar con el agente. Verifica que tu OpenClaw esté activo.', 'agent');
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
  if (state.isRecording) {
    stopVoice();
  } else {
    startVoice();
  }
}

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast('Tu navegador no soporta voz. Usa Chrome.');
    return;
  }

  state.recognition = new SpeechRecognition();
  state.recognition.lang = 'es-ES';
  state.recognition.continuous = false;
  state.recognition.interimResults = false;

  state.recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    document.getElementById('msg-input').value = text;
    stopVoice();
    sendMessage();
  };

  state.recognition.onerror = () => {
    stopVoice();
    toast('No se captó audio. Inténtalo de nuevo.');
  };

  state.recognition.onend = () => stopVoice();

  state.recognition.start();
  state.isRecording = true;
  document.getElementById('voice-btn').classList.add('recording');
  document.getElementById('voice-indicator').style.display = 'flex';
}

function stopVoice() {
  if (state.recognition) {
    state.recognition.stop();
    state.recognition = null;
  }
  state.isRecording = false;
  document.getElementById('voice-btn').classList.remove('recording');
  document.getElementById('voice-indicator').style.display = 'none';
}

function cancelVoice() {
  stopVoice();
}

// =====================
// LOGOUT
// =====================
function logout() {
  if (!confirm('¿Cerrar sesión y borrar datos guardados?')) return;
  Store.remove('oc_creds');
  state.token = null;
  state.url = null;
  state.session = null;
  document.getElementById('user-input').value = '';
  document.getElementById('pass-input').value = '';
  document.getElementById('token-input').value = '';
  document.getElementById('url-input').value = '';
  document.getElementById('login-credentials').style.display = 'flex';
  document.getElementById('login-setup').style.display = 'none';
  document.getElementById('login-biometric').style.display = 'none';
  document.getElementById('messages').innerHTML = '';
  showScreen('login');
}

// =====================
// UTILS
// =====================
function togglePassword(id, btn) {
  const inp = document.getElementById(id);
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

function formatTime(d) {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// =====================
// SERVICE WORKER
// =====================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// =====================
// START
// =====================
init();
