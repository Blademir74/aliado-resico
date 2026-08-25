/* ════════════════════════════════════════════════════════════
ALIADO RESICO 2026 — auth.js v7.0 (ROBUSTO)
Bunker State + Validación sesión/RLS + Demo estable.
Validación secuencial: sesión PRIMERO, métricas DESPUÉS.
════════════════════════════════════════════════════════════ */
(function installBunkerGuard() {
  if (document.getElementById('auth-bunker-guard')) return;
  const style = document.createElement('style');
  style.id = 'auth-bunker-guard';
  style.textContent = `#auth-overlay { display: flex !important; visibility: visible !important; opacity: 1 !important; pointer-events: all !important; z-index: 99999 !important; } #app { display: none !important; visibility: hidden !important; }`;
  (document.head || document.documentElement).appendChild(style);
})();

window.APP_STATE = window.APP_STATE || { supabase: null, currentUser: null, isDemo: false, authInitialized: false, authError: null, appBootstrapped: false, appReady: false };
window.MockData = window.MockData || {
  load(store) {
    store?.setState({
      conversations: [
        { id: 'demo-1', message_text: '¿Estoy cerca del límite de RESICO?', intent: 'CONSULTA_FISCAL', confidence: 0.96, timestamp: Date.now(), is_fiscal_audit_completed: true, source: 'demo' },
        { id: 'demo-2', message_text: 'Mi buzón tributario está inactivo', intent: 'SALUD_FISCAL', confidence: 0.98, timestamp: Date.now() - 60000, is_fiscal_audit_completed: true, source: 'demo' }
      ],
      incomeYTD: 95500,
      fiscalMetrics: { annualLimit: 3500000, riskLevel: 'SEGURO' },
      saludFiscal: { buzonTributarioActivo: false, eFirmaVigente: true, alertLevel: 'warning' }
    });
  }
};

