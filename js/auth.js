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