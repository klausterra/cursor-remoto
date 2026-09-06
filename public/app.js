// Service Worker Registration
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error);
}

// App State
let authToken = localStorage.getItem('cursor_remote_token') || '';
let currentAgent = localStorage.getItem('cursor_active_agent') || 'developer';
let sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
let eventSource = null;
let deferredPrompt = null;
let agentsList = [];

// DOM References
const authModal = document.getElementById('auth-modal');
const authTokenInput = document.getElementById('auth-token-input');
const authBtn = document.getElementById('auth-btn');
const authError = document.getElementById('auth-error');

const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const drawerToggleBtn = document.getElementById('drawer-toggle-btn');
const drawerCloseBtn = document.getElementById('drawer-close-btn');

const agentBar = document.getElementById('agent-bar');
const currentAgentIcon = document.getElementById('current-agent-icon');
const currentAgentTitle = document.getElementById('current-agent-title');
const currentAgentDesc = document.getElementById('current-agent-desc');
const dockAgentIcon = document.getElementById('dock-agent-icon');

const chatFeed = document.getElementById('chat-feed');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const newSessionBtn = document.getElementById('new-session-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const logoutBtn = document.getElementById('logout-btn');
const pwaInstallBtn = document.getElementById('pwa-install-btn');

// PWA Install Prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (pwaInstallBtn) pwaInstallBtn.style.display = 'block';
});

if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        pwaInstallBtn.style.display = 'none';
      }
      deferredPrompt = null;
    }
  });
}

// Drawer Handlers
function toggleDrawer(open) {
  if (open) {
    drawer.classList.add('open');
    drawerOverlay.classList.add('open');
  } else {
    drawer.classList.remove('open');
    drawerOverlay.classList.remove('open');
  }
}

if (drawerToggleBtn) drawerToggleBtn.addEventListener('click', () => toggleDrawer(true));
if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', () => toggleDrawer(false));
if (drawerOverlay) drawerOverlay.addEventListener('click', () => toggleDrawer(false));

// Auth Flow
authBtn.addEventListener('click', async () => {
  const token = authTokenInput.value.trim();
  if (!token) return;

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const data = await res.json();
    if (data.ok) {
      authToken = data.token;
      localStorage.setItem('cursor_remote_token', authToken);
      authModal.style.display = 'none';
      authError.style.display = 'none';
      initApp();
    } else {
      authError.style.display = 'block';
    }
  } catch (err) {
    authError.textContent = 'Erro ao conectar ao servidor';
    authError.style.display = 'block';
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('cursor_remote_token');
  authToken = '';
  if (eventSource) eventSource.close();
  toggleDrawer(false);
  authModal.style.display = 'flex';
});

// App Initialization
async function initApp() {
  if (!authToken) {
    authModal.style.display = 'flex';
    return;
  }

  authModal.style.display = 'none';
  if (sendBtn) sendBtn.disabled = false;
  await loadAgents();
  connectSSE();
}

async function loadAgents() {
  try {
    const res = await fetch('/api/agents', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.status === 401) {
      logoutBtn.click();
      return;
    }
    const data = await res.json();
    agentsList = data.agents || [
      { id: "architect", name: "Architect", description: "Design e planejamento técnico", icon: "📐" },
      { id: "developer", name: "Developer", description: "Implementação de código", icon: "💻" },
      { id: "tester", name: "Tester", description: "Validação e qualidade", icon: "🧪" },
      { id: "reviewer", name: "Reviewer", description: "Revisão e segurança", icon: "🔍" },
      { id: "explorer", name: "Explorer", description: "Busca de símbolos e codebase", icon: "🧭" }
    ];
    renderAgents(agentsList);
    selectAgent(currentAgent);
  } catch (e) {
    console.error('Erro ao carregar agentes:', e);
  }
}

function renderAgents(agents) {
  agentBar.innerHTML = '';
  agents.forEach((ag) => {
    const pill = document.createElement('div');
    pill.className = `agent-pill ${ag.id === currentAgent ? 'active' : ''}`;
    pill.innerHTML = `<span>${ag.icon || '🤖'}</span><span>${ag.name}</span>`;
    pill.addEventListener('click', () => selectAgent(ag.id));
    agentBar.appendChild(pill);
  });
}

function selectAgent(agentId) {
  currentAgent = agentId;
  localStorage.setItem('cursor_active_agent', agentId);

  document.querySelectorAll('.agent-pill').forEach(p => {
    p.classList.remove('active');
    if (p.innerText.toLowerCase().includes(agentId.toLowerCase())) {
      p.classList.add('active');
    }
  });

  const ag = agentsList.find(a => a.id === agentId) || {
    name: agentId.toUpperCase(),
    icon: '💻',
    description: 'Agente ativo'
  };

  if (currentAgentIcon) currentAgentIcon.textContent = ag.icon || '💻';
  if (currentAgentTitle) currentAgentTitle.textContent = `${ag.name} Agent`;
  if (currentAgentDesc) currentAgentDesc.textContent = ag.description || 'Pronto para execução';
  if (dockAgentIcon) dockAgentIcon.textContent = ag.icon || '💻';
}

// Quick Fill / Slash Commands
window.quickFill = function(text) {
  promptInput.value = text;
  promptInput.focus();
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
};

// Clear Chat / New Session
if (clearChatBtn) {
  clearChatBtn.addEventListener('click', () => {
    chatFeed.innerHTML = '';
    toggleDrawer(false);
  });
}

