// ============================================================
// js/auth.js — Aliado RESICO 2026
// Senior Full-Stack Architect | Seguridad SOC2 + LFPDPPP
// Art. 113-E LISR | Bunker State + Promise.all RLS Guard
// ============================================================

// --- 1. BUNKER STATE: Bloqueo inmediato en tiempo de parseo ---
// Se ejecuta ANTES de que el DOM esté listo, usando un <style> inyectado.
// Esto elimina cualquier FOUC (Flash of Unprotected Content).
(function installBunkerGuard() {
  const style = document.createElement('style');
  style.id = 'auth-bunker-guard';
  // !important asegura que nada pueda sobrescribir este estado por defecto
  style.textContent = `
    #auth-overlay {
      display: flex !important;
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: all !important;
      z-index: 99999 !important;
    }
    #app {
      display: none !important;
      visibility: hidden !important;
    }
  `;
  // Insertar en <head> lo antes posible
  (document.head || document.documentElement).appendChild(style);
})();

// --- 2. ESTADO GLOBAL DE LA APLICACIÓN ---
window.APP_STATE = window.APP_STATE || {
  supabase: null,
  currentUser: null,
  isDemo: false,
  authInitialized: false,
  authError: null
};

// --- 3. DATOS MOCK PARA MODO DEMO ---
window.MockData = window.MockData || {
  load(store) {
    store?.setState({
      conversations: [
        {
          id: 'demo-1',
          // CRÍTICO: columna correcta es message_text, NO text (evita error 400)
          message_text: '¿Estoy cerca del límite de RESICO?',
          intent: 'CONSULTA_FISCAL',
          confidence: 0.96,
          timestamp: Date.now(),
          is_fiscal_audit_completed: true,
          source: 'demo'
        },
        {
          id: 'demo-2',
          message_text: 'Mi buzón tributario está inactivo',
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

// ============================================================
// 4. AuthManager — Módulo Principal (IIFE)
// ============================================================
const AuthManager = (() => {

  // --- Estado interno del módulo ---
  let currentUser = null;
  let _authInitialized = false;
  let _initializing = false;
  let _initPromise = null;
  let isRegister = false;

  // --- Constantes Fiscales Art. 113-E LISR (2026) ---
  const FISCAL = {
    INCOME_LIMIT: 3500000,
    ALERT_94_PCT: 3290000,   // 94% de 3,500,000 — umbral de alerta de expulsión
    ALERT_80_PCT: 2800000,   // 80% — nivel PREVENTIVO
    MULTA_BUZON: 10260,
    ART_113E: 'Art. 113-E LISR',
    ART_113F: 'Art. 113-F LISR',
    ART_17K: 'Art. 17-K CFF',
    ART_86C: 'Art. 86-C CFF',
    LFPDPPP: 'LFPDPPP'
  };

  // --- Timeout de conexión Supabase (ms) ---
  const SUPABASE_TIMEOUT_MS = 8000;

  // ============================================================
  // DOM HELPERS
  // ============================================================

  function _removeBunkerGuard() {
    // Solo se remueve cuando la validación Promise.all tuvo ÉXITO TOTAL
    const guard = document.getElementById('auth-bunker-guard');
    if (guard) guard.remove();
    // Compatibilidad con guard legacy
    const legacyGuard = document.getElementById('auth-guard-css');
    if (legacyGuard) legacyGuard.remove();
  }

  /**
   * _setOverlayState — Control quirúrgico del overlay
   * NUNCA llama a display:none sin que Promise.all haya validado sesión + RLS.
   *
   * @param {boolean} visible     - true = mantener overlay bloqueado
   * @param {string}  message     - Texto a mostrar al usuario
   * @param {'info'|'error'|'success'|'rls_blocked'} level - Tipo de mensaje
   */
  function _setOverlayState(visible, message, level = 'info') {
    const overlay = document.getElementById('auth-overlay');
    const msg     = document.getElementById('auth-msg');
    const loader  = document.getElementById('auth-loader');
    const demoBtn = document.getElementById('auth-demo');
    const loginForm = document.getElementById('auth-form') ||
                      document.querySelector('.auth-form-container');

    if (!overlay) {
      console.error('[Auth][BUNKER] #auth-overlay no encontrado en el DOM');
      return;
    }

    if (visible) {
      // BUNKER: forzar visibilidad absoluta
      overlay.hidden = false;
      overlay.style.cssText = 'display: flex !important;';

      if (loader) loader.style.display = 'none';

      if (msg) {
        msg.hidden = false;
        msg.textContent = message || '🔒 Verificando Bóveda Fiscal...';

        // Estilos por nivel
        switch (level) {
          case 'error':
            msg.className = 'auth-msg error';
            msg.style.color = '#ef4444';
            break;
          case 'rls_blocked':
            // Caso especial: 403 RLS — mensaje normativo LFPDPPP
            msg.className = 'auth-msg rls-blocked';
            msg.style.cssText = 'color:#f97316; font-weight:700; border:1px solid #f97316; padding:10px 14px; border-radius:8px; background:rgba(249,115,22,0.1);';
            // Mostrar formulario de login oculto en este caso
            if (loginForm) loginForm.style.display = 'none';
            break;
          case 'success':
            msg.className = 'auth-msg success';
            msg.style.color = '#10b981';
            break;
          default: // 'info'
            msg.className = 'auth-msg info';
            msg.style.color = '#f59e0b';
        }
      }

      if (demoBtn) {
        // Demo solo disponible en error o rls_blocked, no en estado de carga inicial
        const showDemo = (level === 'error' || level === 'rls_blocked');
        demoBtn.disabled = !showDemo;
        demoBtn.hidden = !showDemo;
      }

    } else {
      // SOLO SE EJECUTA TRAS Promise.all EXITOSO — no invocar directamente
      overlay.hidden = true;
      overlay.style.cssText = 'display: none !important;';
      if (msg) { msg.hidden = true; msg.textContent = ''; }
      if (loader) loader.style.display = 'none';
    }
  }

  /**
   * _unlockDashboard — Acceso definitivo al dashboard.
   * Único punto de salida del bunker. Solo es llamado por _runCombinedValidation
   * cuando Promise.all valida TANTO sesión COMO integridad RLS.
   *
   * Cumplimiento Art. 113-E LISR + LFPDPPP:
   * El usuario nunca ve ingresos acumulados ni RFC hasta pasar esta validación.
   */
  function _unlockDashboard(user) {
    // 1. Remover el bunker guard del <head>
    _removeBunkerGuard();

    // 2. Ocultar overlay (único punto donde está permitido)
    _setOverlayState(false);

    // 3. Mostrar la aplicación
    const app = document.getElementById('app');
    if (app) {
      app.hidden = false;
      app.style.cssText = '';
      // Forzar reflow para evitar pantalla azul/blanca
      void app.offsetHeight;
    }

    // 4. Actualizar UI con datos del usuario
    const chip      = document.getElementById('user-chip');
    const emailEl   = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');

    if (chip) chip.hidden = false;
    if (emailEl) emailEl.textContent = user?.email || 'Usuario RESICO';
    if (logoutBtn) logoutBtn.hidden = false;

    // 5. Actualizar estado global
    window.APP_STATE.authError = null;
    window.APP_STATE.currentUser = user;

    // 6. Disparar App.init() o Dashboard.syncAndRender()
    // Se usa setTimeout 0 para ceder el hilo y evitar bloqueos de render
    setTimeout(() => {
      if (typeof window.App?.init === 'function') {
        window.App.init();
      } else if (window.Dashboard?.syncAndRender) {
        window.Dashboard.syncAndRender();
      }
      _injectWelcomeMessage();
    }, 0);

    console.info('[Auth][BUNKER DESBLOQUEADO] Acceso concedido a:', user?.email);
  }

  function _injectWelcomeMessage() {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl || chatEl.dataset.welcomeInjected === '1') return;
    chatEl.dataset.welcomeInjected = '1';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.innerHTML =
      `🛡️ <strong>Aliado RESICO activo.</strong><br><br>` +
      `<strong>${FISCAL.ART_113E}:</strong> Tu límite anual es ` +
      `<strong>$${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN</strong>.<br>` +
      `Al 94% (<strong>$${FISCAL.ALERT_94_PCT.toLocaleString('es-MX')} MXN</strong>) ` +
      `estás en riesgo de expulsión del régimen.<br><br>` +
      `⚠️ <strong>ALERTA SALUD FISCAL</strong><br>` +
      `${FISCAL.ART_17K}: Buzón Tributario inactivo = multa hasta ` +
      `<strong>$${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN</strong> ` +
      `y pérdida de plazos (reincidencia: ${FISCAL.ART_86C}).<br><br>` +
      `${FISCAL.ART_113F}: Antes de confirmar tu declaración anual, ` +
      `se verificará si tuviste ingresos mixtos.<br><br>` +
      `📘 <strong>Fiscalidad RESICO 2026:</strong><br>` +
      `• ISR: calculado sobre ingresos <strong>brutos</strong> (tasa 1–2.5%), sin deducción de gastos.<br>` +
      `• IVA: acreditable <strong>solo</strong> con CFDI válido que acredite gasto indispensable.`;

    chatEl.appendChild(bubble);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99998',
      'background:#92400e', 'color:#fff', 'padding:10px 16px',
      'text-align:center', 'font-size:13px', 'font-weight:700',
      'letter-spacing:0.3px'
    ].join(';');
    banner.textContent =
      `⚠️ MODO DEMO — Datos simulados. ` +
      `${FISCAL.ART_17K}: multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN ` +
      `por Buzón Tributario inactivo.`;
    document.body.prepend(banner);
  }

  // ============================================================
  // 5. VALIDACIÓN COMBINADA — El núcleo del Bunker State
  // ============================================================

  /**
   * _runCombinedValidation
   *
   * FLUJO DE SEGURIDAD (LFPDPPP + Art. 113-E LISR):
   *
   * ┌─────────────────────────────────────────────────────────┐
   * │  PÁGINA CARGA → overlay: display:flex !important       │
   * │                 app:     display:none !important        │
   * └────────────────────┬────────────────────────────────────┘
   *                      │
   *              Promise.all([
   *                Condición A: getSession(),
   *                Condición B: fiscal_metrics RLS probe
   *              ])
   *                      │
   *         ┌────────────┴─────────────┐
   *    A falla                    A éxito
   *  (sin sesión)                     │
   *    → overlay               ┌──────┴──────┐
   *    → form login         B falla      B éxito
   *                        (403 RLS)         │
   *                       → overlay    → _unlockDashboard()
   *                       → msg RLS    → App.init()
   *                         bloqueado
   */
  async function _runCombinedValidation(client) {
    // Mostrar estado de carga (overlay bloqueado)
    _setOverlayState(true, '🔒 Verificando Bóveda Fiscal...', 'info');

    // Timeout race para evitar bloqueo eterno en red lenta
    const timeoutSignal = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('TIMEOUT_SUPABASE')),
        SUPABASE_TIMEOUT_MS
      )
    );

    try {
      // ── PROMISE.ALL: Ambas condiciones deben cumplirse ──────
      const [sessionResult, metricsResult] = await Promise.race([
        Promise.all([
          // Condición A: Sesión válida
          client.auth.getSession(),
          // Condición B: Integridad RLS en fiscal_metrics
          // Se consulta SOLO user_id para no exponer datos fiscales en la validación
          client
            .from('fiscal_metrics')
            .select('user_id')
            .limit(1)
        ]),
        timeoutSignal
      ]);

      // ── EVALUACIÓN CONDICIÓN A: Sesión ──────────────────────
      const { data: sessionData, error: sessionError } = sessionResult;
      const session = sessionData?.session;

      if (sessionError || !session) {
        console.warn('[Auth][A] Sin sesión válida:', sessionError?.message ?? 'null session');
        // Mantener overlay, mostrar formulario de login
        _setOverlayState(
          true,
          '🔐 Inicia sesión para acceder a tu Bóveda Fiscal.',
          'info'
        );
        // El formulario de login se muestra por defecto (overlay visible)
        return false;
      }

      // ── EVALUACIÓN CONDICIÓN B: RLS fiscal_metrics ──────────
      const { error: metricsError } = metricsResult;

      if (metricsError) {
        const is403 =
          metricsError.code === 'PGRST301'         ||
          metricsError.code === '42501'             ||
          (metricsError.status ?? 0) === 403        ||
          (metricsError.message ?? '').toLowerCase().includes('permission denied') ||
          (metricsError.message ?? '').toLowerCase().includes('rls') ||
          (metricsError.message ?? '').toLowerCase().includes('row-level security');

        if (is403) {
          // BLOQUEO NORMATIVO: No ocultar overlay bajo ninguna circunstancia
          console.error('[Auth][B][RLS-BLOCK] Error 403 fiscal_metrics:', metricsError);
          _setOverlayState(
            true,
            // Mensaje exacto requerido en los requisitos
            '⚠️ Acceso Restringido — Tu Bóveda Fiscal no está sincronizada. Contacta a soporte.',
            'rls_blocked'
          );
        } else {
          // Error de conexión u otro error no-RLS
          console.warn('[Auth][B] Error no-403 en fiscal_metrics:', metricsError.message);
          _setOverlayState(
            true,
            `⚠️ Error de conexión con la Bóveda Fiscal (${metricsError.code ?? 'RED'}). Intenta de nuevo.`,
            'error'
          );
        }
        return false;
      }

      // ── ÉXITO TOTAL: Ambas condiciones validadas ─────────────
      const user = session.user;
      currentUser = user;
      window.APP_STATE.currentUser = user;
      window.APP_STATE.authInitialized = true;

      // Alerta preventiva si ya tiene sesión con ingresos en riesgo
      // (se evaluará con datos reales una vez que Dashboard cargue)
      console.info('[Auth][Promise.all OK] Sesión + RLS validados para:', user.email);

      // Único punto donde el bunker se desactiva
      _unlockDashboard(user);
      return true;

    } catch (err) {
      if (err.message === 'TIMEOUT_SUPABASE') {
        console.error('[Auth] Timeout al conectar con Supabase (>8s)');
        _setOverlayState(
          true,
          '⏳ Tiempo de espera excedido. Verifica tu conexión o usa el Modo Demo.',
          'error'
        );
      } else {
        console.error('[Auth] Error crítico en validación combinada:', err);
        _setOverlayState(
          true,
          '🚨 Error crítico de seguridad. Contacta a soporte.',
          'error'
        );
      }
      return false;
    }
  }

  // ============================================================
  // 6. INICIALIZACIÓN PRINCIPAL
  // ============================================================

  /**
   * initialize — Entry point asíncrono del módulo de autenticación.
   * Garantiza ejecución única mediante _initPromise.
   *
   * IMPORTANTE: onAuthStateChange NO oculta el overlay.
   * Solo _runCombinedValidation puede desbloquear el dashboard.
   */
  async function initialize() {
    if (_authInitialized) {
      console.log('[Auth] Módulo ya inicializado.');
      return true;
    }
    if (_initializing) {
      console.log('[Auth] Inicialización en progreso, reutilizando promesa...');
      return _initPromise;
    }

    _initializing = true;
    _initPromise = (async () => {
      const client = window.APP_STATE?.supabase;
      const url    = window.AppConfig?.getSupabaseUrl?.() || '';
      const key    = window.AppConfig?.getSupabaseKey?.() || '';

      // Validación de configuración antes de cualquier llamada a red
      if (!url || !key || !client) {
        console.warn('[Auth] Supabase no configurado. Solo Modo Demo disponible.');
        _setOverlayState(
          true,
          '⚠️ Servicio de autenticación no disponible. Usa "Ver Demo" para continuar.',
          'error'
        );
        _authInitialized = true;
        _initializing = false;
        return false;
      }

      // CRÍTICO: NO suscribir onAuthStateChange para ocultar el overlay.
      // onAuthStateChange solo se usa para detectar SIGN_OUT y re-bloquear.
      client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          console.info('[Auth][onAuthStateChange] SIGNED_OUT detectado → re-bloqueando bunker.');
          currentUser = null;
          window.APP_STATE.currentUser = null;
          window.APP_STATE.isDemo = false;
          _authInitialized = false;
          _initializing = false;
          _initPromise = null;

          const app = document.getElementById('app');
          if (app) { app.hidden = true; app.style.cssText = 'display:none !important;'; }

          // Re-instalar bunker guard
          installBunkerGuard();
          _setOverlayState(true, '🔐 Sesión cerrada. Inicia sesión para continuar.', 'info');

          const banner = document.getElementById('demo-banner');
          if (banner) banner.remove();
        }
        // INTENCIONALMENTE no manejar SIGNED_IN aquí:
        // El acceso solo se concede mediante _runCombinedValidation()
      });

      // Ejecutar validación combinada
      const result = await _runCombinedValidation(client);
      _authInitialized = result;
      _initializing = false;
      return result;
    })();

    return _initPromise;
  }

  // ============================================================
  // 7. MODO DEMO
  // ============================================================

  function bypassToDemo() {
    console.info('[Auth] Activando Modo Demo (sin datos reales).');
    window.APP_STATE.isDemo = true;
    _showDemoBanner();
    window.MockData?.load?.(window.Store);

    // Remover bunker y desbloquear UI en modo demo
    _removeBunkerGuard();
    _setOverlayState(false);

    const app = document.getElementById('app');
    if (app) {
      app.hidden = false;
      app.style.cssText = '';
      void app.offsetHeight;
    }

    const chip      = document.getElementById('user-chip');
    const emailEl   = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');

    if (chip) chip.hidden = false;
    if (emailEl) emailEl.textContent = 'Modo Demo';
    if (logoutBtn) logoutBtn.hidden = false;

    window.APP_STATE.currentUser = null;

    setTimeout(() => {
      if (typeof window.App?.init === 'function') {
        window.App.init();
      } else if (window.Dashboard?.syncAndRender) {
        window.Dashboard.syncAndRender();
      }
      _injectWelcomeMessage();
    }, 0);
  }

  // ============================================================
  // 8. BINDING DE EVENTOS DE UI
  // ============================================================

  function bindEvents() {
    const submitBtn  = document.getElementById('auth-submit');
    const demoBtn    = document.getElementById('auth-demo');
    const msgEl      = document.getElementById('auth-msg');
    const emailInput = document.getElementById('auth-email');
    const passInput  = document.getElementById('auth-password');
    const logoutBtn  = document.getElementById('logout-btn');
    const tabLogin   = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const forgotBtn  = document.getElementById('auth-forgot-password');

    if (!submitBtn) {
      console.warn('[Auth] #auth-submit no encontrado. ¿El DOM está listo?');
      return;
    }

    // ── Tabs Login / Registro ────────────────────────────────
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

    // ── Submit Login / Registro ──────────────────────────────
    submitBtn.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass  = passInput?.value;

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
          msgEl.textContent = 'Servicio no disponible. Usa Modo Demo.';
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Verificando...';
      if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }

      try {
        let authResult;

        if (isRegister) {
          authResult = await client.auth.signUp({ email, password: pass });
          if (authResult.error) throw authResult.error;

          // Email de confirmación pendiente
          if (authResult.data?.user && !authResult.data?.session) {
            if (msgEl) {
              msgEl.hidden = false;
              msgEl.textContent = '✅ Cuenta creada. Revisa tu correo para confirmar tu cuenta.';
              msgEl.className = 'auth-msg success';
              msgEl.style.color = '#10b981';
            }
            return;
          }
        } else {
          authResult = await client.auth.signInWithPassword({ email, password: pass });
          if (authResult.error) throw authResult.error;
        }

        // Login exitoso → REEJECUTAR validación combinada completa
        // (no basta con tener la sesión; RLS también debe validar)
        _authInitialized = false; // Reset para permitir re-validación
        _initializing = false;
        _initPromise = null;

        const success = await initialize();

        if (!success) {
          // El overlay ya muestra el mensaje de error correcto desde _runCombinedValidation
          if (msgEl) {
            // Solo añadir contexto adicional si el mensaje de overlay no es suficiente
            console.warn('[Auth] initialize() falló tras login exitoso.');
          }
        }

      } catch (err) {
        const ERROR_MAP = {
          'Invalid login credentials':  'Correo o contraseña incorrectos.',
          'Email not confirmed':         'Confirma tu correo antes de ingresar.',
          'User already registered':     'Ese correo ya tiene una cuenta registrada.',
          'Password should be at least 6 characters': 'La contraseña debe tener al menos 6 caracteres.'
        };

        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = ERROR_MAP[err.message] || err.message;
          msgEl.className = 'auth-msg error';
          msgEl.style.color = '#ef4444';
        }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    // ── Enter en inputs ──────────────────────────────────────
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
      })
    );

    // ── Botón Demo ───────────────────────────────────────────
    demoBtn?.addEventListener('click', bypassToDemo);

    // ── Recuperar contraseña ─────────────────────────────────
    forgotBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput?.value?.trim();

      if (!email) {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = 'Ingresa tu correo para recibir el enlace de recuperación.';
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
          msgEl.textContent = '📧 Correo de recuperación enviado. Revisa tu bandeja de entrada.';
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

    // ── Logout ───────────────────────────────────────────────
    logoutBtn?.addEventListener('click', async () => {
      const client = window.APP_STATE?.supabase;
      if (client) await client.auth.signOut();
      // El resto lo maneja onAuthStateChange(SIGNED_OUT)
      window.Store?.reset?.();
    });
  }

  // ============================================================
  // 9. API PÚBLICA DEL MÓDULO
  // ============================================================

  /**
   * init — Punto de entrada público.
   * Llamado desde index.html o app.js en DOMContentLoaded.
   */
  async function init() {
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado, omitiendo re-init.');
      return;
    }
    bindEvents();
    await initialize();
  }

  // Función interna expuesta para reinstalar el bunker si es necesario
  function installBunkerGuard() {
    if (document.getElementById('auth-bunker-guard')) return;
    const style = document.createElement('style');
    style.id = 'auth-bunker-guard';
    style.textContent = `
      #auth-overlay { display: flex !important; visibility: visible !important; opacity: 1 !important; pointer-events: all !important; z-index: 99999 !important; }
      #app { display: none !important; visibility: hidden !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  return {
    init,
    initialize,
    bypassToDemo,
    isInitialized: () => _authInitialized,
    getCurrentUser: () => currentUser
  };

})();

window.AuthManager = AuthManager;