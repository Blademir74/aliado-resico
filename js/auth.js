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

  function _setOverlayVisible(visible, message, isError = false) {
    const overlay = document.getElementById('auth-overlay');
    const msg = document.getElementById('auth-msg');
    const loader = document.getElementById('auth-loader');
    const demoBtn = document.getElementById('auth-demo');

    if (!overlay) return;

    if (visible) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
      // Mostrar mensaje si existe
      if (msg) {
        msg.hidden = false;
        msg.textContent = message || 'Verificando Bóveda Fiscal...';
        msg.className = isError ? 'auth-msg error' : 'auth-msg info';
        msg.style.color = isError ? '#ef4444' : '#f59e0b';
      }
      if (loader) loader.style.display = 'none';
      // Si hay error, habilitar demo; si no, deshabilitado
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
    // Ocultar overlay definitivamente
    _setOverlayVisible(false);
    const app = getAppEl();
    if (app) {
      app.hidden = false;
      app.style.display = '';
      void app.offsetHeight; // force reflow
    }
    // Mostrar datos de usuario
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

  // --- Función de inicialización principal (Promise) ---
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
      // 1. Mostrar overlay con mensaje de "Verificando..."
      _setOverlayVisible(true, '🔒 Verificando Bóveda Fiscal...', false);

      // 2. Obtener cliente y configuración
      const client = window.APP_STATE?.supabase;
      const url = window.AppConfig?.getSupabaseUrl?.() || '';
      const key = window.AppConfig?.getSupabaseKey?.() || '';

      if (!url || !key || !client) {
        console.warn('[Auth] Supabase no configurado. Modo Demo disponible.');
        _setOverlayVisible(true, '⚠️ Servicio de autenticación no disponible. Usa "Ver Demo".', true);
        // Habilitar demo
        const demoBtn = document.getElementById('auth-demo');
        if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
        _authInitialized = true;
        _initializing = false;
        return false;
      }

      try {
        // 3. Validaciones combinadas con Promise.allSettled
        const [sessionResult, metricsResult] = await Promise.allSettled([
          // a) Obtener sesión
          client.auth.getSession(),
          // b) Consultar fiscal_metrics (solo para verificar permisos)
          client.from('fiscal_metrics').select('user_id').limit(1)
        ]);

        // Procesar resultado de sesión
        let sessionOk = false;
        let user = null;
        if (sessionResult.status === 'fulfilled') {
          const { data, error } = sessionResult.value;
          if (!error && data?.session) {
            sessionOk = true;
            user = data.session.user;
          }
        }

        // Procesar resultado de metrics (verificar 403)
        let metricsOk = false;
        let metricsError = null;
        if (metricsResult.status === 'fulfilled') {
          const { data, error } = metricsResult.value;
          if (error) {
            metricsError = error;
            // Si error es 403 o "permission denied", es un problema de RLS
            if (error.code === 'PGRST301' || 
                error.message?.includes('permission denied') ||
                error.status === 403) {
              metricsOk = false;
            } else {
              // Otros errores (ej: tabla no existe) -> también fallo
              metricsOk = false;
            }
          } else {
            // Consulta exitosa (aunque no haya datos, es válido)
            metricsOk = true;
          }
        } else {
          // La promesa fue rechazada (error de red, etc.)
          metricsOk = false;
          metricsError = metricsResult.reason;
        }

        // 4. Tomar decisión final
        if (sessionOk && metricsOk) {
          // TODO OK: Sesión válida y acceso a fiscal_metrics permitido
          currentUser = user;
          window.APP_STATE.currentUser = user;
          _showApp(user);
          _injectWelcomeMessage();
          window.Dashboard?.syncAndRender?.();
          _authInitialized = true;
          _initializing = false;
          return true;
        } else {
          // Fallo: mostrar error y habilitar demo
          let errorMsg = 'Acceso Restringido - Verificando Bóveda Fiscal';
          if (!sessionOk) {
            errorMsg = 'Sesión no válida. Inicia sesión o usa Demo.';
          } else if (!metricsOk) {
            if (metricsError?.status === 403 || metricsError?.message?.includes('permission denied')) {
              errorMsg = 'Error de Autorización: No tienes permisos para acceder a tu Bóveda Fiscal. Contacta a soporte.';
            } else {
              errorMsg = 'Error al conectar con Bóveda Fiscal. Contacta a soporte.';
            }
          }
          _setOverlayVisible(true, '⚠️ ' + errorMsg, true);
          // Habilitar botón demo
          const demoBtn = document.getElementById('auth-demo');
          if (demoBtn) { demoBtn.disabled = false; demoBtn.hidden = false; }
          _authInitialized = true;
          _initializing = false;
          return false;
        }
      } catch (err) {
        console.warn('[Auth] Error en inicialización:', err.message);
        _setOverlayVisible(true, '⚠️ Error crítico. Contacta a soporte o usa Demo.', true);
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
    // Si ya está inicializado, no hacer nada
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado');
      return;
    }
    // Delegar a initialize()
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