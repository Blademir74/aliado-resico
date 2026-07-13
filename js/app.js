const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents'];

  function navigateTo(view) {
    const target = VIEWS.includes(view) ? view : 'dashboard';
    document.querySelectorAll('.tab-view').forEach(el => el.hidden = true);
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

  // ============================================================
  // FLUJO PRINCIPAL: Configuración → Autenticación → Dashboard
  // ============================================================
  async function init() {
    initTheme();
    initNavigation();
    initRFC();

    // 1. MOSTRAR OVERLAY DE LOGIN POR DEFECTO (estable)
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
    }
    const app = document.getElementById('app');
    if (app) {
      app.hidden = true;
      app.style.display = 'none';
    }
    // Asegurar que el botón demo esté visible pero deshabilitado inicialmente
    const demoBtn = document.getElementById('auth-demo');
    if (demoBtn) {
      demoBtn.hidden = false;
      demoBtn.disabled = true; // se habilitará si falla la configuración
    }

    // 2. CARGAR CONFIGURACIÓN DEL SERVIDOR
    let configOk = false;
    try {
      configOk = await window.AppConfig?.loadServerConfig?.() || false;
    } catch (e) {
      console.warn('[App] Error al cargar configuración:', e.message);
    }

    // 3. Si la configuración falla, habilitar demo y detener flujo de autenticación
    if (!configOk) {
      console.warn('[App] Configuración no disponible. Modo Demo habilitado.');
      if (demoBtn) demoBtn.disabled = false;
      // Mostrar mensaje en el overlay
      const msgEl = document.getElementById('auth-msg');
      if (msgEl) {
        msgEl.hidden = false;
        msgEl.textContent = '⚠️ Servicio de autenticación no disponible. Usa "Ver Demo" para explorar.';
        msgEl.style.color = '#f59e0b';
      }
      return; // No continuar con autenticación
    }

    // 4. Configuración OK: Inicializar Supabase y Auth
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

    // 5. Inicializar módulos del dashboard
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

    // 6. Sincronizar eventos
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