const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents'];

  function navigateTo(view) {
    const target = VIEWS.includes(view) ? view : 'dashboard';
    document.querySelectorAll('.tab-view').forEach(el => { el.hidden = true; });
    const targetEl = document.getElementById(`${target}-tab`);
    if (targetEl) targetEl.hidden = false;
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === target;
      btn.classList.toggle('active', isActive);
      btn.style.background = isActive ? 'rgba(16,185,129,0.2)' : 'transparent';
      btn.style.color = isActive ? '#e2e8f0' : '#94a3b8';
    });
    window.location.hash = target;
  }

  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    const saved = localStorage.getItem('ar_theme') || 'dark';
    document.body.dataset.theme = saved;
    if (btn) btn.textContent = saved === 'light' ? '☀️' : '🌙';
    btn?.addEventListener('click', () => {
      const next = (localStorage.getItem('ar_theme') || 'dark') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('ar_theme', next);
      document.body.dataset.theme = next;
      btn.textContent = next === 'light' ? '☀️' : '🌙';
    });
  }

  function initNavigation() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-tab')));
    });
    const initial = (window.location.hash || '').replace('#', '');
    navigateTo(initial || 'dashboard');
  }

  function initRFC() {
    const btn = document.getElementById('rfc-validate-btn');
    const inp = document.getElementById('rfc-input');
    const out = document.getElementById('rfc-result');
    if (!btn || !inp || !out) return;
    const validate = () => {
      const rfc = inp.value.trim().toUpperCase();
      if (!rfc) { out.innerHTML = '<div style="color:#ef4444;">Ingresa un RFC.</div>'; return; }
      const pf = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;
      const pm = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;
      if (pf.test(rfc) || pm.test(rfc) || ['XAXX010101000','XEXX010101000'].includes(rfc)) {
        out.innerHTML = `<div style="color:#10b981;">RFC válido: ${rfc}</div>`;
      } else {
        out.innerHTML = '<div style="color:#ef4444;">Formato inválido.</div>';
      }
    };
    btn.addEventListener('click', validate);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') validate(); });
  }

  function initChat() {
    const form = document.getElementById('classifier-form');
    const input = document.getElementById('classifier-input');
    const chat = document.getElementById('chat-messages');
    if (!form || !input || !chat) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const userBubble = document.createElement('div');
      userBubble.className = 'chat-bubble user';
      userBubble.textContent = text;
      chat.appendChild(userBubble);
      input.value = '';
      chat.scrollTop = chat.scrollHeight;

      try {
        if (!window.IntentClassifier) throw new Error('Clasificador no disponible');
        const cls = await window.IntentClassifier.process(text);
        const empty = document.getElementById('classification-empty');
        const content = document.getElementById('classification-content');
        if (empty) empty.hidden = true;
        if (content) content.hidden = false;
        const intentEl = document.getElementById('result-intent');
        if (intentEl) {
          const cat = window.CATEGORY_CONFIG?.[cls.intent] || { icon: '💬', label: cls.intent };
          intentEl.textContent = `${cat.icon} ${cat.label}`;
        }
        document.getElementById('result-confidence-val').textContent = `${Math.round(cls.confidence * 100)}%`;
        document.getElementById('result-keywords').textContent = (cls.keywords_matched || []).join(', ') || '—';
        document.getElementById('result-source').textContent = cls.source === 'gemini_proxy' ? 'Gemini IA' : 'Reglas locales';
        const botBubble = document.createElement('div');
        botBubble.className = 'chat-bubble bot';
        botBubble.textContent = cls.assistant_reply || 'Consulta recibida.';
        chat.appendChild(botBubble);
        chat.scrollTop = chat.scrollHeight;
        window.Store?.addConversation?.({ text, intent: cls.intent, confidence: cls.confidence, is_fiscal_audit_completed: cls.intent === 'SALUD_FISCAL' });
        window.Dashboard?.syncAndRender?.();
      } catch (err) {
        console.error('[App] Error en chat:', err);
        const errBubble = document.createElement('div');
        errBubble.className = 'chat-bubble bot';
        errBubble.textContent = 'Error: ' + err.message;
        chat.appendChild(errBubble);
        chat.scrollTop = chat.scrollHeight;
      }
    });

    document.querySelectorAll('.quick-ask').forEach(btn => {
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-prompt') || '';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    });
  }

  async function init() {
    console.log('[App] Iniciando...');
    initTheme();
    initNavigation();
    initRFC();

    // Cargar configuración
    let configOk = false;
    try {
      configOk = await window.AppConfig?.loadServerConfig?.() || false;
    } catch (e) {
      console.warn('[App] Error cargando configuración:', e.message);
    }

    if (!configOk) {
      console.warn('[App] Configuración no disponible, demo habilitado');
      const demoBtn = document.getElementById('auth-demo');
      if (demoBtn) demoBtn.disabled = false;
      const msgEl = document.getElementById('auth-msg');
      if (msgEl) {
        msgEl.hidden = false;
        msgEl.textContent = '⚠️ Servicio no disponible. Usa "Ver Demo".';
        msgEl.className = 'auth-msg warning';
        msgEl.style.color = '#f59e0b';
      }
      // No continuar con autenticación
      return;
    }

    // Inicializar Store y Auth
    try {
      await window.Store?.initSupabase?.();
    } catch (e) {
      console.warn('[App] Error en Store:', e.message);
    }

    try {
      await window.AuthManager?.init?.();
    } catch (e) {
      console.warn('[App] Error en Auth:', e.message);
    }

    // Inicializar Dashboard y otros módulos
    try {
      await window.Dashboard?.init?.();
    } catch (e) {
      console.warn('[App] Error en Dashboard:', e.message);
    }
    try {
      await window.DocumentProcessor?.init?.();
    } catch (e) {
      console.warn('[App] Error en DocumentProcessor:', e.message);
    }

    // Sincronizar eventos
    window.Store?.on?.('store:updated', () => window.Dashboard?.syncAndRender?.());
    window.Store?.on?.('store:reset', () => window.Dashboard?.syncAndRender?.());

    initChat();
    window.Dashboard?.syncAndRender?.();
  }

  return { init, navigateTo };
})();

window.App = App;

// Esperar a que el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('[App] DOMContentLoaded, iniciando...');
    App.init();
  });
} else {
  console.log('[App] DOM ya listo, iniciando...');
  App.init();
}