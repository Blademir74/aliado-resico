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
  let _authInitialized = false;   // Flag para evitar múltiples inicializaciones
  let _isChecking = false;        // Bloqueo de ejecución concurrente
  let sessionCheckResolve = null;
  let sessionCheckPromise = new Promise(resolve => { sessionCheckResolve = resolve; });

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
    const loader = document.getElementById('auth-loader');

    if (loader) loader.style.display = 'none';
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
    const loader = document.getElementById('auth-loader');

    if (loader) loader.style.display = 'none';
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
      `⚠️ MODO DEMO — ${FISCAL.ART_17K}: multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN por Buzón Tributario inactivo.`;
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

📘 **Educación fiscal**:
- El ISR en RESICO se calcula sobre ingresos brutos, sin deducciones de gastos.
- El IVA solo es acreditable si cuentas con CFDI válido que acredite el gasto indispensable.`;
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

  // --- Métodos de sesión estabilizados ---
  async function checkSession() {
    // Si ya está inicializado, no repetir
    if (_authInitialized) {
      console.log('[Auth] Sesión ya verificada, omitiendo checkSession');
      return true;
    }

    // Evitar ejecuciones concurrentes
    if (_isChecking) {
      console.log('[Auth] checkSession ya en ejecución, esperando...');
      await sessionCheckPromise;
      return _authInitialized;
    }

    _isChecking = true;
    const loader = document.getElementById('auth-loader');
    if (loader) loader.style.display = 'block';

    try {
      const client = window.APP_STATE?.supabase;
      // Verificar si Supabase está configurado
      const url = window.AppConfig?.getSupabaseUrl?.() || '';
      const key = window.AppConfig?.getSupabaseKey?.() || '';

      if (!url || !key || !client) {
        console.warn('[Auth] Supabase no configurado, mostrando login con demo');
        _showLogin();
        enableDemoButton();
        if (loader) loader.style.display = 'none';
        _authInitialized = true;
        _isChecking = false;
        sessionCheckResolve(false);
        return false;
      }

      // Validar sesión con getUser() (token validado en servidor)
      const { data, error } = await client.auth.getUser();
      if (error || !data?.user) {
        // Token inválido o expirado: limpiar sesión local
        await client.auth.signOut().catch(() => {});
        _showLogin();
        enableDemoButton();
        if (loader) loader.style.display = 'none';
        _authInitialized = true;
        _isChecking = false;
        sessionCheckResolve(false);
        return false;
      }

      const user = data.user;
      currentUser = user;
      window.APP_STATE.currentUser = user;
      _showApp(user);
      _injectWelcomeMessage();
      window.Dashboard?.syncAndRender?.();
      if (loader) loader.style.display = 'none';
      _authInitialized = true;
      _isChecking = false;
      sessionCheckResolve(true);
      return true;
    } catch (err) {
      console.warn('[Auth] checkSession error:', err.message);
      // En caso de error, mostrar login y habilitar demo
      const client = window.APP_STATE?.supabase;
      if (client) await client.auth.signOut().catch(() => {});
      _showLogin();
      enableDemoButton();
      if (loader) loader.style.display = 'none';
      _authInitialized = true;
      _isChecking = false;
      sessionCheckResolve(false);
      return false;
    }
  }

  async function refreshSession() {
    const client = window.APP_STATE?.supabase;
    if (!client) return null;
    try {
      const { data, error } = await client.auth.refreshSession();
      if (error) throw error;
      const user = data?.user || null;
      if (user) {
        currentUser = user;
        window.APP_STATE.currentUser = user;
      }
      return user;
    } catch (e) {
      console.warn('[Auth] refreshSession failed:', e.message);
      return null;
    }
  }

  // --- Inicialización principal (única llamada) ---
  async function init() {
    // Si ya está inicializado, no hacer nada
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado, omitiendo init');
      return;
    }

    const submitBtn = document.getElementById('auth-submit');
    const demoBtn = document.getElementById('auth-demo');
    const msgEl = document.getElementById('auth-msg');
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const logoutBtn = document.getElementById('logout-btn');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    if (!submitBtn) {
      console.warn('[Auth] No se encontró el botón de submit');
      return;
    }

    let isRegister = false;

    // Eventos de pestañas
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

    // Envío del formulario
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
        _showAuthMsg(msgEl, 'Supabase no está listo. Puedes entrar a Demo.', true);
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
        _authInitialized = true; // Marcar como inicializado después de login exitoso
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

    // Enter en los campos
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
      })
    );

    // Botón demo
    demoBtn?.addEventListener('click', bypassToDemo);

    // Olvidé contraseña
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

    // Logout
    logoutBtn?.addEventListener('click', async () => {
      try {
        await window.APP_STATE?.supabase?.auth?.signOut();
      } catch (_) {}
      window.Store?.reset?.();
      window.APP_STATE.currentUser = null;
      window.APP_STATE.isDemo = false;
      _authInitialized = false; // Resetear para permitir nuevo login
      _showLogin();
      enableDemoButton();
    });

    // Iniciar verificación de sesión (solo una vez)
    await checkSession();
  }

  // Exponer métodos
  return {
    init,
    checkSession,
    refreshSession,
    enableDemoButton,
    bypassToDemo,
    sessionCheckPromise,
    // Para depuración (pero sin exponer claves)
    isInitialized: () => _authInitialized
  };
})();

window.AuthManager = AuthManager;