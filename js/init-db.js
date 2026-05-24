/* ============================================
   ALIADO RESICO — init-db.js v5.0
   Fix: APP_STATE es window-level desde el inicio
   Fix: initDatabase es idempotente
   Fix: NO llama AppConfig.setSupabaseConfig
        (esa función no existe en producción)
   ============================================ */

// Credenciales hardcoded son seguras: son la anon key
// pública de Supabase (RLS protege los datos).
const _SB_URL = 'https://muwhpvdillphgkuwsaec.supabase.co';
const _SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11d2hwdmRpbGxwaGdrdXdzYWVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3ODc3NTgsImV4cCI6MjA5MzM2Mzc1OH0.TnFEHR2MGqnroXQ8tBOOpKNxNSt1tkNqcscXmt7Ij0A';

// Definir APP_STATE global antes de cualquier uso
window.APP_STATE = window.APP_STATE || {
  supabase:     null,
  dbConnected:  false,
  isProduction: false,
};

async function initDatabase() {
  // Idempotente: no reinicializar si ya está conectado
  if (window.APP_STATE.dbConnected) {
    console.log('[Supabase] Ya inicializado');
    return;
  }

  try {
    // window.supabase = librería CDN (tiene .createClient)
    // window.APP_STATE.supabase = cliente instanciado
    if (!window.supabase?.createClient) {
      throw new Error('Librería supabase-js no encontrada en CDN');
    }

    window.APP_STATE.supabase = window.supabase.createClient(_SB_URL, _SB_KEY);
    window.APP_STATE.isProduction = true;

    // Health check
    const { error } = await window.APP_STATE.supabase
      .from('conversations').select('id').limit(1);

    if (error) throw error;

    window.APP_STATE.dbConnected = true;
    console.log('%c[Supabase] ✅ Conexión establecida', 'color:#10b981;font-weight:bold');

    // Inicializar Store DESPUÉS de que APP_STATE.supabase esté listo
    if (typeof Store !== 'undefined') {
      await Store.initSupabase();
    }

  } catch (err) {
    window.APP_STATE.dbConnected  = false;
    window.APP_STATE.isProduction = false;
    console.warn('[Supabase] Modo offline:', err.message);
  }
}

window.initDatabase = initDatabase;

// NO auto-ejecutar aquí — App.init() lo llama en la
// secuencia correcta después de esperar el CDN