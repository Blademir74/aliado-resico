window.APP_STATE = window.APP_STATE || {
  supabase: null,
  currentUser: null,
  isDemo: false,
  authInitialized: false,
  authError: null
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
  let _authInitialized = false;
  let _initializing = false;
  let _initPromise = null;
  let isRegister = false;

  const FISCAL = {
    INCOME_LIMIT: 3500000,
    ALERT_94: 3300000,
    MULTA_BUZON: 10260,
    ART_113E: 'Art. 113-E LISR',
    ART_113F: 'Art. 113-F LISR',
    ART_17K: 'Art. 17-K CFF',
    ART_86C: 'Art. 86-C CFF'
  };

  // --- DOM helpers ---
  function getAppEl() { return document.getElementById('app'); }

  function removeGuard() {
    const guard = document.getElementById('auth-guard-css');
    if (guard) guard.remove();
  }

  function _setOverlayState(visible, message, isError = false) {
    const overlay = document.getElementById('auth-overlay');
    const msg = document.getElementById('auth-msg');
    const loader = document.getElementById('auth-loader');
    const demoBtn = document.getElementById('auth-demo');

    if (!overlay) return;

    if (visible) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
      if (msg) {
        msg.hidden = false;
        msg.textContent = message || '🔒 Verificando Bóveda Fiscal...';
        msg.className = isError ? 'auth-msg error' : 'auth-msg info';
        msg.style.color = isError ? '#ef4444' : '#f59e0b';
      }
      if (loader) loader.style.display = 'none';
      if (demoBtn) {
        demoBtn.disabled = !isError;
        demoBtn.hidden = false;
      }
    } else {
      overlay.hidden = true;
      overlay.style.display = 'none';
      if (msg) { msg.hidden = true; msg.textContent = ''; }
      if (loader) loader.style.display = 'none';
    }
  }

  function _showApp(user) {
    removeGuard();
    _setOverlayState(false);
    const app = getAppEl();
    if (app) {
      app.hidden = false;
      app.style.display = '';
      void app.offsetHeight;
    }
    const chip = document.getElementById('user-chip');
    const emailEl = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');
    if (chip) chip.hidden = false;
    if (emailEl) emailEl.textContent = user?.email || 'Modo Demo';
    if (logoutBtn) logoutBtn.hidden = false;
    window.APP_STATE.authError = null;
    window.APP_STATE.currentUser = user;
    
    // FORZAR RENDERIZADO DEL DASHBOARD
    if (window.Dashboard?.syncAndRender) {
      setTimeout(() => window.Dashboard.syncAndRender(), 100);
    }
  }

  function _injectWelcomeMessage() {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl || chatEl.dataset.welcomeInjected === '1') return;
    chatEl.dataset.welcomeInjected = '1';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.textContent =
      `🛡️ Aliado RESICO activo.\n\n` +
      `${FISCAL.ART_113E}: tu límite anual es $${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN.\n` +
      `Al 94% ($${FISCAL.ALERT_94.toLocaleString('es-MX')} MXN) debes tratarlo como riesgo de expulsión.\n\n` +
      `⚠️ **ALERTA DE SALUD FISCAL**\n` +
      `${FISCAL.ART_17K}: Buzón Tributario inactivo = multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN y pérdida de plazos; la reincidencia escala el riesgo (${FISCAL.ART_86C}).\n\n` +
      `${FISCAL.ART_113F}: antes de confirmar anual, se pregunta si hubo ingresos mixtos.\n\n` +
      `📘 **Educación fiscal**:\n` +
      `- El ISR en RESICO se calcula sobre ingresos brutos, sin deducciones de gastos.\n` +
      `- El IVA solo es acreditable si cuentas con CFDI válido que acredite el gasto indispensable.`;
    chatEl.appendChild(bubble);
  }

  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#92400e;color:#fff;padding:10px 16px;text-align:center;font-size:13px;font-weight:600;';
    banner.textContent = `⚠️ MODO DEMO — ${FISCAL.ART_17K}: multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN por Buzón Tributario inactivo.`;
    document.body.prepend(banner);
  }

  function bypassToDemo() {
    window.APP_STATE.isDemo = true;
    _showDemoBanner();
    // Cargar datos de mock
    window.MockData?.load?.(window.Store);
    // Mostrar app
    _showApp(null);
    // Inyectar mensaje de bienvenida
    _injectWelcomeMessage();
    // Renderizar dashboard (ya se llama desde _showApp, pero por si acaso)
    if (window.Dashboard?.syncAndRender) {
      setTimeout(() => window.Dashboard.syncAndRender(), 200);
    }
  }

  // ================================================================
  // INICIALIZACIÓN PRINCIPAL CON Promise.all + timeout
  // ================================================================
  async function initialize() {
    if (_authInitialized) return true;
    if (_initializing) return _initPromise;

    _initializing = true;
    _initPromise = (async () => {
      _setOverlayState(true, '🔒 Acceso Restringido - Verificando Bóveda Fiscal...', false);

      const client = window.APP_STATE?.supabase;
      const url = window.AppConfig?.getSupabaseUrl?.() || '';
      const key = window.AppConfig?.getSupabaseKey?.() || '';

      if (!url || !key || !client) {
        console.warn('[Auth] Supabase no configurado. Modo Demo disponible.');
        _setOverlayState(true, '⚠️ Servicio de autenticación no disponible. Usa "Ver Demo".', true);
        const demoBtn = document.getElementById('auth-demo');
        if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
        _authInitialized = true;
        _initializing = false;
        return false;
      }

      try {
        // Timeout para evitar bloqueo eterno
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout al conectar con Supabase')), 8000);
        });

        const [sessionResult, metricsResult] = await Promise.race([
          Promise.all([
            client.auth.getSession(),
            client.from('fiscal_metrics').select('user_id').limit(1)
          ]),
          timeoutPromise.then(() => { throw new Error('Timeout'); })
        ]);

        const { data: sessionData, error: sessionError } = sessionResult;
        if (sessionError || !sessionData?.session) {
          console.warn('[Auth] Sesión no válida:', sessionError?.message);
          _setOverlayState(true, '⚠️ Sesión no válida. Inicia sesión o usa Demo.', true);
          const demoBtn = document.getElementById('auth-demo');
          if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
          _authInitialized = true;
          _initializing = false;
          return false;
        }

        const { error: metricsError } = metricsResult;
        if (metricsError) {
          if (metricsError.code === 'PGRST301' || 
              metricsError.message?.includes('permission denied') ||
              metricsError.status === 403) {
            console.warn('[Auth] Error 403 en fiscal_metrics:', metricsError.message);
            _setOverlayState(true, '⚠️ Error de Autorización: No tienes permisos para acceder a tu Bóveda Fiscal. Contacta a soporte.', true);
          } else {
            console.warn('[Auth] Error consultando fiscal_metrics:', metricsError.message);
            _setOverlayState(true, '⚠️ Error al conectar con Bóveda Fiscal. Contacta a soporte.', true);
          }
          const demoBtn = document.getElementById('auth-demo');
          if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
          _authInitialized = true;
          _initializing = false;
          return false;
        }

        const user = sessionData.session.user;
        currentUser = user;
        window.APP_STATE.currentUser = user;
        _showApp(user);
        _injectWelcomeMessage();
        // Dashboard se renderiza desde _showApp
        _authInitialized = true;
        _initializing = false;
        return true;

      } catch (err) {
        console.warn('[Auth] Error en inicialización:', err.message);
        _setOverlayState(true, '⚠️ Error crítico. Contacta a soporte o usa Demo.', true);
        const demoBtn = document.getElementById('auth-demo');
        if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
        _authInitialized = true;
        _initializing = false;
        return false;
      }
    })();

    return _initPromise;
  }

  // ================================================================
  // CONFIGURACIÓN DE EVENTOS DE AUTENTICACIÓN
  // ================================================================
  function bindEvents() {
    const submitBtn = document.getElementById('auth-submit');
    const demoBtn = document.getElementById('auth-demo');
    const msgEl = document.getElementById('auth-msg');
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const logoutBtn = document.getElementById('logout-btn');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const forgotBtn = document.getElementById('auth-forgot-password');

    if (!submitBtn) {
      console.warn('[Auth] Botón de submit no encontrado');
      return;
    }

    // Tabs login/register
    tabLogin?.addEventListener('click', () => {
      isRegister = false;
      tabLogin.classList.add('active');
      tabRegister?.classList.remove('active');
      submitBtn.textContent = '🔐 Iniciar Sesión';
      if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
    });

    tabRegister?.addEventListener('click', () => {
      isRegister = true;
      tabRegister.classList.add('active');
      tabLogin?.classList.remove('active');
      submitBtn.textContent = '✅ Crear Cuenta';
      if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
    });

    // Submit login/register
    submitBtn.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass = passInput?.value;
      if (!email || !pass) {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = 'Ingresa correo y contraseña.';
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
        return;
      }
      const client = window.APP_STATE?.supabase;
      if (!client) {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = 'Servicio no disponible. Usa Demo.';
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Procesando...';
      if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
      try {
        let result;
        if (isRegister) {
          result = await client.auth.signUp({ email, password: pass });
          if (result.error) throw result.error;
          if (result.data?.user && !result.data?.session) {
            if (msgEl) {
              msgEl.hidden = false;
              msgEl.textContent = 'Cuenta creada. Revisa tu correo para confirmar.';
              msgEl.className = 'auth-msg success';
              msgEl.style.color = '#10b981';
            }
            submitBtn.disabled = false;
            submitBtn.textContent = '✅ Crear Cuenta';
            return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }
        // Login exitoso
        currentUser = result.data.user;
        window.APP_STATE.currentUser = currentUser;
        // Ejecutar inicialización completa (verifica RLS)
        const success = await initialize();
        if (!success) {
          // Si falla, mostramos error pero no ocultamos el overlay
          if (msgEl) {
            msgEl.hidden = false;
            msgEl.textContent = 'No se pudo acceder a tu Bóveda Fiscal. Intenta con Demo.';
            msgEl.className = 'auth-msg error';
            msgEl.style.color = '#ef4444';
          }
          // Habilitar demo
          const demoBtn = document.getElementById('auth-demo');
          if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
        }
      } catch (err) {
        const map = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed': 'Confirma tu correo antes de entrar.',
          'User already registered': 'Ese correo ya tiene cuenta.'
        };
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = map[err.message] || err.message;
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    // Enter key en inputs
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
      })
    );

    // Botón Demo
    demoBtn?.addEventListener('click', bypassToDemo);

    // Olvidé contraseña
    forgotBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput?.value?.trim();
      if (!email) {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = 'Ingresa tu correo para restablecer.';
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
        return;
      }
      const client = window.APP_STATE?.supabase;
      if (!client) {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = 'Servicio no disponible.';
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
        return;
      }
      forgotBtn.textContent = '⏳ Enviando...';
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/api/auth-callback?next=/`
        });
        if (error) throw error;
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = 'Correo de recuperación enviado. Revisa tu bandeja.';
          msgEl.className = 'auth-msg success';
          msgEl.style.color = '#10b981';
        }
      } catch (err) {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = err.message;
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
      } finally {
        forgotBtn.textContent = '¿Olvidaste tu contraseña?';
      }
    });

    // Logout
    logoutBtn?.addEventListener('click', async () => {
      const client = window.APP_STATE?.supabase;
      if (client) await client.auth.signOut();
      window.Store?.reset?.();
      window.APP_STATE.currentUser = null;
      window.APP_STATE.isDemo = false;
      _authInitialized = false;
      const app = getAppEl();
      if (app) { app.hidden = true; app.style.display = 'none'; }
      _setOverlayState(true, '🔐 Sesión cerrada. Inicia sesión de nuevo.', false);
      const banner = document.getElementById('demo-banner');
      if (banner) banner.remove();
      const demoBtn = document.getElementById('auth-demo');
      if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
    });
  }

  // ================================================================
  // INIT PÚBLICO
  // ================================================================
  async function init() {
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado');
      return;
    }
    bindEvents();
    await initialize();
  }

  return {
    init,
    initialize,
    bypassToDemo,
    isInitialized: () => _authInitialized
  };
})();

window.AuthManager = AuthManager;