const $ = (id) => document.getElementById(id);
const messages = $('messages');
const welcome = $('welcome');
const composer = $('composer');
const input = $('message');
const sendBtn = $('sendBtn');
const apiBaseInput = $('apiBase');
const dialog = $('settingsDialog');
const statusDot = $('statusDot');
const statusText = $('statusText');
const modelLabel = $('modelLabel');

let apiBase = localStorage.getItem('astracore.apiBase') || '';
apiBaseInput.value = apiBase;

function apiUrl(path) {
  const base = apiBase.trim().replace(/\/$/, '');
  return `${base}${base ? '' : ''}${path}`;
}

function addMessage(role, text) {
  welcome.hidden = true;
  const row = document.createElement('div');
  row.className = `message ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'You' : '✦';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  row.append(avatar, bubble);
  if (role === 'user') row.insertBefore(bubble, avatar);
  messages.appendChild(row);
  row.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return bubble;
}

async function checkHealth() {
  try {
    const response = await fetch(apiUrl('/api/health'), { cache: 'no-store' });
    const data = await response.json();
    const ready = response.ok && data.ready;
    statusDot.className = `dot ${ready ? 'online' : 'offline'}`;
    statusText.textContent = ready ? 'Model online' : 'Model not trained';
    modelLabel.textContent = `Model: ${data.model || 'not loaded'}`;
  } catch {
    statusDot.className = 'dot offline';
    statusText.textContent = 'API offline';
    modelLabel.textContent = 'Model: unavailable';
  }
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message || composer.classList.contains('busy')) return;
  addMessage('user', message);
  input.value = '';
  composer.classList.add('busy');
  sendBtn.disabled = true;
  const pending = addMessage('assistant', 'Thinking…');
  try {
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, maxNewTokens: 96, temperature: 0.8, topK: 8 })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    pending.textContent = data.response || 'No response returned.';
    modelLabel.textContent = `Model: ${data.model || 'AstraCore'}`;
  } catch (error) {
    pending.textContent = `AstraCore connection error: ${error.message}`;
  } finally {
    composer.classList.remove('busy');
    sendBtn.disabled = false;
    checkHealth();
  }
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(input.value);
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
document.querySelectorAll('[data-prompt]').forEach((button) => button.addEventListener('click', () => {
  input.value = button.dataset.prompt;
  input.focus();
  input.dispatchEvent(new Event('input'));
}));
$('settingsBtn').addEventListener('click', () => dialog.showModal());
$('resetApi').addEventListener('click', () => { apiBaseInput.value = ''; });
dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'default') {
    apiBase = apiBaseInput.value.trim().replace(/\/$/, '');
    localStorage.setItem('astracore.apiBase', apiBase);
    checkHealth();
  }
});
checkHealth();
