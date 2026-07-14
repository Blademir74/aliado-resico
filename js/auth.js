window.APP_STATE = window.APP_STATE || {
  supabase: null,
  currentUser: null,
  isDemo: false,
  authInitialized: false
};

window.MockData = window.MockData || {
  load(store) {
    store?.setState({
      conversations: [
        { id: 'demo-1', text: '¿Estoy cerca del límite de RESICO?', intent: 'CONSULTA_FISCAL', confidence: 0.96, timestamp: Date.now(), is_fiscal_audit_completed: true, source: 'demo' },
        { id: 'demo-2', text: 'Mi buzón tributario está inactivo', intent: 'SALUD_FISCAL', confidence: 0.98, timestamp: Date.now() - 60000, is_fiscal_audit_completed: true, source: 'demo' }
      ],
      incomeYTD: 95500,
      fiscalMetrics: { annualLimit: 3500000, riskLevel: 'SEGURO' },
      saludFiscal: { buzonTributarioActivo: false, eFirmaVigente: true, alertLevel: 'warning' }
    });
  }
};

const AuthManager = (() => {
  // ---------- ESTADO ----------
  let currentUser = null;
  let isRegister = false;
  let isInitialized = false;
  let isChecking = false;

  // DOM refs (se obtienen una sola vez)
  const overlay = document.getElementById('auth-overlay');
  const app = document.getElementById('app');
  const msg = document.getElementById('auth-msg');
  const loader = document.getElementById('auth-loader');
  const demoBtn = document.getElementById('auth-demo');
  const submitBtn = document.getElementById('auth-submit');
  const emailInput = document.getElementById('auth-email');
  const passInput = document.getElementById('auth-password');
  const logoutBtn = document.getElementById('logout-btn');
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const forgotBtn = document.getElementById('auth-forgot-password');
  const emailDisplay = document.getElementById('user-email-display');

  // ---------- CONTROL DE OVERLAY ----------
  function setOverlay(visible, message, isError = false) {
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
      // Asegurar que la app esté oculta
      if (app) {
        app.hidden = true;
        app.style.display = 'none';
      }
    } else {
      overlay.hidden = true;
      overlay.style.display = 'none';
      if (msg) { msg.hidden = true; msg.textContent = ''; }
      if (loader) loader.style.display = 'none';
      // Mostrar app
      if (app) {
        app.hidden = false;
        app.style.display = '';
        void app.offsetHeight;
      }
    }
  }

  function showApp(user) {
    currentUser = user;
    window.APP_STATE.currentUser = user;
    if (emailDisplay) emailDisplay.textContent = user?.email || 'Modo Demo';
    if (logoutBtn) logoutBtn.hidden = false;
    // Ocultar overlay y mostrar app
    setOverlay(false);
    // Renderizar dashboard después de un pequeño retraso
    if (window.Dashboard?.syncAndRender) {
      setTimeout(() => window.Dashboard.syncAndRender(), 50);
    }
    // Inyectar mensaje de bienvenida
    injectWelcomeMessage();
  }

  function showLoginWithError(message) {
    setOverlay(true, message || 'Error de autenticación. Contacta a soporte.', true);
    if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
  }

  function showLogin() {
    setOverlay(true, '🔐 Inicia sesión para continuar.', false);
    if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
  }

  // ---------- MENSAJE DE BIENVENIDA ----------
  function injectWelcomeMessage() {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl || chatEl.dataset.welcomeInjected === '1') return;
    chatEl.dataset.welcomeInjected = '1';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.textContent =
      `🛡️ Aliado RESICO activo.\n\n` +
      `Art. 113-E LISR: tu límite anual es $3,500,000 MXN.\n` +
      `Al 94% ($3,290,000 MXN) debes tratarlo como riesgo de expulsión.\n\n` +
      `⚠️ ALERTA DE SALUD FISCAL\n` +
      `Art. 17-K CFF: Buzón Tributario inactivo = multa hasta $10,260 MXN.\n` +
      `Reincidencia: $20,520 MXN (Art. 86-C CFF).\n\n` +
      `📘 Educación fiscal:\n` +
      `- ISR RESICO: 1% a 2.5% sobre ingresos brutos (Art. 113-F LISR).\n` +
      `- IVA: solo acreditable con CFDI válido (Art. 1-A LIVA).`;
    chatEl.appendChild(bubble);
  }

  // ---------- DEMO ----------
  function bypassToDemo() {
    window.APP_STATE.isDemo = true;
    // Mostrar banner demo
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:#92400e;color:#fff;padding:10px;text-align:center;font-size:13px;font-weight:600;';
    banner.textContent = '⚠️ MODO DEMO — Buzón inactivo: multa $10,260 MXN (Art. 17-K CFF).';
    document.body.prepend(banner);
    // Cargar datos mock
    window.MockData?.load?.(window.Store);
    // Mostrar app
    showApp(null);
    // Renderizar dashboard
    if (window.Dashboard?.syncAndRender) {
      setTimeout(() => window.Dashboard.syncAndRender(), 100);
    }
  }

  // ---------- VERIFICACIÓN DE SESIÓN ----------
  async function checkSession() {
    if (isChecking) return;
    isChecking = true;
    setOverlay(true, '🔒 Verificando Bóveda Fiscal...', false);

    const client = window.APP_STATE?.supabase;
    const url = window.AppConfig?.getSupabaseUrl?.() || '';
    const key = window.AppConfig?.getSupabaseKey?.() || '';

    if (!url || !key || !client) {
      console.warn('[Auth] Supabase no configurado');
      showLoginWithError('⚠️ Servicio de autenticación no disponible. Usa "Ver Demo".');
      isChecking = false;
      return false;
    }

    try {
      // Obtener sesión con timeout de 5s
      const sessionPromise = client.auth.getSession();
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));
      const { data: sessionData, error: sessionError } = await Promise.race([sessionPromise, timeout]);

      if (sessionError || !sessionData?.session) {
        console.warn('[Auth] Sin sesión:', sessionError?.message);
        showLogin();
        isChecking = false;
        return false;
      }

      // Verificar acceso a fiscal_metrics
      const metricsPromise = client.from('fiscal_metrics').select('user_id').limit(1);
      const { error: metricsError } = await Promise.race([metricsPromise, timeout]);

      if (metricsError) {
        if (metricsError.code === 'PGRST301' || metricsError.message?.includes('permission denied') || metricsError.status === 403) {
          console.warn('[Auth] Error 403 en fiscal_metrics:', metricsError.message);
          showLoginWithError('⚠️ Error de Autorización: No tienes permisos para acceder a tu Bóveda Fiscal. Contacta a soporte.');
          isChecking = false;
          return false;
        }
        console.warn('[Auth] Error en fiscal_metrics:', metricsError.message);
        showLoginWithError('⚠️ Error al conectar con Bóveda Fiscal. Contacta a soporte.');
        isChecking = false;
        return false;
      }

      // TODO OK
      const user = sessionData.session.user;
      showApp(user);
      isChecking = false;
      isInitialized = true;
      return true;
    } catch (err) {
      console.warn('[Auth] Error en checkSession:', err.message);
      showLoginWithError('⚠️ Error crítico. Intenta de nuevo o usa Demo.');
      isChecking = false;
      return false;
    }
  }

  // ---------- EVENTOS ----------
  function bindEvents() {
    // Tabs
    tabLogin?.addEventListener('click', () => {
      isRegister = false;
      tabLogin.classList.add('active');
      tabRegister?.classList.remove('active');
      submitBtn.textContent = '🔐 Iniciar Sesión';
      if (msg) msg.hidden = true;
    });
    tabRegister?.addEventListener('click', () => {
      isRegister = true;
      tabRegister.classList.add('active');
      tabLogin?.classList.remove('active');
      submitBtn.textContent = '✅ Crear Cuenta';
      if (msg) msg.hidden = true;
    });

    // Submit
    submitBtn?.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass = passInput?.value;
      if (!email || !pass) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = 'Ingresa correo y contraseña.';
          msg.className = 'auth-msg error';
          msg.style.color = '#ef4444';
        }
        return;
      }
      const client = window.APP_STATE?.supabase;
      if (!client) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = 'Servicio no disponible. Usa Demo.';
          msg.className = 'auth-msg error';
          msg.style.color = '#ef4444';
        }
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Procesando...';
      if (msg) msg.hidden = true;

      try {
        let result;
        if (isRegister) {
          result = await client.auth.signUp({ email, password: pass });
          if (result.error) throw result.error;
          if (result.data?.user && !result.data?.session) {
            if (msg) {
              msg.hidden = false;
              msg.textContent = 'Cuenta creada. Revisa tu correo para confirmar.';
              msg.className = 'auth-msg success';
              msg.style.color = '#10b981';
            }
            return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }
        // Login exitoso
        await checkSession(); // Esto mostrará la app si todo va bien
      } catch (err) {
        const map = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed': 'Confirma tu correo antes de entrar.',
          'User already registered': 'Ese correo ya tiene cuenta.'
        };
        if (msg) {
          msg.hidden = false;
          msg.textContent = map[err.message] || err.message;
          msg.className = 'auth-msg error';
          msg.style.color = '#ef4444';
        }
        // Habilitar demo si falla
        if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    // Enter key
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn?.click();
      })
    );

    // Demo
    demoBtn?.addEventListener('click', bypassToDemo);

    // Forgot password
    forgotBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput?.value?.trim();
      if (!email) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = 'Ingresa tu correo para restablecer.';
          msg.className = 'auth-msg error';
          msg.style.color = '#ef4444';
        }
        return;
      }
      const client = window.APP_STATE?.supabase;
      if (!client) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = 'Servicio no disponible.';
          msg.className = 'auth-msg error';
          msg.style.color = '#ef4444';
        }
        return;
      }
      forgotBtn.textContent = '⏳ Enviando...';
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/api/auth-callback?next=/`
        });
        if (error) throw error;
        if (msg) {
          msg.hidden = false;
          msg.textContent = 'Correo de recuperación enviado. Revisa tu bandeja.';
          msg.className = 'auth-msg success';
          msg.style.color = '#10b981';
        }
      } catch (err) {
        if (msg) {
          msg.hidden = false;
          msg.textContent = err.message;
          msg.className = 'auth-msg error';
          msg.style.color = '#ef4444';
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
      isInitialized = false;
      // Ocultar app y mostrar overlay
      if (app) { app.hidden = true; app.style.display = 'none'; }
      setOverlay(true, '🔐 Sesión cerrada. Inicia sesión de nuevo.', false);
      const banner = document.getElementById('demo-banner');
      if (banner) banner.remove();
      if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
    });
  }

  // ---------- INICIALIZACIÓN ----------
  async function init() {
    if (isInitialized) {
      console.log('[Auth] Ya inicializado');
      return;
    }
    // Mostrar overlay por defecto
    setOverlay(true, '🔒 Inicializando...', false);
    // Configurar eventos
    bindEvents();
    // Verificar sesión
    await checkSession();
  }

  // ---------- API PÚBLICA ----------
  return {
    init,
    checkSession,
    bypassToDemo,
    isInitialized: () => isInitialized
  };
})();

window.AuthManager = AuthManager;