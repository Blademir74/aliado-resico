/**
 * init-db.js v2.5
 * Inicialización Supabase para Aliado RESICO.
 * Credenciales correctas — anon key JWT válido.
 */

const SUPABASE_URL = 'https://muwhpvdillphgkuwsaec.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11d2hwdmRpbGxwaGdrdXdzYWVjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3ODc3NTgsImV4cCI6MjA5MzM2Mzc1OH0.TnFEHR2MGqnroXQ8tBOOpKNxNSt1tkNqcscXmt7Ij0A';

const APP_STATE = {
    isProduction: false,
    dbConnected: false,
    supabase: null
};

async function initDatabase() {
    try {
        if (typeof supabase === 'undefined' || !supabase.createClient) {
            throw new Error('Librería Supabase no encontrada. Verifica el CDN en index.html.');
        }

        APP_STATE.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        APP_STATE.isProduction = true;

        // Inyectar credenciales en AppConfig para que Store y OCR las usen
        if (typeof AppConfig !== 'undefined') {
            AppConfig.setSupabaseConfig(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        // Health check
        const { data, error } = await APP_STATE.supabase
            .from('conversations')
            .select('id')
            .limit(1);

        if (error) throw error;

        APP_STATE.dbConnected = true;
        console.log('%c[Supabase] Conexión establecida', 'color:#10b981;font-weight:bold');

        // Inicializar Store con Supabase
        if (typeof Store !== 'undefined') {
            Store.initSupabase();
        }

    } catch (error) {
        console.error('[Supabase] Error de conexión:', error.message);
        APP_STATE.dbConnected = false;
        APP_STATE.isProduction = false;
    }
}

if (typeof window !== 'undefined') {
    window.APP_STATE = APP_STATE;
    window.initDatabase = initDatabase;
    document.addEventListener('DOMContentLoaded', initDatabase);
}