if (newSessionBtn) {
  newSessionBtn.addEventListener('click', () => {
    sessionId = 'session_' + Math.random().toString(36).substring(2, 9);
    connectSSE();
    const notice = document.createElement('div');
    notice.className = 'msg-card user';
    notice.innerHTML = `<div class="user-bubble" style="background:var(--bg-surface-elevated);color:var(--text-muted);">🔄 Nova sessão iniciada (${sessionId.slice(0, 15)})</div>`;
    chatFeed.appendChild(notice);
    scrollBottom();
  });
}

// SSE Connection & Stream Rendering
let currentCard = null;
let currentBody = null;
let currentThinkingContent = null;
let currentTextSpan = null;
let currentBadge = null;

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/stream?session_id=${sessionId}&token=${authToken}`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      handleSSEEvent(data);
    } catch (err) {
      // Raw chunk or keepalive
    }
  };

  eventSource.onerror = () => {
    // SSE reconnects automatically
  };
}

function handleSSEEvent(data) {
  if (data.type === 'start') {
    const ag = agentsList.find(a => a.id === data.agent) || {
      name: data.agent || 'Agent',
      icon: '🤖'
    };

    const card = document.createElement('div');
    card.className = 'msg-card agent-card';
    card.innerHTML = `
      <div class="card-header">
        <div class="agent-avatar">${ag.icon}</div>
        <div class="agent-meta">
          <span class="agent-name">${ag.name}</span>
          <span class="msg-time">Agora</span>
        </div>
        <span class="badge running">Executando</span>
      </div>
      <div class="card-body"></div>
    `;

    chatFeed.appendChild(card);
    currentCard = card;
    currentBody = card.querySelector('.card-body');
    currentBadge = card.querySelector('.badge');
    currentThinkingContent = null;
    currentTextSpan = null;
    scrollBottom();

  } else if (data.type === 'thought' && currentBody) {
    if (!currentThinkingContent) {
      const accordion = document.createElement('div');
      accordion.className = 'thinking-accordion open';
      accordion.innerHTML = `
        <div class="thinking-header" onclick="this.parentElement.classList.toggle('open')">
          <span>💭 Raciocínio do Modelo</span>
          <span class="chevron-icon">▼</span>
        </div>
        <div class="thinking-content"></div>
      `;
      currentBody.appendChild(accordion);
      currentThinkingContent = accordion.querySelector('.thinking-content');
    }
    currentThinkingContent.innerHTML += (currentThinkingContent.innerHTML ? '<br>' : '') + escapeHtml(data.text);
    scrollBottom();

  } else if (data.type === 'tool_call' && currentBody) {
    const toolBox = document.createElement('div');
    toolBox.className = 'tool-box';
    toolBox.id = `tool-${Date.now()}`;
    toolBox.innerHTML = `
      <div class="tool-box-header">
        <span>🛠️ Ação: ${escapeHtml(data.name || 'tool')}</span>
        <span class="badge running">rodando</span>
      </div>
      <div class="tool-box-content">${escapeHtml(JSON.stringify(data.input, null, 2))}</div>
    `;
    currentBody.appendChild(toolBox);
    scrollBottom();

  } else if (data.type === 'tool_result' && currentBody) {
    const toolBox = currentBody.querySelector('.tool-box:last-of-type');
    if (toolBox) {
      const badge = toolBox.querySelector('.badge');
      if (badge) {
        badge.className = 'badge success';
        badge.textContent = 'ok';
      }
      const content = toolBox.querySelector('.tool-box-content');
      if (content) {
        content.textContent += '\n\n' + (typeof data.output === 'object' ? JSON.stringify(data.output, null, 2) : data.output);
      }
    }
    scrollBottom();

  } else if (data.type === 'chunk' && currentBody) {
    if (!currentTextSpan) {
      const span = document.createElement('div');
      span.className = 'markdown-output';
      currentBody.appendChild(span);
      currentTextSpan = span;
    }
    currentTextSpan.innerHTML = formatMarkdown(currentTextSpan.getAttribute('data-raw') ? currentTextSpan.getAttribute('data-raw') + data.text : data.text);
    currentTextSpan.setAttribute('data-raw', (currentTextSpan.getAttribute('data-raw') || '') + data.text);
    scrollBottom();

  } else if (data.type === 'done') {
    if (currentBadge) {
      currentBadge.className = 'badge success';
      currentBadge.textContent = 'Concluído';
    }
    sendBtn.disabled = false;
    currentCard = null;
    currentBody = null;
    scrollBottom();
  }
}

// Send Message
async function sendMessage() {
  const prompt = promptInput.value.trim();
  if (!prompt || sendBtn.disabled) return;

  // Render user message card
  const userDiv = document.createElement('div');
  userDiv.className = 'msg-card user';
  userDiv.innerHTML = `<div class="user-bubble">${escapeHtml(prompt)}</div>`;
  chatFeed.appendChild(userDiv);

  promptInput.value = '';
  promptInput.style.height = 'auto';
  scrollBottom();

  sendBtn.disabled = true;

  // Auto-reset sendBtn after timeout in case of stream drop
  setTimeout(() => {
    if (sendBtn) sendBtn.disabled = false;
  }, 15000);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        agent_id: currentAgent,
        prompt,
        session_id: sessionId
      })
    });

    if (res.status === 401) {
      logoutBtn.click();
    }
  } catch (err) {
    sendBtn.disabled = false;
    alert('Erro ao enviar mensagem para o agente');
  }
}

sendBtn.addEventListener('click', sendMessage);

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
});

function scrollBottom() {
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function escapeHtml(text) {
  if (typeof text !== 'string') text = String(text);
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Bold **text**
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Multi-line code blocks ```lang ... ```
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

  // Newlines to <br>
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Start
initApp();
