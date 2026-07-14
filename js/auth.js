// ============================================================
// js/auth.js — Aliado RESICO 2026
// Senior Full-Stack Architect | Seguridad SOC2 + LFPDPPP
// Art. 113-E LISR | Bunker State + Promise.all RLS Guard
// FIX v2: Bug Demo + Bug Dashboard post-login
// ============================================================

// ── BUNKER STATE: Bloqueo en tiempo de parseo ────────────────
(function installBunkerGuard() {
  if (document.getElementById('auth-bunker-guard')) return;
  const style = document.createElement('style');
  style.id = 'auth-bunker-guard';
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
  (document.head || document.documentElement).appendChild(style);
})();

// ── ESTADO GLOBAL ────────────────────────────────────────────
window.APP_STATE = window.APP_STATE || {
  supabase: null,
  currentUser: null,
  isDemo: false,
  authInitialized: false,
  authError: null
};

// ── MOCK DATA PARA MODO DEMO ─────────────────────────────────
window.MockData = window.MockData || {
  load(store) {
    store?.setState({
      conversations: [
        {
          id: 'demo-1',
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
      fiscalMetrics: { annualLimit: 3500000, riskLevel: 'SEGURO' },
      saludFiscal: {
        buzonTributarioActivo: false,
        eFirmaVigente: true,
        alertLevel: 'warning'
      }
    });
  }
};

// ============================================================
// AuthManager
// ============================================================
const AuthManager = (() => {

  let currentUser    = null;
  let _authInitialized = false;
  let _initializing  = false;
  let _initPromise   = null;
  let isRegister     = false;

  const FISCAL = {
    INCOME_LIMIT : 3500000,
    ALERT_94_PCT : 3290000,
    ALERT_80_PCT : 2800000,
    MULTA_BUZON  : 10260,
    ART_113E : 'Art. 113-E LISR',
    ART_113F : 'Art. 113-F LISR',
    ART_17K  : 'Art. 17-K CFF',
    ART_86C  : 'Art. 86-C CFF'
  };

  const SUPABASE_TIMEOUT_MS = 8000;

  // ────────────────────────────────────────────────────────────
  // FIX CRÍTICO #1 — Remover el bunker guard correctamente
  // app.style.cssText = '' no basta contra <style> con !important
  // Se debe deshabilitar la hoja de estilos Y eliminar el nodo.
  // ────────────────────────────────────────────────────────────
  function _removeBunkerGuard() {
    const guard = document.getElementById('auth-bunker-guard');
    if (guard) {
      // Paso 1: deshabilitar la sheet antes de remover (evita FOUC)
      try { guard.sheet.disabled = true; } catch (e) { /* ignorar */ }
      // Paso 2: remover el nodo del DOM
      guard.remove();
    }
    // Compatibilidad con guard legacy
    const legacy = document.getElementById('auth-guard-css');
    if (legacy) {
      try { legacy.sheet.disabled = true; } catch (e) { /* ignorar */ }
      legacy.remove();
    }
  }

  function _reinstallBunkerGuard() {
    if (document.getElementById('auth-bunker-guard')) return;
    const style = document.createElement('style');
    style.id = 'auth-bunker-guard';
    style.textContent = `
      #auth-overlay { display: flex !important; visibility: visible !important; opacity: 1 !important; pointer-events: all !important; z-index: 99999 !important; }
      #app { display: none !important; visibility: hidden !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  // ────────────────────────────────────────────────────────────
  // Control del overlay — NUNCA ocultar sin validación completa
  // ────────────────────────────────────────────────────────────
  function _setOverlayState(visible, message, level = 'info') {
    const overlay   = document.getElementById('auth-overlay');
    const msg       = document.getElementById('auth-msg');
    const loader    = document.getElementById('auth-loader');
    const demoBtn   = document.getElementById('auth-demo');

    if (!overlay) {
      console.error('[Auth][BUNKER] #auth-overlay no encontrado en DOM');
      return;
    }

    if (visible) {
      overlay.hidden = false;
      overlay.style.display = 'flex';

      if (loader) loader.style.display = 'none';

      if (msg) {
        msg.hidden = false;
        msg.textContent = message || '🔒 Verificando Bóveda Fiscal...';
        switch (level) {
          case 'error':
            msg.className = 'auth-msg error';
            msg.style.color = '#ef4444';
            break;
          case 'rls_blocked':
            msg.className = 'auth-msg rls-blocked';
            msg.style.cssText = 'color:#f97316;font-weight:700;border:1px solid #f97316;padding:10px 14px;border-radius:8px;background:rgba(249,115,22,0.1);';
            break;
          case 'success':
            msg.className = 'auth-msg success';
            msg.style.color = '#10b981';
            break;
          default:
            msg.className = 'auth-msg info';
            msg.style.color = '#f59e0b';
        }
      }

      if (demoBtn) {
        const showDemo = (level === 'error' || level === 'rls_blocked');
        demoBtn.disabled = !showDemo;
        demoBtn.hidden   = !showDemo;
      }

    } else {
      // Solo llamado desde _unlockDashboard o bypassToDemo
      overlay.hidden = false; // evitar parpadeo
      overlay.style.display = 'none';
      overlay.hidden = true;
      if (msg)    { msg.hidden = true; msg.textContent = ''; }
      if (loader) { loader.style.display = 'none'; }
    }
  }

  // ────────────────────────────────────────────────────────────
  // FIX CRÍTICO #2 — _unlockDashboard
  // Orden: 1) deshabilitar guard CSS, 2) eliminar nodo,
  //        3) manipular display, 4) llamar App.init()
  // Sin este orden, el !important gana y #app queda oculto.
  // ────────────────────────────────────────────────────────────
  function _unlockDashboard(user) {
    console.info('[Auth][UNLOCK] Iniciando secuencia de desbloqueo para:', user?.email ?? 'Demo');

    // Paso 1: Neutralizar bunker guard ANTES de tocar display
    _removeBunkerGuard();

    // Paso 2: Ocultar overlay
    _setOverlayState(false);

    // Paso 3: Mostrar #app — después de remover el guard, esto funciona
    const app = document.getElementById('app');
    if (app) {
      app.hidden = false;
      app.style.visibility = 'visible';
      app.style.display    = 'flex'; // o 'block', según tu CSS base
      void app.offsetHeight; // forzar reflow
    } else {
      console.error('[Auth][UNLOCK] #app no encontrado en DOM');
    }

    // Paso 4: Actualizar UI con datos del usuario
    const chip      = document.getElementById('user-chip');
    const emailEl   = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');

    if (chip)      chip.hidden = false;
    if (emailEl)   emailEl.textContent = user?.email || 'Modo Demo';
    if (logoutBtn) logoutBtn.hidden = false;

    // Paso 5: Actualizar estado global
    window.APP_STATE.authError      = null;
    window.APP_STATE.currentUser    = user;
    window.APP_STATE.authInitialized = true;

    // Paso 6: Disparar App.init() — setTimeout(0) cede el hilo al browser
    // para que pinte el #app antes de ejecutar lógica pesada
    setTimeout(() => {
      if (typeof window.App?.init === 'function') {
        console.info('[Auth][UNLOCK] Llamando App.init()');
        window.App.init();
      } else if (typeof window.Dashboard?.syncAndRender === 'function') {
        console.info('[Auth][UNLOCK] Llamando Dashboard.syncAndRender()');
        window.Dashboard.syncAndRender();
      } else {
        console.warn('[Auth][UNLOCK] Ni App.init ni Dashboard.syncAndRender disponibles');
      }
      _injectWelcomeMessage();
    }, 50); // 50ms: suficiente para el reflow, no perceptible al usuario

    console.info('[Auth][UNLOCK] ✅ Dashboard desbloqueado para:', user?.email ?? 'Demo');
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
      `(reincidencia: ${FISCAL.ART_86C}).<br><br>` +
      `${FISCAL.ART_113F}: Antes de confirmar declaración anual, ` +
      `se verificarán ingresos mixtos.<br><br>` +
      `📘 <strong>Fiscalidad RESICO 2026:</strong><br>` +
      `• ISR: sobre ingresos <strong>brutos</strong> (1–2.5%), sin deducción de gastos.<br>` +
      `• IVA: acreditable <strong>solo</strong> con CFDI válido de gasto indispensable.`;
    chatEl.appendChild(bubble);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = [
      'position:fixed','top:0','left:0','right:0','z-index:99998',
      'background:#92400e','color:#fff','padding:10px 16px',
      'text-align:center','font-size:13px','font-weight:700'
    ].join(';');
    banner.textContent =
      `⚠️ MODO DEMO — Datos simulados. ` +
      `${FISCAL.ART_17K}: multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN ` +
      `por Buzón Tributario inactivo.`;
    document.body.prepend(banner);
  }

  // ────────────────────────────────────────────────────────────
  // VALIDACIÓN COMBINADA Promise.all — núcleo del Bunker State
  // ────────────────────────────────────────────────────────────
  async function _runCombinedValidation(client) {
    _setOverlayState(true, '🔒 Verificando Bóveda Fiscal...', 'info');

    const timeoutSignal = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT_SUPABASE')), SUPABASE_TIMEOUT_MS)
    );

    try {
      const [sessionResult, metricsResult] = await Promise.race([
        Promise.all([
          client.auth.getSession(),
          client.from('fiscal_metrics').select('user_id').limit(1)
        ]),
        timeoutSignal
      ]);

      // ── Condición A: Sesión válida ───────────────────────────
      const { data: sessionData, error: sessionError } = sessionResult;
      const session = sessionData?.session;

      if (sessionError || !session) {
        console.warn('[Auth][A] Sin sesión:', sessionError?.message ?? 'null session');
        _setOverlayState(true, '🔐 Inicia sesión para acceder a tu Bóveda Fiscal.', 'info');
        // Habilitar demo en pantalla de login
        const db = document.getElementById('auth-demo');
        if (db) { db.disabled = false; db.hidden = false; }
        return false;
      }

      // ── Condición B: Integridad RLS ──────────────────────────
      const { error: metricsError } = metricsResult;

      if (metricsError) {
        const is403 =
          metricsError.code === 'PGRST301'         ||
          metricsError.code === '42501'             ||
          (metricsError.status ?? 0) === 403        ||
          (metricsError.message ?? '').toLowerCase().includes('permission denied') ||
          (metricsError.message ?? '').toLowerCase().includes('row-level security');

        if (is403) {
          console.error('[Auth][B][RLS-BLOCK] 403 fiscal_metrics:', metricsError);
          _setOverlayState(
            true,
            '⚠️ Acceso Restringido — Tu Bóveda Fiscal no está sincronizada. Contacta a soporte.',
            'rls_blocked'
          );
        } else {
          console.warn('[Auth][B] Error no-403:', metricsError.message);
          _setOverlayState(
            true,
            `⚠️ Error de conexión con Bóveda Fiscal (${metricsError.code ?? 'RED'}). Intenta de nuevo.`,
            'error'
          );
        }
        return false;
      }

      // ── Éxito total ──────────────────────────────────────────
      const user = session.user;
      currentUser = user;
      _unlockDashboard(user);
      return true;

    } catch (err) {
      if (err.message === 'TIMEOUT_SUPABASE') {
        console.error('[Auth] Timeout Supabase (>8s)');
        _setOverlayState(true, '⏳ Tiempo de espera excedido. Verifica tu conexión o usa Demo.', 'error');
      } else {
        console.error('[Auth] Error crítico:', err);
        _setOverlayState(true, '🚨 Error crítico de seguridad. Contacta a soporte.', 'error');
      }
      return false;
    }
  }

  // ────────────────────────────────────────────────────────────
  // INICIALIZACIÓN PRINCIPAL
  // ────────────────────────────────────────────────────────────
  async function initialize() {
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado.');
      return true;
    }
    if (_initializing) {
      console.log('[Auth] Re-usando promesa en curso...');
      return _initPromise;
    }

    _initializing = true;
    _initPromise = (async () => {
      const client = window.APP_STATE?.supabase;
      const url    = window.AppConfig?.getSupabaseUrl?.() || '';
      const key    = window.AppConfig?.getSupabaseKey?.() || '';

      if (!url || !key || !client) {
        console.warn('[Auth] Supabase no configurado. Solo Modo Demo disponible.');
        _setOverlayState(true, '⚠️ Servicio no disponible. Usa "Ver Demo" para continuar.', 'error');
        const db = document.getElementById('auth-demo');
        if (db) { db.disabled = false; db.hidden = false; }
        _authInitialized = true;
        _initializing    = false;
        return false;
      }

      // onAuthStateChange: SOLO para detectar SIGNED_OUT
      // NUNCA para abrir el dashboard (eso es exclusivo de _runCombinedValidation)
      client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          console.info('[Auth][onAuthStateChange] SIGNED_OUT → re-bloqueando.');
          currentUser = null;
          window.APP_STATE.currentUser = null;
          window.APP_STATE.isDemo = false;
          _authInitialized = false;
          _initializing    = false;
          _initPromise     = null;

          const app = document.getElementById('app');
          if (app) { app.hidden = true; app.style.display = 'none'; }

          _reinstallBunkerGuard();
          _setOverlayState(true, '🔐 Sesión cerrada. Inicia sesión para continuar.', 'info');

          document.getElementById('demo-banner')?.remove();
          const db = document.getElementById('auth-demo');
          if (db) { db.disabled = false; db.hidden = false; }
        }
      });

      const result = await _runCombinedValidation(client);
      _authInitialized = result;
      _initializing    = false;
      return result;
    })();

    return _initPromise;
  }

  // ────────────────────────────────────────────────────────────
  // FIX CRÍTICO #3 — bypassToDemo
  // Debe remover el bunker guard antes de manipular display,
  // igual que _unlockDashboard. Error original: guard !important
  // bloqueaba el #app aunque _setOverlayState pusiera display:none.
  // ────────────────────────────────────────────────────────────
  function bypassToDemo() {
    console.info('[Auth][DEMO] Activando Modo Demo.');
    window.APP_STATE.isDemo = true;

    _showDemoBanner();
    window.MockData?.load?.(window.Store);

    // Mismo orden que _unlockDashboard: guard primero, display después
    _removeBunkerGuard();
    _setOverlayState(false);

    const app = document.getElementById('app');
    if (app) {
      app.hidden = false;
      app.style.visibility = 'visible';
      app.style.display    = 'flex';
      void app.offsetHeight;
    }

    const chip      = document.getElementById('user-chip');
    const emailEl   = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');

    if (chip)      chip.hidden = false;
    if (emailEl)   emailEl.textContent = 'Modo Demo';
    if (logoutBtn) logoutBtn.hidden = false;

    window.APP_STATE.currentUser = null;

    setTimeout(() => {
      if (typeof window.App?.init === 'function') {
        window.App.init();
      } else if (typeof window.Dashboard?.syncAndRender === 'function') {
        window.Dashboard.syncAndRender();
      }
      _injectWelcomeMessage();
    }, 50);
  }

  // ────────────────────────────────────────────────────────────
  // BINDING DE EVENTOS DE UI
  // ────────────────────────────────────────────────────────────
  function bindEvents() {
    const submitBtn   = document.getElementById('auth-submit');
    const demoBtn     = document.getElementById('auth-demo');
    const msgEl       = document.getElementById('auth-msg');
    const emailInput  = document.getElementById('auth-email');
    const passInput   = document.getElementById('auth-password');
    const logoutBtn   = document.getElementById('logout-btn');
    const tabLogin    = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const forgotBtn   = document.getElementById('auth-forgot-password');

    if (!submitBtn) {
      console.warn('[Auth] #auth-submit no encontrado. Verifica el DOM.');
      return;
    }

    // Tabs Login / Registro
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

    // ── Submit Login / Registro ────────────────────────────────
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
          if (authResult.data?.user && !authResult.data?.session) {
            if (msgEl) {
              msgEl.hidden = false;
              msgEl.textContent = '✅ Cuenta creada. Revisa tu correo para confirmar.';
              msgEl.className = 'auth-msg success';
              msgEl.style.color = '#10b981';
            }
            return;
          }
        } else {
          authResult = await client.auth.signInWithPassword({ email, password: pass });
          if (authResult.error) throw authResult.error;
        }

        // FIX CRÍTICO #2: Resetear estado ANTES de llamar initialize()
        // Sin esto, initialize() detecta _authInitialized=true y retorna
        // sin ejecutar _runCombinedValidation ni _unlockDashboard.
        _authInitialized = false;
        _initializing    = false;
        _initPromise     = null;

        // Re-ejecutar validación completa (sesión + RLS)
        await initialize();

      } catch (err) {
        const ERROR_MAP = {
          'Invalid login credentials':   'Correo o contraseña incorrectos.',
          'Email not confirmed':          'Confirma tu correo antes de ingresar.',
          'User already registered':      'Ese correo ya tiene cuenta registrada.',
          'Password should be at least 6 characters': 'Contraseña mínimo 6 caracteres.'
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

    // Enter en inputs
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); })
    );

    // Botón Demo
    demoBtn?.addEventListener('click', bypassToDemo);

    // Recuperar contraseña
    forgotBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput?.value?.trim();
      if (!email) {
        if (msgEl) {
          msgEl.hidden = false;
          msgEl.textContent = 'Ingresa tu correo para el enlace de recuperación.';
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
          msgEl.textContent = '📧 Correo de recuperación enviado. Revisa tu bandeja.';
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
      // El resto lo maneja onAuthStateChange(SIGNED_OUT)
    });
  }

  // ────────────────────────────────────────────────────────────
  // API PÚBLICA
  // ────────────────────────────────────────────────────────────
  async function init() {
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado, omitiendo re-init.');
      return;
    }
    bindEvents();
    await initialize();
  }

  return {
    init,
    initialize,
    bypassToDemo,
    isInitialized:  () => _authInitialized,
    getCurrentUser: () => currentUser
  };

})();

window.AuthManager = AuthManager;