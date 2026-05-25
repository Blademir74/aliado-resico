/**
 * init-db.js v5.2
 * Fix: APP_STATE en window (no const local)
 * Fix: NO llama AppConfig.setSupabaseConfig (bloqueada en prod)
 * Fix: NO auto-ejecuta — App.init() controla el orden
 * Fix: health check acepta PGRST116 (0 filas = OK)
 */

const SUPABASE_URL      = 'https://muwhpvdillphgkuwsaec.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11d2hwdmRpbGxwaGdrdXdzYWVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3ODc3NTgsImV4cCI6MjA5MzM2Mzc1OH0.TnFEHR2MGqnroXQ8tBOOpKNxNSt1tkNqcscXmt7Ij0A';

// APP_STATE en window — accesible desde cualquier módulo
window.APP_STATE = window.APP_STATE || { supabase: null, dbConnected: false };

async function initDatabase() {
  if (window.APP_STATE.dbConnected) return; // idempotente

  try {
    if (!window.supabase?.createClient) {
      throw new Error('CDN supabase-js no cargó aún');
    }

    // Crear el CLIENTE INSTANCIADO — distinto de window.supabase (librería CDN)
    window.APP_STATE.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Health check — PGRST116 = sin filas, es OK
    const { error } = await window.APP_STATE.supabase
      .from('conversations').select('id').limit(1);

    if (error && error.code !== 'PGRST116') throw error;

    window.APP_STATE.dbConnected = true;
    console.log('%c[Supabase] ✅ Conexión establecida', 'color:#10b981;font-weight:bold');

    // Store.initSupabase() espera que APP_STATE.supabase ya esté listo
    if (typeof Store !== 'undefined' && Store.initSupabase) {
      await Store.initSupabase();
    }

  } catch (err) {
    window.APP_STATE.dbConnected = false;
    console.warn('[Supabase] Modo offline:', err.message);
  }
}

window.initDatabase = initDatabase;
// NO document.addEventListener('DOMContentLoaded', initDatabase)
// App.init() lo llama después de esperar el CDN