window.APP_STATE = window.APP_STATE || {
  supabase: null,
  currentUser: null,
  isDemo: false
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
          source: 'demo'
        },
        {
          id: 'demo-2',
          text: 'Mi buzón tributario está inactivo',
          intent: 'SALUD_FISCAL',
          confidence: 0.98,
          timestamp: Date.now() - 60000,
          is_fiscal_audit_completed: true,
          source: 'demo'
        }
      ],
      incomeYTD: 95500,
      fiscalMetrics: {
        annualLimit: 3500000,
        riskLevel: 'SEGURO'
      },
      saludFiscal: {
        buzonTributarioActivo: false,
        eFirmaVigente: true,
        alertLevel: 'warning'
      }
    });
  }
};

const AuthManager = (() => {
  let currentUser = null;

  const FISCAL = {
    INCOME_LIMIT: 3500000,
    ALERT_94: 3300000,
    MULTA_BUZON: 10260,
    ART_113E: 'Art. 113-E LISR',
    ART_113F: 'Art. 113-F LISR',
    ART_17K: 'Art. 17-K CFF',
    ART_86C: 'Art. 86-C CFF'
  };

  function getAppEl() {
    return document.getElementById('app');
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
  }

  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;background:#92400e;color:#fff;padding:10px 16px;text-align:center;font-size:13px;font-weight:600;';
    banner.textContent =
      '⚠️ MODO DEMO — Art. 17-K CFF: multa hasta $10,260 MXN por Buzón Tributario inactivo.';
    document.body.prepend(banner);
  }

  function _injectWelcomeMessage() {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl) return;
    if (chatEl.dataset.welcomeInjected === '1') return;
    chatEl.dataset.welcomeInjected = '1';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.textContent =
      `🛡️ Aliado RESICO activo.
${FISCAL.ART_113E}: tu límite anual es $${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN.
Al 94% ($${FISCAL.ALERT_94.toLocaleString('es-MX')} MXN) debes tratarlo como riesgo de expulsión.
${FISCAL.ART_17K}: Buzón Tributario inactivo = multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN y pérdida de plazos; la reincidencia escala el riesgo (${FISCAL.ART_86C}).
${FISCAL.ART_113F}: antes de confirmar anual, se pregunta si hubo ingresos mixtos.
Alerta operativa: la omisión de obligaciones y notificaciones también puede escalar a bloqueo operativo y riesgo sobre sellos digitales.`;
    chatEl.appendChild(bubble);
  }

  function bypassToDemo() {
    window.APP_STATE.isDemo = true;
    _showDemoBanner();
    _showApp(null);
    window.MockData?.load?.(window.Store);
    _injectWelcomeMessage();
    window.Dashboard?.syncAndRender?.();
  }

  async function init() {
    const submitBtn = document.getElementById('auth-submit');
    const demoBtn = document.getElementById('auth-demo');
    const msgEl = document.getElementById('auth-msg');
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const logoutBtn = document.getElementById('logout-btn');
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

      const client = window.APP_STATE?.supabase;
      if (!client) {
        enableDemoButton();
        _showAuthMsg(msgEl, 'Supabase no está listo todavía. Puedes entrar a Demo o reintentar.', true);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Procesando…';
      if (msgEl) msgEl.hidden = true;

      try {
        let result;
        if (isRegister) {
          result = await client.auth.signUp({ email, password: pass });
          if (result.error) throw result.error;
          if (result.data?.user && !result.data?.session) {
            _showAuthMsg(msgEl, 'Cuenta creada. Revisa tu correo para confirmar.', false);
            return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }

        currentUser = result.data.user;
        window.APP_STATE.currentUser = currentUser;
        _showApp(currentUser);
        _injectWelcomeMessage();
        window.Dashboard?.syncAndRender?.();
      } catch (err) {
        const map = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed': 'Confirma tu correo antes de entrar.',
          'User already registered': 'Ese correo ya tiene cuenta.'
        };
        _showAuthMsg(msgEl, map[err.message] || err.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
      })
    );

    demoBtn?.addEventListener('click', bypassToDemo);

    const forgotBtn = document.getElementById('auth-forgot-password');
    forgotBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput?.value?.trim();
      if (!email) {
        _showAuthMsg(msgEl, 'Ingresa tu correo para restablecer tu contraseña.', true);
        return;
      }
      const client = window.APP_STATE?.supabase;
      if (!client) {
        _showAuthMsg(msgEl, 'Supabase no está disponible.', true);
        return;
      }
      forgotBtn.textContent = '⏳ Enviando…';
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/api/auth-callback?next=/`
        });
        if (error) throw error;
        _showAuthMsg(msgEl, 'Correo de recuperación enviado. Revisa tu bandeja de entrada.', false);
      } catch (err) {
        _showAuthMsg(msgEl, err.message, true);
      } finally {
        forgotBtn.textContent = '¿Olvidaste tu contraseña?';
      }
    });

    logoutBtn?.addEventListener('click', async () => {
      try {
        await window.APP_STATE?.supabase?.auth?.signOut();
      } catch (_) {}
      window.Store?.reset?.();
      window.APP_STATE.currentUser = null;
      window.APP_STATE.isDemo = false;
      _showLogin();
    });

    const session = await window.APP_STATE?.supabase?.auth?.getSession?.().catch(() => null);
    const user = session?.data?.session?.user || null;

    if (user) {
      currentUser = user;
      window.APP_STATE.currentUser = user;
      _showApp(user);
      _injectWelcomeMessage();
      window.Dashboard?.syncAndRender?.();
    } else {
      _showLogin();
      enableDemoButton();
    }
  }

  async function isFirstLogin() {
    const user = window.APP_STATE?.currentUser;
    if (!user) return false;
    if (user.user_metadata?.onboarding_completed === true) return false;
    const client = window.APP_STATE?.supabase;
    if (!client) return false;
    try {
      const { data } = await client.from('fiscal_metrics').select('user_id').eq('user_id', user.id).maybeSingle();
      return !data;
    } catch {
      return true;
    }
  }

  async function upsertFiscalMetrics(metrics) {
    const client = window.APP_STATE?.supabase;
    const user = window.APP_STATE?.currentUser;
    if (!client || !user) return;
    const payload = {
      user_id: user.id,
      income_ytd: Number(metrics.incomeYTD || 0),
      total_processed: Number(metrics.totalProcessed || 0),
      avg_confidence: Number(metrics.avgConfidence || 0)
    };
    const { error } = await client.from('fiscal_metrics').upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;
    window.Store?.setState({
      incomeYTD: Number(metrics.incomeYTD || 0)
    });
  }

  async function markOnboardingDone() {
    const client = window.APP_STATE?.supabase;
    const user = window.APP_STATE?.currentUser;
    if (!client || !user) return;
    try {
      await client.auth.updateUser({ data: { onboarding_completed: true } });
    } catch (e) {
      console.warn('Error marking onboarding done:', e);
    }
  }

  return {
    init,
    enableDemoButton,
    bypassToDemo,
    isFirstLogin,
    upsertFiscalMetrics,
    markOnboardingDone
  };
})();

window.AuthManager = AuthManager;