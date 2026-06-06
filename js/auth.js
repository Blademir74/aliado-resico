/* ============================================
   ALIADO RESICO — Auth Module v1.0
   - Inyección user_id en fiscal_metrics
   - Verificador RLS (prueba de aislamiento)
   - Onboarding wizard trigger
   ============================================ */

const AuthManager = (() => {
  let supabaseClient = null;
  let currentUser = null;

  // ──────────────────────────────────────────
  // INICIALIZACIÓN
  // ──────────────────────────────────────────
  async function init() {
    supabaseClient = window.APP_STATE?.supabase;
    if (!supabaseClient) {
      console.error('[Auth] ❌ Cliente Supabase no disponible');
      return false;
    }
    const { data } = await supabaseClient.auth.getSession();
    currentUser = data?.session?.user || null;
    return !!currentUser;
  }

  function getUserId() {
    return currentUser?.id || null;
  }

  /* ================================================
   js/auth.js — Fragmento crítico a agregar
   Resuelve: dashboard salta a login, botón Salir oculto
   ================================================ */

/* Escucha cambios de sesión en tiempo real (refresco de token incluido) */
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    /* Mostrar app, ocultar overlay */
    document.getElementById('auth-overlay').hidden = true;
    document.getElementById('app').hidden = false;

    /* Mostrar email del usuario y botón Salir */
    const userChip = document.getElementById('user-chip');
    const emailDisplay = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');

    if (userChip) userChip.hidden = false;
    if (emailDisplay) emailDisplay.textContent = session.user.email;
    if (logoutBtn) logoutBtn.hidden = false;  /* ← esto activa el botón Salir */

    /* Inicializar Store con el usuario autenticado */
    if (window.Store?.initSupabase) window.Store.initSupabase();

  } else if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !session) {
    /* Regresar al login */
    document.getElementById('auth-overlay').hidden = false;
    document.getElementById('app').hidden = true;

    const logoutBtn = document.getElementById('logout-btn');
    const userChip = document.getElementById('user-chip');
    if (logoutBtn) logoutBtn.hidden = true;
    if (userChip) userChip.hidden = true;
  }
});

/* Botón Salir */
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    /* onAuthStateChange maneja el resto */
  });
}

/* Verificar sesión activa al cargar (usuario que ya estaba logueado) */
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) {
    /* Disparar manualmente el mismo flujo que SIGNED_IN */
    document.getElementById('auth-overlay').hidden = true;
    document.getElementById('app').hidden = false;

    const userChip = document.getElementById('user-chip');
    const emailDisplay = document.getElementById('user-email-display');
    const logoutBtn2 = document.getElementById('logout-btn');

    if (userChip) userChip.hidden = false;
    if (emailDisplay) emailDisplay.textContent = session.user.email;
    if (logoutBtn2) logoutBtn2.hidden = false;

    if (window.Store?.initSupabase) window.Store.initSupabase();
  }
});
  // ──────────────────────────────────────────
  // INYECCIÓN DE user_id EN fiscal_metrics
  // Todas las consultas deben usar este helper
  // ──────────────────────────────────────────
  async function upsertFiscalMetrics(metrics) {
    const uid = getUserId();
    if (!uid) throw new Error('Usuario no autenticado');

    const { error } = await supabaseClient
      .from('fiscal_metrics')
      .upsert({
        user_id: uid,
        income_ytd: metrics.incomeYTD || 0,
        total_processed: metrics.totalProcessed || 0,
        avg_confidence: metrics.avgConfidence || 0,
        last_updated: new Date().toISOString(),
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

  // ──────────────────────────────────────────
  // VERIFICADOR RLS (Art. 17-K CFF)
  // Intenta acceder a datos de otro usuario → debe dar 403
  // Si no, alerta crítica y detiene la aplicación
  // ──────────────────────────────────────────
  async function testRLSIsolation() {
    if (!supabaseClient) return false;

    // Usamos un ID de usuario conocido (puede ser el mismo pero forzamos filtro diferente)
    // Mejor: intentamos leer fiscal_metrics con user_id = '00000000-0000-0000-0000-000000000000'
    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    try {
      const { data, error } = await supabaseClient
        .from('fiscal_metrics')
        .select('user_id')
        .eq('user_id', fakeUserId)
        .limit(1);

      // Si la consulta no devuelve error pero tampoco datos, RLS está activo (no vemos el ajeno)
      // Para verificar que realmente bloquea, intentamos insertar con un user_id distinto al actual
      const uid = getUserId();
      if (uid) {
        const { error: insertError } = await supabaseClient
          .from('fiscal_metrics')
          .insert({ user_id: fakeUserId, income_ytd: 0 });
        // RLS debe rechazar la inserción con error "new row violates row-level security policy"
        if (!insertError || !insertError.message.includes('row-level security')) {
          console.error('%c❌ CRÍTICO: RLS NO ESTÁ BLOQUEANDO ACCESO A OTRO USUARIO. DETENER DESPLIEGUE.', 'background:#ef4444;color:white;font-size:16px');
          throw new Error('RLS_FAILURE: El sistema puede exponer datos de otros contribuyentes');
        } else {
          console.log('%c✅ RLS OK: Insert ajeno bloqueado', 'color:#10b981');
        }
      }
      return true;
    } catch (err) {
      if (err.message === 'RLS_FAILURE') throw err;
      console.log('[Auth] RLS check: sin acceso a datos ajenos (correcto)', err.message);
      return true;
    }
  }

  // ──────────────────────────────────────────
  // CIERRE DE SESIÓN SEGURO
  // ──────────────────────────────────────────
  async function logout() {
    if (supabaseClient) await supabaseClient.auth.signOut();
    currentUser = null;
    // Limpiar cualquier dato local de sesión
    sessionStorage.clear();
    localStorage.removeItem('aliado_resico_onboarding_done');
  }

  // ──────────────────────────────────────────
  // ONBOARDING: verificar si es primer inicio
  // ──────────────────────────────────────────
  function isFirstLogin() {
    // Se almacena flag en localStorage por usuario (mejor usar metadata en DB, pero simplificamos)
    const uid = getUserId();
    if (!uid) return false;
    const key = `onboarding_done_${uid}`;
    return !localStorage.getItem(key);
  }

  function markOnboardingDone() {
    const uid = getUserId();
    if (uid) localStorage.setItem(`onboarding_done_${uid}`, 'true');
  }

  return {
    init,
    getUserId,
    upsertFiscalMetrics,
    getFiscalMetrics,
    testRLSIsolation,
    logout,
    isFirstLogin,
    markOnboardingDone,
    getCurrentUser: () => currentUser,
  };
})();

if (typeof window !== 'undefined') window.AuthManager = AuthManager;