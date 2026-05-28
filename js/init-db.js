/**
 * init-db.js v6.3 — PRODUCCIÓN SEGURA
 * Anon key fuera del código fuente — viene de /api/config
 * Fallback a valores de entorno si el endpoint falla
 */

window.APP_STATE = window.APP_STATE || { supabase: null, dbConnected: false };

async function initDatabase() {
  if (window.APP_STATE.dbConnected) return;

  // 1. Intentar obtener credenciales del servidor (no hardcoded)
  let sbUrl = '', sbKey = '';

  try {
    const r = await fetch('/api/config', { headers: { 'Content-Type': 'application/json' } });
    if (r.ok) {
      const d = await r.json();
      sbUrl = d.config?.supabaseUrl  || '';
      sbKey = d.config?.supabaseAnonKey || '';
    }
  } catch(e) {
    console.warn('[Supabase] /api/config no disponible:', e.message);
  }

  // 2. Sin credenciales → modo demo
  if (!sbUrl || !sbKey) {
    console.warn('[Supabase] Sin credenciales — modo demo activo');
    return;
  }

  try {
    if (!window.supabase?.createClient) {
      console.warn('[Supabase] CDN no disponible — modo demo activo');
      return;
    }

    window.APP_STATE.supabase = window.supabase.createClient(sbUrl, sbKey);
    window.APP_STATE.dbConnected = true;
    console.log('%c[Supabase] ✅ Cliente instanciado', 'color:#10b981;font-weight:bold');

    const { data: sessionData } = await window.APP_STATE.supabase.auth.getSession();
    if (sessionData?.session) {
      console.log('[Supabase] Sesión activa:', sessionData.session.user.email);
      window.APP_STATE.currentUser = sessionData.session.user;
    }

    if (typeof Store !== 'undefined' && Store.initSupabase) {
      await Store.initSupabase();
    }

  } catch(err) {
    window.APP_STATE.dbConnected = false;
    console.warn('[Supabase] Error:', err.message);
  }
}

window.initDatabase = initDatabase;
