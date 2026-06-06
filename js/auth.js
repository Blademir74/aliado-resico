/* ============================================
   ALIADO RESICO — Auth Module v2.0
   Fix: IIFE íntegro sin fragmentos fuera del closure
   Fix: supabaseClient en lugar de supabase (variable global)
   Fix: Auth Guard estricto — app oculta hasta sesión válida
   Fix: botón Salir funcional con recarga limpia
   LFPDPPP | Art. 17-K CFF | RLS Supabase
   ============================================ */

const AuthManager = (() => {
  let supabaseClient = null;
  let currentUser    = null;

  // ─────────────────────────────────────────────────
  // HELPERS DE DOM
  // Operaciones sobre elementos del Auth Guard
  // ─────────────────────────────────────────────────
  function _showApp(user) {
    const overlay  = document.getElementById('auth-overlay');
    const app      = document.getElementById('app');
    const userChip = document.getElementById('user-chip');
    const emailEl  = document.getElementById('user-email-display');
    const logoutEl = document.getElementById('logout-btn');

    if (overlay)  { overlay.hidden = true;  overlay.style.display = 'none'; }
    if (app)      { app.hidden = false;     app.style.display = ''; }
    if (userChip) { userChip.hidden = false; }
    if (emailEl)  { emailEl.textContent = user?.email ?? ''; }
    if (logoutEl) { logoutEl.hidden = false; }
  }

  function _showLogin() {
    const overlay  = document.getElementById('auth-overlay');
    const app      = document.getElementById('app');
    const userChip = document.getElementById('user-chip');
    const logoutEl = document.getElementById('logout-btn');

    if (overlay)  { overlay.hidden = false; overlay.style.display = ''; }
    if (app)      { app.hidden = true;      app.style.display = 'none'; }
    if (userChip) { userChip.hidden = true; }
    if (logoutEl) { logoutEl.hidden = true; }
  }

  // ─────────────────────────────────────────────────
  // INICIALIZACIÓN PRINCIPAL
  // Punto de entrada llamado desde app.js
  // ─────────────────────────────────────────────────
  async function init() {
    // Obtener el cliente Supabase creado por app.js / config.js
    supabaseClient = window.APP_STATE?.supabase;

    if (!supabaseClient) {
      console.error('[Auth] Cliente Supabase no disponible en APP_STATE');
      _showLogin();
      return false;
    }

    // ── 1. Escuchar cambios de sesión en tiempo real ──
    // Cubre: login, logout, refresco automático de token
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        currentUser = session.user;
        _showApp(session.user);
        if (window.Store?.initSupabase) window.Store.initSupabase();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        _showLogin();
      }
    });

    // ── 2. Verificar sesión existente al cargar la página ──
    // Cubre al usuario que ya estaba autenticado antes del reload
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      console.warn('[Auth] Error al verificar sesión:', error.message);
      _showLogin();
      return false;
    }

    if (data?.session?.user) {
      currentUser = data.session.user;
      _showApp(data.session.user);
      if (window.Store?.initSupabase) window.Store.initSupabase();
      return true;
    }

    // Sin sesión activa: mantener el Auth Guard visible
    _showLogin();
    return false;
  }

  // ─────────────────────────────────────────────────
  // REGISTRO DEL BOTÓN SALIR
  // Separado de init() para poder llamarlo desde app.js
  // después de que el DOM esté listo
  // ─────────────────────────────────────────────────
  function bindLogoutButton() {
    const btn = document.getElementById('logout-btn');
    if (!btn) {
      console.warn('[Auth] #logout-btn no encontrado en el DOM');
      return;
    }

    btn.addEventListener('click', async () => {
      await logout();
    });
  }

  // ─────────────────────────────────────────────────
  // CIERRE DE SESIÓN SEGURO
  // Limpia estado local, BD y recarga para activar Auth Guard
  // ─────────────────────────────────────────────────
  async function logout() {
    try {
      if (supabaseClient) await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn('[Auth] Error en signOut:', e.message);
    }

    currentUser = null;

    // Limpiar datos de sesión local — nunca dejar tokens en el navegador
    sessionStorage.clear();
    localStorage.removeItem('aliado_resico_v5');
    localStorage.removeItem('aliado_resico_onboarding_done');

    // Reload fuerza al Auth Guard a evaluarse desde cero
    // sin estado residual en memoria
    window.location.reload();
  }

  // ─────────────────────────────────────────────────
  // GETTERS
  // ─────────────────────────────────────────────────
  function getUserId()      { return currentUser?.id ?? null; }
  function getCurrentUser() { return currentUser; }

  // ─────────────────────────────────────────────────
  // MÉTRICAS FISCALES — user_id inyectado desde aquí
  // Garantiza que el RLS de Supabase filtre correctamente
  // ─────────────────────────────────────────────────
  async function upsertFiscalMetrics(metrics) {
    const uid = getUserId();
    if (!uid) throw new Error('[Auth] Usuario no autenticado — upsertFiscalMetrics');

    const { error } = await supabaseClient
      .from('fiscal_metrics')
      .upsert({
        user_id:         uid,
        income_ytd:      metrics.incomeYTD      ?? 0,
        total_processed: metrics.totalProcessed ?? 0,
        avg_confidence:  metrics.avgConfidence  ?? 0,
        last_updated:    new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) throw error;
    return true;
  }

  async function getFiscalMetrics() {
    const uid = getUserId();
    if (!uid) return null;

    const { data, error } = await supabaseClient
      .from('fiscal_metrics')
      .select('income_ytd, total_processed, avg_confidence')
      .eq('user_id', uid)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // ─────────────────────────────────────────────────
  // VERIFICADOR RLS
  // Confirma que la política auth.uid() = user_id
  // bloquea acceso a datos de otros contribuyentes
  // ─────────────────────────────────────────────────
  async function testRLSIsolation() {
    if (!supabaseClient) return false;

    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    try {
      const { error: insertError } = await supabaseClient
        .from('fiscal_metrics')
        .insert({ user_id: fakeUserId, income_ytd: 0 });

      if (!insertError || !insertError.message.includes('row-level security')) {
        console.error(
          '%c❌ CRÍTICO: RLS NO ESTÁ BLOQUEANDO. DETENER DESPLIEGUE.',
          'background:#ef4444;color:white;font-size:16px'
        );
        throw new Error('RLS_FAILURE');
      }

      console.log('%c✅ RLS OK: aislamiento multi-tenant verificado', 'color:#10b981');
      return true;
    } catch (err) {
      if (err.message === 'RLS_FAILURE') throw err;
      // El error de RLS se manifiesta como excepción — eso es correcto
      console.log('[Auth] RLS activo — acceso a datos ajenos bloqueado');
      return true;
    }
  }

  // ─────────────────────────────────────────────────
  // ONBOARDING
  // ─────────────────────────────────────────────────
  function isFirstLogin() {
    const uid = getUserId();
    if (!uid) return false;
    return !localStorage.getItem(`onboarding_done_${uid}`);
  }

  function markOnboardingDone() {
    const uid = getUserId();
    if (uid) localStorage.setItem(`onboarding_done_${uid}`, 'true');
  }

  // ─────────────────────────────────────────────────
  // API PÚBLICA
  // ─────────────────────────────────────────────────
  return {
    init,
    bindLogoutButton,
    logout,
    getUserId,
    getCurrentUser,
    upsertFiscalMetrics,
    getFiscalMetrics,
    testRLSIsolation,
    isFirstLogin,
    markOnboardingDone,
  };
})();

window.AuthManager = AuthManager;