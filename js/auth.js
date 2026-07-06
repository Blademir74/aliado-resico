/* ============================================
   ALIADO RESICO — Auth v5.0
   Demo robusto, sin dependencia dura de Dashboard/MockData
   ============================================ */

window.APP_STATE = window.APP_STATE || { supabase: null, currentUser: null, isDemo: false };
window.Dashboard = window.Dashboard || {
  syncAndRender() {
    try {
      const state = window.Store?.getState?.();
      const summary = document.getElementById('monthly-summary');
      if (summary && state) {
        summary.textContent = `Ingresos acumulados 2026: $${Number(state.incomeYTD || 0).toLocaleString('es-MX')} MXN · Riesgo: ${state.fiscalMetrics?.riskLevel || 'SEGURO'}`;
      }
    } catch (_) {}
  }
};

window.MockData = window.MockData || {
  load(store) {
    store?.setState({
      conversations: [
        {
          id: 'demo-1',
          text: '¿Estoy cerca del límite de RESICO?',
          intent: 'CONSULTA_FISCAL',
          confidence: 0.96,
          timestamp: Date.now(),
          is_fiscal_audit_completed: true,
          source: 'demo',
        },
        {
          id: 'demo-2',
          text: 'Recuerda activar el Buzón Tributario.',
          intent: 'SALUD_FISCAL',
          confidence: 0.98,
          timestamp: Date.now() - 60000,
          is_fiscal_audit_completed: true,
          source: 'demo',
        },
      ],
      incomeYTD: 95500,
      fiscalMetrics: {
        annualLimit: 3500000,
        riskLevel: 'SEGURO',
      },
      saludFiscal: {
        buzonTributarioActivo: false,
        eFirmaVigente: true,
        alertLevel: 'warning',
      },
    });
  }
};

