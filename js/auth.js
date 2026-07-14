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

  // Control total del overlay: visible, mensaje y estado del botón demo
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
        demoBtn.disabled = !isError; // solo habilitar si hay error
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
    _setOverlayState(false); // ocultar definitivamente
    const app = getAppEl();
    if (app) {
      app.hidden = false;
      app.style.display = '';
      void app.offsetHeight; // forzar reflow
    }
    const chip = document.getElementById('user-chip');
    const emailEl = document.getElementById('user-email-display');
    const logoutEl = document.getElementById('logout-btn');
    if (chip) chip.hidden = false;
    if (emailEl) emailEl.textContent = user?.email || 'Modo Demo';
    if (logoutEl) logoutEl.hidden = false;
    window.APP_STATE.authError = null;
    window.APP_STATE.currentUser = user;
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

  // --- Funciones públicas ---

  function bypassToDemo() {
    window.APP_STATE.isDemo = true;
    _showDemoBanner();
    _showApp(null);
    window.MockData?.load?.(window.Store);
    _injectWelcomeMessage();
    window.Dashboard?.syncAndRender?.();
  }

  // ================================================================
  // INICIALIZACIÓN PRINCIPAL CON Promise.all
  // ================================================================
  async function initialize() {
    // Si ya está inicializado, devolver éxito
    if (_authInitialized) {
      return true;
    }

    // Si ya está en proceso, esperar la misma promesa
    if (_initializing) {
      return _initPromise;
    }

    _initializing = true;
    _initPromise = (async () => {
      // 1. Mostrar overlay con mensaje de verificación (bloqueado)
      _setOverlayState(true, '🔒 Acceso Restringido - Verificando Bóveda Fiscal...', false);

      // 2. Obtener cliente y configuración
      const client = window.APP_STATE?.supabase;
      const url = window.AppConfig?.getSupabaseUrl?.() || '';
      const key = window.AppConfig?.getSupabaseKey?.() || '';

      if (!url || !key || !client) {
        console.warn('[Auth] Supabase no configurado. Modo Demo disponible.');
        _setOverlayState(true, '⚠️ Servicio de autenticación no disponible. Usa "Ver Demo".', true);
        // Habilitar demo
        const demoBtn = document.getElementById('auth-demo');
        if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
        _authInitialized = true;
        _initializing = false;
        return false;
      }

      try {
        // 3. Validaciones combinadas con Promise.all (rechaza si alguna falla)
        const [sessionResult, metricsResult] = await Promise.all([
          // a) Obtener sesión
          client.auth.getSession(),
          // b) Consultar fiscal_metrics (solo para verificar permisos)
          client.from('fiscal_metrics').select('user_id').limit(1)
        ]);

        // Procesar resultado de sesión
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

        // Procesar resultado de metrics
        const { error: metricsError } = metricsResult;
        if (metricsError) {
          // Si error es 403 o "permission denied", es problema de RLS
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

        // 4. TODO OK: Sesión válida y acceso a fiscal_metrics permitido
        const user = sessionData.session.user;
        currentUser = user;
        window.APP_STATE.currentUser = user;
        _showApp(user);
        _injectWelcomeMessage();
        window.Dashboard?.syncAndRender?.();
        _authInitialized = true;
        _initializing = false;
        return true;

      } catch (err) {
        // Error general (red, excepción)
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

  // --- Función init para compatibilidad con app.js ---
  async function init() {
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado');
      return;
    }
    await initialize();
  }

  // --- Exponer funciones públicas ---
  return {
    init,
    initialize,
    bypassToDemo,
    isInitialized: () => _authInitialized
  };
})();

window.AuthManager = AuthManager;