const AuthManager = (() => {
  let currentUser = null;
  let _authInitialized = false;
  let _initializing = false;
  let _initPromise = null;
  let _authSubscriptionBound = false;
  let isRegister = false;
  const SUPABASE_TIMEOUT_MS = 8000;

  function removeBunkerGuard() {
    const guard = document.getElementById('auth-bunker-guard');
    if (guard) { try { if (guard.sheet) guard.sheet.disabled = true; } catch(_) {} guard.remove(); }
    const legacy = document.getElementById('auth-guard-css');
    if (legacy) { try { if (legacy.sheet) legacy.sheet.disabled = true; } catch(_) {} legacy.remove(); }
  }
  function _reinstallBunkerGuard() {
    if (document.getElementById('auth-bunker-guard')) return;
    const style = document.createElement('style');
    style.id = 'auth-bunker-guard';
    style.textContent = `#auth-overlay { display: flex !important; visibility: visible !important; opacity: 1 !important; pointer-events: all !important; z-index: 99999 !important; } #app { display: none !important; visibility: hidden !important; }`;
    (document.head || document.documentElement).appendChild(style);
  }
  function _setOverlayState(visible, message = '', level = 'info') {
    const overlay = document.getElementById('auth-overlay');
    const msg = document.getElementById('auth-msg');
    const loader = document.getElementById('auth-loader');
    const demoBtn = document.getElementById('auth-demo');
    if (!overlay) return;
    if (visible) {
      overlay.hidden = false; overlay.style.display = 'flex';
      if (loader) loader.style.display = 'none';
      if (msg) {
        msg.hidden = false; msg.textContent = message || '🔒 Verificando Bóveda Fiscal...';
        msg.className = `auth-msg ${level}`;
        msg.style.color = level === 'error' ? '#ef4444' : level === 'rls_blocked' ? '#f97316' : level === 'success' ? '#10b981' : '#f59e0b';
      }
      if (demoBtn) {
        const canUseDemo = ['error','rls_blocked','info'].includes(level);
        demoBtn.hidden = false; demoBtn.disabled = !canUseDemo;
      }
    } else {
      overlay.style.display = 'none'; overlay.hidden = true;
      if (msg) { msg.hidden = true; msg.textContent = ''; }
      if (loader) loader.style.display = 'none';
    }
  }
  function _showAppChrome(user) {
    const app = document.getElementById('app');
    const chip = document.getElementById('user-chip');
    const emailEl = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');
    if (app) { app.hidden = false; app.style.display = 'block'; app.style.visibility = 'visible'; void app.offsetHeight; }
    if (chip) chip.hidden = false;
    if (emailEl) emailEl.textContent = user?.email || 'Modo Demo';
    if (logoutBtn) logoutBtn.hidden = false;
  }
  function _injectWelcomeMessage() {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl || chatEl.dataset.welcomeInjected === '1') return;
    chatEl.dataset.welcomeInjected = '1';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.innerHTML = `🛡️ Aliado RESICO activo. Tu acceso fue validado y la Bóveda Fiscal quedó sincronizada.`;
    chatEl.appendChild(bubble);
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99998;background:#92400e;color:#fff;padding:10px 16px;text-align:center;font-size:13px;font-weight:700;';
    banner.textContent = '⚠️ MODO DEMO — Datos simulados, sin acceso a datos fiscales reales.';
    document.body.prepend(banner);
  }
  async function _ensureAppBootstrapped() {
    if (window.APP_STATE.appBootstrapped) return;
    try { await window.Dashboard?.init?.(); } catch (e) { console.warn('[Auth] Dashboard.init error:', e?.message); }
    try { await window.DocumentProcessor?.init?.(); } catch (e) { console.warn('[Auth] DocumentProcessor.init error:', e?.message); }
    if (!window.APP_STATE.appReady) {
      try { window.App?.bootAuthenticatedArea?.(); } catch (e) { console.warn('[Auth] App.bootAuthenticatedArea error:', e?.message); }
    }
    if (!window.__ALIADO_STORE_WATCHERS_BOUND__) {
      window.Store?.on?.('storeUpdated', () => window.Dashboard?.syncAndRender?.());
      window.Store?.on?.('storeReset', () => window.Dashboard?.syncAndRender?.());
      window.__ALIADO_STORE_WATCHERS_BOUND__ = true;
    }
    window.APP_STATE.appBootstrapped = true;
  }
  async function _unlockDashboard(user) {
    removeBunkerGuard(); _setOverlayState(false); _showAppChrome(user);
    window.APP_STATE.currentUser = user;
    window.APP_STATE.authError = null;
    window.APP_STATE.authInitialized = true;
    await _ensureAppBootstrapped();
    setTimeout(() => {
      window.App?.navigateTo?.('dashboard');
      window.Dashboard?.syncAndRender?.();
      _injectWelcomeMessage();
    }, 50);
  }

  // ── VALIDACIÓN SECUENCIAL: sesión primero, métricas después ──
  async function _runCombinedValidation(client) {
    _setOverlayState(true, '🔒 Verificando Bóveda Fiscal...', 'info');
    const timeoutSignal = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SUPABASE')), SUPABASE_TIMEOUT_MS));
    try {
      // PASO 1: Solo sesión (sin consulta paralela a fiscal_metrics)
      const sessionResult = await Promise.race([client.auth.getSession(), timeoutSignal]);
      const { data: sessionData, error: sessionError } = sessionResult;
      const session = sessionData?.session;
      if (sessionError || !session) {
        _setOverlayState(true, '🔐 Inicia sesión para acceder a tu Bóveda Fiscal.', 'info');
        return false;
      }
      // PASO 2: Con sesión activa, ahora sí consultamos fiscal_metrics
      // (evita el 401 rojo en consola cuando el usuario aún no entra).
      const metricsResult = await Promise.race([
        client.from('fiscal_metrics').select('user_id').limit(1),
        timeoutSignal
      ]);
      const { error: metricsError } = metricsResult;
      if (metricsError) {
        const is403 = metricsError.code === 'PGRST301' || metricsError.code === '42501' ||
          (metricsError.status ?? 0) === 403 ||
          (metricsError.message ?? '').toLowerCase().includes('permission denied') ||
          (metricsError.message ?? '').toLowerCase().includes('row-level security');
        if (is403) {
          _setOverlayState(true, '⚠️ Acceso Restringido - Tu Bóveda Fiscal no está sincronizada. Contacta a soporte.', 'rls_blocked');
        } else {
          _setOverlayState(true, `⚠️ Error de conexión con la Bóveda Fiscal (${metricsError.code ?? 'RED'}).`, 'error');
        }
        return false;
      }
      currentUser = session.user;
      await _unlockDashboard(currentUser);
      return true;
    } catch (err) {
      if (err.message === 'TIMEOUT_SUPABASE') {
        _setOverlayState(true, '⏳ Tiempo de espera excedido. Verifica tu conexión o usa Demo.', 'error');
      } else {
        _setOverlayState(true, '🚨 Error crítico de seguridad. Contacta a soporte.', 'error');
      }
      return false;
    }
  }

  function _bindAuthStateListenerOnce() {
    if (_authSubscriptionBound) return;
    const client = window.APP_STATE?.supabase;
    if (!client?.auth?.onAuthStateChange) return;
    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        window.APP_STATE.currentUser = null;
        window.APP_STATE.isDemo = false;
        window.APP_STATE.authInitialized = false;
        window.APP_STATE.appBootstrapped = false;
        _authInitialized = false; _initializing = false; _initPromise = null;
        const app = document.getElementById('app');
        if (app) { app.hidden = true; app.style.display = 'none'; }
        _reinstallBunkerGuard();
        _setOverlayState(true, '🔐 Sesión cerrada. Inicia sesión para continuar.', 'info');
        document.getElementById('demo-banner')?.remove();
      }
    });
    _authSubscriptionBound = true;
  }

  function bypassToDemo() {
    console.info('[Auth][DEMO] Activando modo demo');
    window.APP_STATE.isDemo = true;
    window.APP_STATE.currentUser = null;
    window.APP_STATE.authInitialized = true;
    _showDemoBanner();
    window.MockData?.load?.(window.Store);
    try {
      window.Store?.updateIncome?.(1420000);
      window.Store?.updateSaludFiscal?.({
        buzonTributarioActivo: true, eFirmaVigente: true,
        eFirmaExpiry: '2027-12-31', alertLevel: 'safe',
        lastAuditDate: new Date().toISOString()
      });
    } catch (e) { console.warn('[Auth] demo bootstrap:', e.message); }
    removeBunkerGuard(); _setOverlayState(false); _showAppChrome(null);
    _ensureAppBootstrapped().then(() => {
      setTimeout(() => {
        window.App?.navigateTo?.('dashboard');
        window.Dashboard?.syncAndRender?.();
        _injectWelcomeMessage();
      }, 50);
    });
  }

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

    if (tabLogin && !tabLogin.dataset.boundAuth) {
      tabLogin.dataset.boundAuth = '1';
      tabLogin.addEventListener('click', () => {
        isRegister = false; tabLogin.classList.add('active');
        tabRegister?.classList.remove('active');
        if (submitBtn) submitBtn.textContent = '🔐 Iniciar Sesión';
        if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
        if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('disabled'); }
      });
    }
    if (tabRegister && !tabRegister.dataset.boundAuth) {
      tabRegister.dataset.boundAuth = '1';
      tabRegister.addEventListener('click', () => {
        isRegister = true; tabRegister.classList.add('active');
        tabLogin?.classList.remove('active');
        if (submitBtn) submitBtn.textContent = '✅ Crear Cuenta';
        if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
      });
    }
    if (submitBtn && !submitBtn.dataset.boundAuth) {
      submitBtn.dataset.boundAuth = '1';
      submitBtn.addEventListener('click', async () => {
        const email = emailInput?.value?.trim();
        const pass = passInput?.value;
        if (!email || !pass) {
          if (msgEl) { msgEl.hidden = false; msgEl.textContent = 'Ingresa correo y contraseña.'; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; }
          return;
        }
        const client = window.APP_STATE?.supabase;
        if (!client) {
          console.error('[Auth] ❌ window.APP_STATE.supabase es null.');
          if (msgEl) { msgEl.hidden = false; msgEl.textContent = '⚠️ Servicio no disponible. Usa "Ver Demo".'; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; }
          return;
        }
        submitBtn.disabled = true; submitBtn.textContent = '⏳ Verificando...';
        try {
          let authResult;
          if (isRegister) {
            authResult = await client.auth.signUp({ email, password: pass });
            if (authResult.error) throw authResult.error;
            if (authResult.data?.user && !authResult.data?.session) {
              if (msgEl) { msgEl.hidden = false; msgEl.textContent = '✅ Cuenta creada. Revisa tu correo para confirmar.'; msgEl.className = 'auth-msg success'; msgEl.style.color = '#10b981'; }
              return;
            }
            if (authResult.data?.session) {
              if (msgEl) { msgEl.hidden = false; msgEl.textContent = '✅ Cuenta creada e iniciada sesión.'; msgEl.className = 'auth-msg success'; msgEl.style.color = '#10b981'; }
            }
          } else {
            authResult = await client.auth.signInWithPassword({ email, password: pass });
            if (authResult.error) throw authResult.error;
          }
          _authInitialized = false; _initializing = false; _initPromise = null;
          window.APP_STATE.authInitialized = false;
          if (typeof initialize === 'function') await initialize();
        } catch (err) {
          const map = { 'Invalid login credentials': 'Correo o contraseña incorrectos.', 'Email not confirmed': 'Confirma tu correo antes de entrar.', 'User already registered': 'Ese correo ya tiene cuenta.' };
          if (msgEl) { msgEl.hidden = false; msgEl.textContent = map[err.message] || err.message; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; }
        } finally {
          submitBtn.disabled = false; submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
        }
      });
      [emailInput, passInput].forEach(el => el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); }));
    }
    if (demoBtn && !demoBtn.dataset.boundAuth) {
      demoBtn.dataset.boundAuth = '1';
      demoBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); bypassToDemo(); });
    }
    if (forgotBtn && !forgotBtn.dataset.boundAuth) {
      forgotBtn.dataset.boundAuth = '1';
      forgotBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = emailInput?.value?.trim();
        if (!email) { if (msgEl) { msgEl.hidden = false; msgEl.textContent = 'Ingresa tu correo para restablecer.'; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; } return; }
        const client = window.APP_STATE?.supabase;
        if (!client) return;
        forgotBtn.textContent = '⏳ Enviando...';
        try {
          const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/api/auth-callback?next=/` });
          if (error) throw error;
          if (msgEl) { msgEl.hidden = false; msgEl.textContent = 'Correo de recuperación enviado.'; msgEl.className = 'auth-msg success'; msgEl.style.color = '#10b981'; }
        } catch (err) {
          if (msgEl) { msgEl.hidden = false; msgEl.textContent = err.message; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; }
        } finally { forgotBtn.textContent = '¿Olvidaste tu contraseña?'; }
      });
    }
    if (logoutBtn && !logoutBtn.dataset.boundAuth) {
      logoutBtn.dataset.boundAuth = '1';
      logoutBtn.addEventListener('click', async () => {
        const client = window.APP_STATE?.supabase;
        const isDemo = window.APP_STATE?.isDemo === true;
        try {
          if (client && !isDemo) await client.auth.signOut();
          window.APP_STATE.currentUser = null;
          window.APP_STATE.isDemo = false;
          window.APP_STATE.authInitialized = false;
          window.APP_STATE.appBootstrapped = false;
          window.Store?.reset?.();
          document.getElementById('demo-banner')?.remove();
          if (window.location.hash) history.replaceState(null, '', window.location.pathname);
          const app = document.getElementById('app');
          if (app) { app.hidden = true; app.style.display = 'none'; }
          const overlay = document.getElementById('auth-overlay');
          if (overlay) { overlay.style.display = 'flex'; overlay.hidden = false; }
          setTimeout(() => window.location.reload(), 150);
        } catch (error) { console.error('[Auth] Error en logout:', error); window.location.reload(); }
      });
    }
  }

  async function initialize() {
    if (_authInitialized) return true;
    if (_initializing) return _initPromise;
    _initializing = true;
    _initPromise = (async () => {
      const client = window.APP_STATE?.supabase;
      const url = window.AppConfig?.getSupabaseUrl?.() || '';
      const key = window.AppConfig?.getSupabaseKey?.() || '';
      if (!url || !key || !client) {
        _setOverlayState(true, '⚠️ Servicio de autenticación no disponible. Usa "Ver Demo".', 'error');
        _authInitialized = false; _initializing = false;
        return false;
      }
      _bindAuthStateListenerOnce();
      const result = await _runCombinedValidation(client);
      _authInitialized = result; window.APP_STATE.authInitialized = result;
      _initializing = false; return result;
    })();
    return _initPromise;
  }

  async function init() {
    bindEvents();
    try { await initialize(); }
    catch (e) {
      console.warn('[Auth] initialize() controlado:', e?.message || e);
      _setOverlayState(true, '⚠️ No se pudo verificar la sesión. Usa "Ver demo" o reintenta.', 'error');
    }
  }

  return { init, initialize, bypassToDemo, isInitialized: () => _authInitialized, getCurrentUser: () => currentUser };
})();

window.AuthManager = AuthManager;
// NOTA: NO hay listener externo duplicado del botón Demo.
// bindEvents() dentro de AuthManager es el dueño único.