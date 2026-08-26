// js/auth.js — v8 CERTIFICADO (PASO 1: Consola Limpia)
// Validación SECUENCIAL: sesión primero, métricas solo con sesión (cero 401 rojos).
(function installBunkerGuard() {
  if (document.getElementById('auth-bunker-guard')) return;
  const style = document.createElement('style');
  style.id = 'auth-bunker-guard';
  style.textContent = `#auth-overlay{display:flex!important;visibility:visible!important;opacity:1!important;pointer-events:all!important;z-index:99999!important}#app{display:none!important;visibility:hidden!important}`;
  (document.head || document.documentElement).appendChild(style);
})();
window.APP_STATE = window.APP_STATE || { supabase: null, currentUser: null, isDemo: false, authInitialized: false, authError: null, appBootstrapped: false, appReady: false };
window.MockData = window.MockData || { load(store) { store?.setState?.({ conversations: [], incomeYTD: 0 }); } };

const AuthManager = (() => {
  let currentUser = null, _authInitialized = false, _initializing = false, _initPromise = null, _authSubscriptionBound = false, isRegister = false;
  const SUPABASE_TIMEOUT_MS = 8000;

  function removeBunkerGuard() {
    ['auth-bunker-guard', 'auth-guard-css'].forEach(id => {
      const g = document.getElementById(id);
      if (g) { try { if (g.sheet) g.sheet.disabled = true; } catch (_) {} g.remove(); }
    });
  }
  function _reinstallBunkerGuard() {
    if (document.getElementById('auth-bunker-guard')) return;
    const style = document.createElement('style');
    style.id = 'auth-bunker-guard';
    style.textContent = `#auth-overlay{display:flex!important;visibility:visible!important;opacity:1!important;pointer-events:all!important;z-index:99999!important}#app{display:none!important;visibility:hidden!important}`;
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
      if (demoBtn) { demoBtn.hidden = false; demoBtn.disabled = !['error', 'rls_blocked', 'info'].includes(level); }
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
    bubble.textContent = '🛡️ Aliado RESICO activo. Tu acceso fue validado y la Bóveda Fiscal quedó sincronizada.';
    chatEl.appendChild(bubble); chatEl.scrollTop = chatEl.scrollHeight;
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
    try { await window.Dashboard?.init?.(); } catch (e) { console.warn('[Auth] Dashboard.init:', e?.message); }
    if (!window.__ALIADO_STORE_WATCHERS_BOUND__) {
      window.Store?.on?.('storeUpdated', () => window.Dashboard?.syncAndRender?.());
      window.Store?.on?.('storeReset', () => window.Dashboard?.syncAndRender?.());
      window.__ALIADO_STORE_WATCHERS_BOUND__ = true;
    }
    window.APP_STATE.appBootstrapped = true;
  }
  async function _unlockDashboard(user) {
    removeBunkerGuard(); _setOverlayState(false); _showAppChrome(user);
    window.APP_STATE.currentUser = user; window.APP_STATE.authError = null; window.APP_STATE.authInitialized = true;
    await _ensureAppBootstrapped();
    setTimeout(() => { window.App?.navigateTo?.('dashboard'); window.Dashboard?.syncAndRender?.(); _injectWelcomeMessage(); }, 50);
  }

  // ── SECUENCIAL: sesión primero; fiscal_metrics SOLO con sesión (cero 401) ──
  async function _runCombinedValidation(client) {
    _setOverlayState(true, '🔒 Verificando Bóveda Fiscal...', 'info');
    const timeoutSignal = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_SUPABASE')), SUPABASE_TIMEOUT_MS));
    try {
      const sessionResult = await Promise.race([client.auth.getSession(), timeoutSignal]);
      const session = sessionResult?.data?.session;
      if (sessionResult?.error || !session) {
        _setOverlayState(true, '🔐 Inicia sesión para acceder a tu Bóveda Fiscal.', 'info');
        return false;
      }
      const metricsResult = await Promise.race([
        client.from('fiscal_metrics').select('user_id').limit(1), timeoutSignal
      ]);
      if (metricsResult?.error) {
        const m = metricsResult.error;
        const is403 = m.code === 'PGRST301' || m.code === '42501' || (m.status ?? 0) === 403 ||
          (m.message || '').toLowerCase().includes('permission denied') || (m.message || '').toLowerCase().includes('row-level security');
        _setOverlayState(true, is403
          ? '⚠️ Acceso Restringido - Tu Bóveda Fiscal no está sincronizada. Contacta a soporte.'
          : `⚠️ Error de conexión con la Bóveda Fiscal (${m.code ?? 'RED'}).`, is403 ? 'rls_blocked' : 'error');
        return false;
      }
      currentUser = session.user;
      await _unlockDashboard(currentUser);
      return true;
    } catch (err) {
      _setOverlayState(true, err.message === 'TIMEOUT_SUPABASE'
        ? '⏳ Tiempo de espera excedido. Verifica tu conexión o usa Demo.'
        : '🚨 Error crítico de seguridad. Contacta a soporte.', 'error');
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
        Object.assign(window.APP_STATE, { currentUser: null, isDemo: false, authInitialized: false, appBootstrapped: false });
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
    window.APP_STATE.isDemo = true; window.APP_STATE.currentUser = null; window.APP_STATE.authInitialized = true;
    _showDemoBanner();
    window.MockData?.load?.(window.Store);
    // ── FIX W-7: el demo respeta los datos que el usuario ya guardó ──
try {
  const st = window.Store?.getState?.() || {};
  const tieneDatosPropios = !!st.diagnostic?.completedAt || Number(st.incomeYTD || 0) > 0;
  if (!tieneDatosPropios) {
    window.Store?.updateIncome?.(1420000);
    window.Store?.updateSaludFiscal?.({ buzonTributarioActivo: true, eFirmaVigente: true, eFirmaExpiry: '2027-12-31', alertLevel: 'safe', lastAuditDate: new Date().toISOString() });
  } else {
    console.info('[Auth][DEMO] Respetando datos guardados del usuario (income:', st.incomeYTD, ')');
  }
} catch (e) { console.warn('[Auth] demo bootstrap:', e.message); }
    removeBunkerGuard(); _setOverlayState(false); _showAppChrome(null);
    _ensureAppBootstrapped().then(() => setTimeout(() => {
      window.App?.navigateTo?.('dashboard'); window.Dashboard?.syncAndRender?.(); _injectWelcomeMessage();
    }, 50));
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
        isRegister = false; tabLogin.classList.add('active'); tabRegister?.classList.remove('active');
        if (submitBtn) submitBtn.textContent = '🔐 Iniciar Sesión';
        if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
      });
    }
    if (tabRegister && !tabRegister.dataset.boundAuth) {
      tabRegister.dataset.boundAuth = '1';
      tabRegister.addEventListener('click', () => {
        isRegister = true; tabRegister.classList.add('active'); tabLogin?.classList.remove('active');
        if (submitBtn) submitBtn.textContent = '✅ Crear Cuenta';
        if (msgEl) { msgEl.hidden = true; msgEl.textContent = ''; }
      });
    }
    if (submitBtn && !submitBtn.dataset.boundAuth) {
      submitBtn.dataset.boundAuth = '1';
      submitBtn.addEventListener('click', async () => {
        const email = emailInput?.value?.trim(); const pass = passInput?.value;
        if (!email || !pass) { if (msgEl) { msgEl.hidden = false; msgEl.textContent = 'Ingresa correo y contraseña.'; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; } return; }
        const client = window.APP_STATE?.supabase;
        if (!client) { if (msgEl) { msgEl.hidden = false; msgEl.textContent = '⚠️ Servicio no disponible. Usa "Ver Demo".'; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; } return; }
        submitBtn.disabled = true; submitBtn.textContent = '⏳ Verificando...';
        try {
          let authResult;
          if (isRegister) {
            authResult = await client.auth.signUp({ email, password: pass });
            if (authResult.error) throw authResult.error;
            if (authResult.data?.user && !authResult.data?.session) {
              if (msgEl) { msgEl.hidden = false; msgEl.textContent = '✅ Cuenta creada. Revisa tu correo para confirmar.'; msgEl.className = 'auth-msg success'; msgEl.style.color = '#10b981'; } return;
            }
          } else {
            authResult = await client.auth.signInWithPassword({ email, password: pass });
            if (authResult.error) throw authResult.error;
          }
          _authInitialized = false; _initializing = false; _initPromise = null; window.APP_STATE.authInitialized = false;
          await initialize();
        } catch (err) {
          const map = { 'Invalid login credentials': 'Correo o contraseña incorrectos.', 'Email not confirmed': 'Confirma tu correo antes de entrar.', 'User already registered': 'Ese correo ya tiene cuenta.' };
          if (msgEl) { msgEl.hidden = false; msgEl.textContent = map[err.message] || err.message; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; }
        } finally { submitBtn.disabled = false; submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión'; }
      });
      [emailInput, passInput].forEach(el => el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); }));
    }
    // DUEÑO ÚNICO del botón Demo (sin listener duplicado externo)
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
        const client = window.APP_STATE?.supabase; if (!client) return;
        forgotBtn.textContent = '⏳ Enviando...';
        try {
          const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/api/auth-callback?next=/` });
          if (error) throw error;
          if (msgEl) { msgEl.hidden = false; msgEl.textContent = 'Correo de recuperación enviado.'; msgEl.className = 'auth-msg success'; msgEl.style.color = '#10b981'; }
        } catch (err) { if (msgEl) { msgEl.hidden = false; msgEl.textContent = err.message; msgEl.className = 'auth-msg error'; msgEl.style.color = '#ef4444'; } }
        finally { forgotBtn.textContent = '¿Olvidaste tu contraseña?'; }
      });
    }
    if (logoutBtn && !logoutBtn.dataset.boundAuth) {
      logoutBtn.dataset.boundAuth = '1';
      logoutBtn.addEventListener('click', async () => {
        const client = window.APP_STATE?.supabase; const isDemo = window.APP_STATE?.isDemo === true;
        try {
          if (client && !isDemo) await client.auth.signOut();
          Object.assign(window.APP_STATE, { currentUser: null, isDemo: false, authInitialized: false, appBootstrapped: false });
          window.Store?.reset?.();
          document.getElementById('demo-banner')?.remove();
          if (window.location.hash) history.replaceState(null, '', window.location.pathname);
          const app = document.getElementById('app'); if (app) { app.hidden = true; app.style.display = 'none'; }
          const overlay = document.getElementById('auth-overlay'); if (overlay) { overlay.style.display = 'flex'; overlay.hidden = false; }
          setTimeout(() => window.location.reload(), 150);
        } catch (error) { window.location.reload(); }
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
        _authInitialized = false; _initializing = false; return false;
      }
      _bindAuthStateListenerOnce();
      const result = await _runCombinedValidation(client);
      _authInitialized = result; window.APP_STATE.authInitialized = result; _initializing = false;
      return result;
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
// [PASO 1] SIN listener externo duplicado del botón Demo.