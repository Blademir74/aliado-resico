const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents'];

  function navigateTo(view) {
    const target = VIEWS.includes(view) ? view : 'dashboard';
    document.querySelectorAll('.tab-view').forEach(el => {
      el.hidden = el.id !== `${target}-tab`;
    });
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

  async function init() {
    initTheme();
    initNavigation();
    initRFC();

    // Inicializar módulos
    try { await window.AppConfig?.loadServerConfig?.(); } catch (_) {}
    try { await window.Store?.initSupabase?.(); } catch (_) {}
    try { await window.AuthManager?.init?.(); } catch (_) {}
    try { await window.Dashboard?.init?.(); } catch (_) {}
    try { await window.DocumentProcessor?.init?.(); } catch (_) {}

    // Sincronizar cuando cambie el store
    window.Store?.on?.('store:updated', () => window.Dashboard?.syncAndRender?.());
    window.Store?.on?.('store:reset', () => window.Dashboard?.syncAndRender?.());

    // Inicializar el chat (classifier)
    const classifier = window.IntentClassifier;
    if (classifier) {
      const form = document.getElementById('classifier-form');
      const input = document.getElementById('classifier-input');
      const chat = document.getElementById('chat-messages');
      if (form && input && chat) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = input.value.trim();
          if (!text) return;
          // Añadir burbuja usuario
          const userBubble = document.createElement('div');
          userBubble.className = 'chat-bubble user';
          userBubble.textContent = text;
          chat.appendChild(userBubble);
          input.value = '';
          chat.scrollTop = chat.scrollHeight;
          try {
            const cls = await classifier.process(text);
            // Mostrar análisis
            const empty = document.getElementById('classification-empty');
            const content = document.getElementById('classification-content');
            if (empty) empty.hidden = true;
            if (content) content.hidden = false;
            document.getElementById('result-intent').textContent = `${CATEGORY_CONFIG[cls.intent]?.icon || '💬'} ${CATEGORY_CONFIG[cls.intent]?.label || cls.intent}`;
            document.getElementById('result-confidence-val').textContent = `${Math.round(cls.confidence*100)}%`;
            document.getElementById('result-keywords').textContent = (cls.keywords_matched || []).join(', ') || '—';
            document.getElementById('result-source').textContent = cls.source === 'gemini_proxy' ? 'Gemini IA' : 'Reglas locales';
            // Respuesta del bot
            const botBubble = document.createElement('div');
            botBubble.className = 'chat-bubble bot';
            botBubble.textContent = cls.assistant_reply || 'Consulta recibida.';
            chat.appendChild(botBubble);
            chat.scrollTop = chat.scrollHeight;
            // Guardar en store
            window.Store?.addConversation?.({ text, intent: cls.intent, confidence: cls.confidence, is_fiscal_audit_completed: cls.intent === 'SALUD_FISCAL' });
            // Actualizar dashboard
            window.Dashboard?.syncAndRender?.();
          } catch (err) {
            const errBubble = document.createElement('div');
            errBubble.className = 'chat-bubble bot';
            errBubble.textContent = 'Error: ' + err.message;
            chat.appendChild(errBubble);
          }
        });
        // Quick asks
        document.querySelectorAll('.quick-ask').forEach(btn => {
          btn.addEventListener('click', () => {
            input.value = btn.getAttribute('data-prompt') || '';
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          });
        });
      }
    }

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