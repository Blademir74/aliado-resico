const App = (() => {
  const VIEWS = ['dashboard', 'classifier', 'documents'];

  function navigateTo(view) {
    const target = VIEWS.includes(view) ? view : 'dashboard';
    document.querySelectorAll('.tab-view').forEach(el => { el.hidden = el.id !== `${target}-tab`; });
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === target);
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

  function validateRFC(raw) {
    const RFCGEN = ['XAXX010101000', 'XEXX010101000'];
    const rfc = String(raw || '').trim().toUpperCase();
    if (!rfc) return { valid: false, error: 'Ingresa un RFC.' };
    if (RFCGEN.includes(rfc)) return { valid: true, type: 'RFC Genérico', rfc };

    const pf = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;
    const pm = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;

    if (!pf.test(rfc) && !pm.test(rfc)) return { valid: false, error: 'Formato inválido.' };
    return { valid: true, type: pf.test(rfc) ? 'Persona Física' : 'Persona Moral', rfc };
  }

  function initRFC() {
    const btn = document.getElementById('rfc-validate-btn');
    const inp = document.getElementById('rfc-input');
    const out = document.getElementById('rfc-result');
    if (!btn || !inp || !out) return;

    const run = () => {
      const res = validateRFC(inp.value);
      out.innerHTML = res.valid
        ? `<div class="auth-msg success">${res.type}: <code>${res.rfc}</code></div>`
        : `<div class="auth-msg error">${res.error}</div>`;
    };

    btn.addEventListener('click', run);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  }

  function updateResultPanel(cls) {
    const empty = document.getElementById('classification-empty');
    const content = document.getElementById('classification-content');
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;

    const intent = document.getElementById('result-intent');
    if (intent) intent.textContent = `${window.CATEGORY_CONFIG?.[cls.intent]?.icon || '💬'} ${window.CATEGORY_CONFIG?.[cls.intent]?.label || cls.intent}`;

    const pct = Math.round(Number(cls.confidence || 0) * 100);
    const bar = document.getElementById('result-confidence-bar');
    const val = document.getElementById('result-confidence-val');
    if (bar) bar.style.width = `${pct}%`;
    if (val) val.textContent = `${pct}%`;

    const kw = document.getElementById('result-keywords');
    if (kw) kw.textContent = (cls.keywords_matched || []).join(', ') || '—';

    const src = document.getElementById('result-source');
    if (src) src.textContent = cls.source === 'gemini_proxy' ? 'Gemini IA' : 'Reglas locales';

    const ctx = document.getElementById('result-resico-context');
    if (ctx) {
      ctx.hidden = !cls.resico_context;
      ctx.textContent = cls.resico_context || '';
    }

    const salud = document.getElementById('result-salud-alerta');
    if (salud) {
      salud.hidden = !cls.salud_fiscal_alerta;
      salud.textContent = cls.salud_fiscal_alerta || '';
    }
  }

  function initChat() {
    const form = document.getElementById('classifier-form');
    const input = document.getElementById('classifier-input');
    const chat = document.getElementById('chat-messages');

    if (!form || !input || !chat) return;

    const addBubble = (role, text) => {
      const div = document.createElement('div');
      div.className = `chat-bubble ${role}`;
      div.textContent = text;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      addBubble('user', text);
      input.value = '';

      try {
        const cls = await window.IntentClassifier.process(text);
        updateResultPanel(cls);

        const botText = [
          cls.assistant_reply || 'Consulta recibida.',
          cls.resico_context ? `Contexto: ${cls.resico_context}` : '',
          cls.salud_fiscal_alerta || ''
        ].filter(Boolean).join('\n\n');

        addBubble('bot', botText || 'Consulta recibida.');
        window.Store?.addConversation?.({
          text,
          intent: cls.intent || 'OTROS',
          confidence: Number(cls.confidence || 0.5),
          is_fiscal_audit_completed: cls.intent === 'SALUD_FISCAL',
          source: cls.source || 'local'
        });

        if (/cobr[eé]|me pagaron|recibi pago|ingreso|transferencia|dep[oó]sito/i.test(text)) {
          const match = text.match(/([\d,]+(?:\.\d{1,2})?)/);
          if (match) {
            const amount = Number(match[1].replace(/,/g, ''));
            if (Number.isFinite(amount) && amount > 0) {
              const current = Number(window.Store?.getState?.().incomeYTD || 0);
              window.Store?.updateIncome?.(current + amount);
            }
          }
        }

        window.Dashboard?.syncAndRender?.();
      } catch (err) {
        addBubble('bot', err.message || 'Error al procesar consulta.');
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

    try { await window.AppConfig?.loadServerConfig?.(); } catch (_) {}
    try { await window.Store?.initSupabase?.(); } catch (_) {}
    try { await window.AuthManager?.init?.(); } catch (_) {}
    try { await window.Dashboard?.init?.(); } catch (_) {}
    try { await window.DocumentProcessor?.init?.(); } catch (_) {}

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