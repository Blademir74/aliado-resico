const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents'];

  function navigateTo(view) {
    const target = VIEWS.includes(view) ? view : 'dashboard';
    document.querySelectorAll('.tab-view').forEach(el => {
      el.hidden = true;
    });
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
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        navigateTo(tab);
      });
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
        const confVal = document.getElementById('result-confidence-val');
        if (confVal) confVal.textContent = `${Math.round(cls.confidence * 100)}%`;
        const kwEl = document.getElementById('result-keywords');
        if (kwEl) kwEl.textContent = (cls.keywords_matched || []).join(', ') || '—';
        const srcEl = document.getElementById('result-source');
        if (srcEl) srcEl.textContent = cls.source === 'gemini_proxy' ? 'Gemini IA' : 'Reglas locales';
        const botBubble = document.createElement('div');
        botBubble.className = 'chat-bubble bot';
        botBubble.textContent = cls.assistant_reply || 'Consulta recibida.';
        chat.appendChild(botBubble);
        chat.scrollTop = chat.scrollHeight;
        window.Store?.addConversation?.({ text, intent: cls.intent, confidence: cls.confidence, is_fiscal_audit_completed: cls.intent === 'SALUD_FISCAL' });
        window.Dashboard?.syncAndRender?.();
      } catch (err) {
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
    initTheme();
    initNavigation();
    initRFC();

    // ============================================================
    // PASO 1: Cargar configuración del servidor
    // Si falla, mostramos login con demo habilitado y NO continuamos
    // ============================================================
    let configOk = false;
    try {
      configOk = await window.AppConfig?.loadServerConfig?.() || false;
    } catch (e) {
      console.warn('[App] Error al cargar configuración:', e.message);
    }

    // Si la configuración no está disponible, mostrar login y habilitar demo
    if (!configOk) {
      console.warn('[App] Configuración no disponible. Mostrando login con demo.');
      // Asegurar que el overlay esté visible y el botón demo habilitado
      const overlay = document.getElementById('auth-overlay');
      if (overlay) {
        overlay.hidden = false;
        overlay.style.display = 'flex';
      }
      const demoBtn = document.getElementById('auth-demo');
      if (demoBtn) {
        demoBtn.hidden = false;
        demoBtn.disabled = false;
      }
      // No continuar con autenticación
      return;
    }

    // ============================================================
    // PASO 2: Inicializar Store (Supabase) y Auth solo si hay config
    // ============================================================
    try {
      await window.Store?.initSupabase?.();
    } catch (e) {
      console.warn('[App] Error inicializando Store:', e.message);
    }

    try {
      await window.AuthManager?.init?.();
    } catch (e) {
      console.warn('[App] Error inicializando Auth:', e.message);
    }

    try {
      await window.Dashboard?.init?.();
    } catch (e) {
      console.warn('[App] Error inicializando Dashboard:', e.message);
    }

    try {
      await window.DocumentProcessor?.init?.();
    } catch (e) {
      console.warn('[App] Error inicializando DocumentProcessor:', e.message);
    }

    window.Store?.on?.('store:updated', () => window.Dashboard?.syncAndRender?.());
    window.Store?.on?.('store:reset', () => window.Dashboard?.syncAndRender?.());

    initChat();
    window.Dashboard?.syncAndRender?.();
  }

  return { init, navigateTo };
})();

window.App = App;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}