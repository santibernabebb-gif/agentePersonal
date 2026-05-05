// =====================
// STATE — solo en memoria, nada sensible en localStorage
// =====================
const state = {
  session: null,      // token de sesión temporal (memoria)
  isRecording: false,
  recognition: null,
  installPrompt: null
};

// Base URL del proxy Cloudflare (relativo, siempre /api/...)
const API = '/api';

// =====================
// INIT
// =====================
function init() {
  showScreen('login');
}


// =====================
// PWA INSTALL
// =====================
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  state.installPrompt = event;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'flex';
});

window.addEventListener('appinstalled', () => {
  state.installPrompt = null;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'none';
  toast('App instalada');
});

async function installPWA() {
  if (!state.installPrompt) {
    toast('Abre el menú del navegador y pulsa Instalar app');
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'none';
}

// =====================
// SCREENS
// =====================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) requestAnimationFrame(() => el.classList.add('active'));
}

// =====================
// LOGIN
// =====================
async function handleCredentials() {
  const user = document.getElementById('user-input').value.trim();
  const pass = document.getElementById('pass-input').value.trim();
  if (!user || !pass) { toast('Introduce usuario y contraseña'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Verificando...';

  try {
    const res = await fetch(`${API}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass })
    });
    const data = await res.json();

    if (data.ok && data.session) {
      state.session = data.session;
      bootApp();
    } else {
      toast('Usuario o contraseña incorrectos');
      document.getElementById('pass-input').value = '';
    }
  } catch {
    toast('Error de conexión');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Entrar';
  }
}

// Enter para login
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pass-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCredentials();
  });
  document.getElementById('user-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pass-input').focus();
  });
});

// =====================
// BOOT
// =====================
function bootApp() {
  showScreen('app');
  checkHealth();
  loadSkills();
}

// =====================
// FETCH — siempre con session token, nunca expone el secret del VPS
// =====================
async function apiFetch(path, method = 'GET', body = null) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Session-Token': state.session || ''
  };
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  if (res.status === 401) {
    toast('Sesión expirada, vuelve a entrar');
    logout();
    throw new Error('Sesión expirada');
  }
  return res.json();
}

// =====================
// HEALTH
// =====================
async function checkHealth() {
  const dot = document.getElementById('agent-dot');
  const stat = document.getElementById('stat-status');
  try {
    const data = await apiFetch('/health');
    if (data.ok) {
      dot.classList.add('online');
      if (stat) stat.textContent = 'Online';
    } else {
      dot.className = 'agent-dot';
      if (stat) stat.textContent = 'Sin conexión';
    }
  } catch {
    dot.className = 'agent-dot';
    if (stat) stat.textContent = 'Sin conexión';
  }
}

// =====================
// SKILLS
// =====================
async function loadSkills() {
  const grid = document.getElementById('skills-list');
  const countEl = document.getElementById('skills-count');
  const statEl = document.getElementById('stat-skills');

  try {
    const data = await apiFetch('/skills');
    const skills = data.skills || [];
    const count = skills.length;
    if (countEl) countEl.textContent = count;
    if (statEl) statEl.textContent = count;

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
    grid.innerHTML = '<p style="color:var(--text3);font-size:13px;padding:20px 0;grid-column:1/-1">No se pudieron cargar las skills</p>';
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
  const dot = document.getElementById('agent-dot');
  dot.classList.remove('online');
  dot.classList.add('busy');
}

function removeThinking() {
  document.getElementById('thinking')?.remove();
  const dot = document.getElementById('agent-dot');
  dot.classList.remove('busy');
  dot.classList.add('online');
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
    const data = await apiFetch('/chat', 'POST', { message: text });
    removeThinking();
    const reply = data.response || data.message || data.content || 'Sin respuesta';
    addMessage(reply, 'agent');
  } catch (err) {
    removeThinking();
    if (err.message !== 'Sesión expirada') {
      addMessage('No se pudo contactar con el agente. Verifica que el backend está corriendo en tu VPS.', 'agent');
    }
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
// TABS
// =====================
function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + name)?.classList.add('active');
}

// =====================
// SETUP (solo info, ya no pide IP ni token)
// =====================
function openSetup() {
  document.getElementById('setup-back-btn').style.display = 'flex';
  showScreen('setup');
}

function closeSetup() {
  showScreen('app');
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
  document.getElementById('voice-btn')?.classList.remove('recording');
  document.getElementById('voice-indicator').style.display = 'none';
}

function cancelVoice() { stopVoice(); }

// =====================
// LOGOUT
// =====================
function logout() {
  state.session = null;
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
  if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
}

function formatTime(d) {
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

init();