const AuthManager = (() => {
  let currentUser = null;
  let authSubReady = false;

  const FISCAL = {
    YEAR: 2026,
    INCOME_LIMIT: 3500000,
    ALERT_94: 3290000,
    MULTA_BUZON: 10260,
    ART_113E: 'Art. 113-E LISR',
    ART_113F: 'Art. 113-F LISR',
    ART_17K: 'Art. 17-K CFF',
    ART_86C: 'Art. 86-C CFF',
  };

  function getAppEl() {
    return document.getElementById('app') || document.getElementById('app-container');
  }

  function removeGuard() {
    const guard = document.getElementById('auth-guard-css');
    if (guard) guard.remove();
  }

  function _showApp(user) {
    removeGuard();

    const overlay = document.getElementById('auth-overlay');
    const app = getAppEl();
    const chip = document.getElementById('user-chip');
    const emailEl = document.getElementById('user-email-display');
    const logoutEl = document.getElementById('logout-btn');

    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = 'none';
    }

    if (app) {
      app.hidden = false;
      app.style.display = '';
    }

    if (chip) chip.hidden = false;
    if (emailEl) emailEl.textContent = user?.email || 'Modo Demo';
    if (logoutEl) logoutEl.hidden = false;
  }

  function _showLogin() {
    const overlay = document.getElementById('auth-overlay');
    const app = getAppEl();
    const chip = document.getElementById('user-chip');
    const logoutEl = document.getElementById('logout-btn');

    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
    }

    if (app) {
      app.hidden = true;
      app.style.display = 'none';
    }

    if (chip) chip.hidden = true;
    if (logoutEl) logoutEl.hidden = true;
  }

  function _showAuthMsg(el, text, isError) {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.className = isError ? 'auth-msg error' : 'auth-msg success';
  }

  function enableDemoButton() {
    const btn = document.getElementById('auth-demo');
    if (!btn) return;
    btn.disabled = false;
    btn.hidden = false;
    btn.style.pointerEvents = 'auto';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }

  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#92400e;color:#fff;padding:10px 16px;text-align:center;font-size:13px;font-weight:600;';
    banner.innerHTML = '⚠️ MODO DEMO — Datos ficticios · Art. 17-K CFF: multa hasta $10,260 MXN por Buzón Tributario inactivo.';
    document.body.prepend(banner);
  }

  function _injectWelcomeMessage(isDemo) {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl) return;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.innerHTML = `
      <div>
        <strong>Aliado RESICO ${FISCAL.YEAR}</strong>${isDemo ? ' · MODO DEMO' : ''}<br>
        ${FISCAL.ART_113E}: límite anual $${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN.<br>
        Al 94% ($${FISCAL.ALERT_94.toLocaleString('es-MX')} MXN) se activa alerta de expulsión.<br>
        ${FISCAL.ART_17K}: Buzón inactivo = multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN.<br>
        Reincidencia duplica el monto (${FISCAL.ART_86C}).<br>
        ${FISCAL.ART_113F}: antes de confirmar declaración anual, pregunta por ingresos mixtos.
      </div>
    `;
    chatEl.appendChild(bubble);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function _activateDemo() {
    window.APP_STATE.isDemo = true;
    currentUser = { id: 'demo-user', email: 'demo@aliadoresico.com' };
    window.APP_STATE.currentUser = currentUser;

    _showDemoBanner();
    _showApp(null);

    if (window.MockData?.load) {
      window.MockData.load(window.Store);
    }

    setTimeout(() => {
      window.Dashboard?.syncAndRender?.();
      window.App?.initMonthlyTracker?.();
    }, 50);

    _injectWelcomeMessage(true);
  }

  function bypassToDemo() {
    _activateDemo();
  }

  function _postLoginInit() {
    window.APP_STATE.isDemo = false;
    window.APP_STATE.currentUser = currentUser;

    setTimeout(() => {
      window.Dashboard?.syncAndRender?.();
      window.App?.initMonthlyTracker?.();
    }, 50);

    _injectWelcomeMessage(false);
  }

  function _wireLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (!logoutBtn || logoutBtn._wiredLogout) return;

    logoutBtn._wiredLogout = true;
    logoutBtn.addEventListener('click', async () => {
      try {
        await window.APP_STATE?.supabase?.auth?.signOut?.();
      } catch (_) {}

      document.getElementById('demo-banner')?.remove();

      if (window.Store?.reset) window.Store.reset();
      window.APP_STATE.currentUser = null;
      window.APP_STATE.isDemo = false;
      currentUser = null;

      _showLogin();
    });
  }

  function _subscribeAuthChanges(client) {
    if (!client || authSubReady) return;
    authSubReady = true;

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        currentUser = session.user;
        _showApp(currentUser);
        _postLoginInit();
      }
      if (event === 'SIGNED_OUT') {
        _showLogin();
      }
    });
  }

  function _wireAuthForm() {
    if (_wireAuthForm._wired) return;
    _wireAuthForm._wired = true;

    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const submitBtn = document.getElementById('auth-submit');
    const msgEl = document.getElementById('auth-msg');
    const demoBtn = document.getElementById('auth-demo');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    if (!submitBtn) return;

    let isRegister = false;

    tabLogin?.addEventListener('click', () => {
      isRegister = false;
      tabLogin.classList.add('active');
      tabRegister?.classList.remove('active');
      submitBtn.textContent = '🔐 Iniciar Sesión';
      if (msgEl) msgEl.hidden = true;
    });

    tabRegister?.addEventListener('click', () => {
      isRegister = true;
      tabRegister.classList.add('active');
      tabLogin?.classList.remove('active');
      submitBtn.textContent = '✅ Crear Cuenta';
      if (msgEl) msgEl.hidden = true;
    });

    submitBtn.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass = passInput?.value;

      if (!email || !pass) {
        _showAuthMsg(msgEl, 'Ingresa tu correo y contraseña.', true);
        return;
      }

      let client = window.APP_STATE?.supabase;
      if (!client && window.Store?.initSupabase) {
        client = await window.Store.initSupabase();
      }

      if (!client) {
        enableDemoButton();
        _showAuthMsg(msgEl, 'Sin conexión al servidor. Usa el botón "Ver Demo" para continuar.', true);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Procesando…';

      try {
        let result;
        if (isRegister) {
          result = await client.auth.signUp({ email, password: pass });
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
        }

        if (result.error) throw result.error;

        currentUser = result.data?.user || result.data?.session?.user || null;
        window.APP_STATE.currentUser = currentUser;
        _showApp(currentUser);
        _postLoginInit();
      } catch (err) {
        _showAuthMsg(msgEl, err.message || 'No se pudo autenticar.', true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    [emailInput, passInput].forEach(el => {
      el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
      });
    });

    demoBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      _activateDemo();
    });

    enableDemoButton();
  }

  async function init() {
    _wireAuthForm();
    _wireLogout();

    let client = window.APP_STATE?.supabase;
    if (!client && window.Store?.initSupabase) {
      client = await window.Store.initSupabase();
    }

    if (!client) {
      console.warn('[Auth] Supabase no disponible — habilitando Demo de emergencia.');
      enableDemoButton();
      _showLogin();
      return;
    }

    try {
      const { data } = await client.auth.getSession();
      const sessionUser = data?.session?.user || null;

      if (sessionUser) {
        currentUser = sessionUser;
        window.APP_STATE.currentUser = currentUser;
        _showApp(currentUser);
        _postLoginInit();
      } else {
        _showLogin();
      }

      _subscribeAuthChanges(client);
    } catch (e) {
      console.warn('[Auth] getSession:', e.message);
      enableDemoButton();
      _showLogin();
    }
  }

  function getUserId() {
    return currentUser?.id || window.APP_STATE?.currentUser?.id || null;
  }

  return {
    init,
    enableDemoButton,
    bypassToDemo,
    getUserId,
  };
})();

window.AuthManager = AuthManager;