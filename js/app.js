const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents'];
  let _booted = false;

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
    const navBtns = document.querySelectorAll('.nav-btn[data-tab]');
    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        navigateTo(tab);
      });
    });

    const initial = (window.location.hash || '').replace('#', '');
    navigateTo(initial || 'dashboard');
  }

  function classifyRFC(rfc) {
    const clean = String(rfc || '').trim().toUpperCase();
    const genericNational = 'XAXX010101000';
    const genericForeign = 'XEXX010101000';

    if (!clean) {
      return { ok: false, message: 'Ingresa un RFC.' };
    }

    if (clean === genericNational) {
      return {
        ok: true,
        type: 'GENÉRICO NACIONAL',
        message: `RFC válido: ${clean}`,
        detail: 'Uso general en operaciones con público en general.'
      };
    }

    if (clean === genericForeign) {
      return {
        ok: true,
        type: 'GENÉRICO EXTRANJERO',
        message: `RFC válido: ${clean}`,
        detail: 'Uso para operaciones con residentes en el extranjero.'
      };
    }

    const pf = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;
    const pm = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;

    if (pf.test(clean)) {
      return {
        ok: true,
        type: 'PERSONA FÍSICA',
        message: `RFC válido: ${clean}`,
        detail: `Estructura detectada: 4 letras + fecha + homoclave.`
      };
    }

    if (pm.test(clean)) {
      return {
        ok: true,
        type: 'PERSONA MORAL',
        message: `RFC válido: ${clean}`,
        detail: `Estructura detectada: 3 letras + fecha + homoclave.`
      };
    }

    return { ok: false, message: 'Formato inválido.' };
  }

  function initRFC() {
    const btn = document.getElementById('rfc-validate-btn');
    const inp = document.getElementById('rfc-input');
    const out = document.getElementById('rfc-result');
    if (!btn || !inp || !out) return;

    const validate = () => {
      const result = classifyRFC(inp.value);
      if (!result.ok) {
        out.innerHTML = `<div style="color:#ef4444">${result.message}</div>`;
        return;
      }

      out.innerHTML = `
        <div style="color:#10b981;font-weight:600">${result.message}</div>
        <div style="color:#e2e8f0;margin-top:6px">${result.type}</div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px">${result.detail || ''}</div>
      `;
    };

    btn.addEventListener('click', validate);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') validate();
    });
  }

  function getCategoryMeta(intent) {
    const map = window.CATEGORY_CONFIG || window.CATEGORYCONFIG || {};
    return (
      map[intent] ||
      map[String(intent || '').replaceAll('_', '')] ||
      map[String(intent || '').replace(/_/g, '')] ||
      { icon: '🧠', label: intent || 'Consulta General' }
    );
  }

  function appendBubble(chat, role, text) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;
    chat.appendChild(bubble);
    chat.scrollTop = chat.scrollHeight;
    return bubble;
  }

  function renderClassifierSide(cls) {
    const empty = document.getElementById('classification-empty');
    const content = document.getElementById('classification-content');
    const intentEl = document.getElementById('result-intent');
    const confVal = document.getElementById('result-confidence-val');
    const kwEl = document.getElementById('result-keywords');
    const srcEl = document.getElementById('result-source');

    if (empty) empty.hidden = true;
    if (content) content.hidden = false;

    const cat = getCategoryMeta(cls.intent);

    if (intentEl) {
      intentEl.textContent = `${cat.icon || '🧠'} ${cat.label || cls.intent}`;
    }

    if (confVal) {
      confVal.textContent = `${Math.round(Number(cls.confidence || 0) * 100)}%`;
    }

    if (kwEl) {
      kwEl.textContent = Array.isArray(cls.keywordsMatched) && cls.keywordsMatched.length
        ? cls.keywordsMatched.join(', ')
        : 'Sin coincidencias directas';
    }

    if (srcEl) {
      srcEl.textContent =
        cls.source === 'gemini-proxy'
          ? 'Gemini IA'
          : cls.source === 'local-fallback'
          ? 'Fallback local'
          : (cls.source || 'Desconocida');
    }
  }

  function initChat() {
    const form = document.getElementById('classifier-form');
    const input = document.getElementById('classifier-input');
    const chat = document.getElementById('chat-messages');
    const submitBtn = document.getElementById('classifier-submit');

    if (!form || !input || !chat) {
      console.warn('[App] Chat elements not found');
      return;
    }

    if (form.dataset.bound === '1') return;
    form.dataset.bound = '1';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      appendBubble(chat, 'user', text);
      input.value = '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Analizando...';
      }

      try {
        if (!window.IntentClassifier?.process) {
          throw new Error('Clasificador no disponible');
        }

        const cls = await window.IntentClassifier.process(text);
        renderClassifierSide(cls);

        const reply =
          String(cls?.assistantReply || '').trim() ||
          'No pude generar una respuesta completa en este momento.';

        appendBubble(chat, 'bot', reply);

        window.Store?.addConversation?.({
          message_text: text,
          text,
          intent: cls.intent || 'OTROS',
          confidence: Number(cls.confidence || 0),
          is_fiscal_audit_completed: (cls.intent || '') === 'SALUD_FISCAL'
        });

        window.Dashboard?.syncAndRender?.();
      } catch (err) {
        console.error('[App] Error en chat:', err);
        appendBubble(chat, 'bot', `Error: ${err.message}`);
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Enviar';
        }
      }
    });

    document.querySelectorAll('.quick-ask').forEach(btn => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-prompt') || '';
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    });
  }

  function bootAuthenticatedArea() {
    if (_booted) return;
    _booted = true;

    initTheme();
    initNavigation();
    initRFC();
    initChat();

    window.APP_STATE = window.APP_STATE || {};
    window.APP_STATE.appReady = true;
  }

  async function init() {
    const overlay = document.getElementById('auth-overlay');
    const app = document.getElementById('app');
    const demoBtn = document.getElementById('auth-demo');

    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
    }

    if (app) {
      app.hidden = true;
      app.style.display = 'none';
    }

    if (demoBtn) {
      demoBtn.hidden = false;
      demoBtn.disabled = true;
    }

    let configOk = false;

    try {
      configOk = await window.AppConfig?.loadServerConfig?.();
    } catch (e) {
      console.warn('[App] Error al cargar configuración:', e.message);
    }

    if (!configOk) {
      if (demoBtn) demoBtn.disabled = false;

      const msgEl = document.getElementById('auth-msg');
      if (msgEl) {
        msgEl.hidden = false;
        msgEl.textContent = 'Servicio de autenticación no disponible. Usa "Ver Demo" para explorar.';
        msgEl.className = 'auth-msg warning';
        msgEl.style.color = '#f59e0b';
      }
      return;
    }

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
  }

  return {
    init,
    navigateTo,
    bootAuthenticatedArea
  };
})();

window.App = App;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}