/* ============================================
   ALIADO RESICO — Configuration Manager
   Producción: Variables de entorno vía Vercel
   Desarrollo: Configuración manual en UI
   ============================================ */

const AppConfig = (() => {
  const STORAGE_KEY = 'aliado_resico_config';

  // =============================================
  // ENVIRONMENT DETECTION
  // En producción (Vercel), las keys vienen del servidor
  // En desarrollo (localhost), se permite configuración manual
  // =============================================
  const IS_PRODUCTION = window.location.hostname !== 'localhost'
    && window.location.hostname !== '127.0.0.1'
    && !window.location.hostname.includes('192.168.');

  // Config inyectada por el endpoint /api/config (producción)
  let serverConfig = null;

  // Config local (solo desarrollo)
  let localConfig = {};

  const listeners = {};

  // --- Event system ---
  function emit(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  }

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }

  // =============================================
  // PRODUCTION: Fetch config from server
  // Las API keys NUNCA llegan al frontend en producción
  // =============================================
  async function loadServerConfig() {
    if (!IS_PRODUCTION) return false;

    try {
      const res = await fetch('/api/config', {
        headers: { 'Content-Type': 'application/json' },
        // Timeout de 5s para no bloquear el boot indefinidamente
        signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
      });

      // Error 500 en api/config = module.exports sin corregir a ESM
      // Mensaje explícito para facilitar diagnóstico en consola
      if (res.status === 500) {
        console.error(
          '%c[Config] ❌ api/config.js devolvió 500.\n' +
          'Causa probable: module.exports en lugar de export default.\n' +
          'Solución: reemplaza module.exports por export default en api/config.js',
          'color:#ef4444;font-weight:bold'
        );
        return false;
      }

      if (!res.ok) {
        console.warn('[Config] Server config endpoint returned:', res.status);
        return false;
      }

      const data = await res.json();
      if (data.ok && data.config) {
        serverConfig = data.config;
        console.log(
          '%c🔒 Modo Producción: Config cargada desde servidor — API keys seguras',
          'color:#10b981;font-weight:bold'
        );
        emit('config:changed', { service: 'all', source: 'server' });
        return true;
      }

      console.warn('[Config] Respuesta inesperada de /api/config:', data);
      return false;

    } catch (e) {
      // AbortError = timeout — no es un error de código
      if (e.name === 'AbortError') {
        console.warn('[Config] /api/config tardó más de 5s — continuando en modo offline');
      } else {
        console.warn('[Config] Failed to load server config:', e.message);
      }
      return false;
    }
  }

  // =============================================
  // DEVELOPMENT: localStorage (solo local)
  // =============================================
  function loadLocalConfig() {
    if (IS_PRODUCTION) return {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }

  function saveLocalConfig(config) {
    if (IS_PRODUCTION) return; // Nunca guardar en localStorage en producción
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('Config: save failed', e);
    }
  }

  localConfig = loadLocalConfig();

  // =============================================
  // GETTERS — Resuelven según entorno
  // Producción: servidor / Desarrollo: localStorage
  // =============================================

  // --- Gemini API ---
  function getGeminiKey() {
    // En producción, Gemini se accede vía proxy — NO se necesita la key en el frontend
    if (IS_PRODUCTION) return null;
    return localConfig.geminiKey || '';
  }

  function isGeminiConfigured() {
    if (IS_PRODUCTION) {
      return serverConfig?.geminiConfigured || false;
    }
    return !!localConfig.geminiKey;
  }

  function setGeminiKey(key) {
    if (IS_PRODUCTION) {
      console.warn('[Config] ⚠️ No se puede setear Gemini key en producción — use variables de entorno en Vercel');
      return;
    }
    localConfig.geminiKey = key.trim();
    saveLocalConfig(localConfig);
    emit('config:changed', { service: 'gemini' });
  }

  // --- Gemini API — SIEMPRE via proxy (nunca directo desde browser) ---
  function getGeminiEndpoint(model) {
    return '/api/gemini-proxy';
  }

  // --- Supabase ---
  function getSupabaseUrl() {
    if (IS_PRODUCTION && serverConfig) return serverConfig.supabaseUrl || '';
    return localConfig.supabaseUrl || '';
  }

  function getSupabaseKey() {
    if (IS_PRODUCTION && serverConfig) return serverConfig.supabaseAnonKey || '';
    return localConfig.supabaseKey || '';
  }

  function isSupabaseConfigured() {
    return !!getSupabaseUrl() && !!getSupabaseKey();
  }

  function setSupabaseConfig(url, key) {
    if (IS_PRODUCTION) {
      console.warn('[Config] ⚠️ No se puede setear Supabase en producción — use variables de entorno en Vercel');
      return;
    }
    localConfig.supabaseUrl = url.trim();
    localConfig.supabaseKey = key.trim();
    saveLocalConfig(localConfig);
    emit('config:changed', { service: 'supabase' });
  }

  // --- n8n Webhook ---
  function getWebhookUrl() {
    if (IS_PRODUCTION && serverConfig) return serverConfig.webhookUrl || '';
    return localConfig.webhookUrl || '';
  }

  function isWebhookConfigured() {
    return !!getWebhookUrl();
  }

  function setWebhookUrl(url) {
    if (IS_PRODUCTION) {
      console.warn('[Config] ⚠️ No se puede setear Webhook en producción — use variables de entorno en Vercel');
      return;
    }
    localConfig.webhookUrl = url.trim();
    saveLocalConfig(localConfig);
    emit('config:changed', { service: 'webhook' });
  }

  // --- Mode Detection ---
  function getMode() {
    if (IS_PRODUCTION) return 'production';
    return isGeminiConfigured() ? 'production' : 'demo';
  }

  function getStatus() {
    return {
      gemini: isGeminiConfigured(),
      supabase: isSupabaseConfigured(),
      webhook: isWebhookConfigured(),
      mode: getMode(),
      environment: IS_PRODUCTION ? 'vercel' : 'local',
    };
  }

  // =============================================
  // CONNECTION TESTS
  // =============================================
  async function testGemini() {
    if (IS_PRODUCTION) {
      // Test through proxy
      try {
        const res = await fetch('/api/gemini-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Responde solo "OK"' }] }],
            generationConfig: { maxOutputTokens: 5 },
          }),
        });
        if (res.ok) return { ok: true };
        const err = await res.json();
        return { ok: false, error: err.error || `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // Test via proxy — NUNCA directo a Gemini desde el browser
    try {
      const res = await fetch('/api/gemini-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Responde solo OK' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      });
      if (res.ok) return { ok: true };
      const err = await res.json();
      return { ok: false, error: err.error || `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function testSupabase() {
    const url = getSupabaseUrl();
    const key = getSupabaseKey();
    if (!url || !key) return { ok: false, error: 'Supabase not configured' };

    try {
      const res = await fetch(`${url}/rest/v1/`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      });
      if (res.ok || res.status === 200) return { ok: true };
      return { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function testWebhook() {
    const url = getWebhookUrl();
    if (!url) return { ok: false, error: 'Webhook URL not configured' };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, source: 'aliado_resico', timestamp: new Date().toISOString() }),
      });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // --- Clear local config (dev only) ---
  function clearAll() {
    localConfig = {};
    saveLocalConfig(localConfig);
    emit('config:changed', { service: 'all' });
  }

  // --- Boot log ---
  if (IS_PRODUCTION) {
    console.log(
      '%c🔒 PRODUCCIÓN: API keys se cargan desde variables de entorno del servidor.\n' +
      'Gemini se accede exclusivamente vía proxy serverless (/api/gemini-proxy).',
      'color:#10b981;font-size:11px'
    );
  } else {
    console.log(
      '%c⚠️ DESARROLLO LOCAL: Configuración manual habilitada.\n' +
      'Para producción, despliega en Vercel con variables de entorno.',
      'color:#f59e0b;font-size:11px'
    );
  }

  return {
    on,
    getGeminiKey, setGeminiKey, getGeminiEndpoint,
    getSupabaseUrl, getSupabaseKey, setSupabaseConfig,
    getWebhookUrl, setWebhookUrl,
    isGeminiConfigured, isSupabaseConfigured, isWebhookConfigured,
    getMode, getStatus,
    testGemini, testSupabase, testWebhook,
    clearAll, loadServerConfig,
    IS_PRODUCTION,
  };
})();

if (typeof window !== 'undefined') window.AppConfig = AppConfig;