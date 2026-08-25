const AppConfig = (() => {
  const STORAGE_KEY = 'aliado_resico_config_v1';
  const listeners = {};
  const host = window.location.hostname || '';
  const IS_PRODUCTION =
    host !== 'localhost' &&
    host !== '127.0.0.1' &&
    !host.startsWith('192.168.') &&
    !host.endsWith('.local');

  let serverConfig = null;
  let localConfig = loadLocalConfig();

  function emit(event, data) {
    (listeners[event] || []).forEach(fn => {
      try { fn(data); } catch (_) {}
    });
  }
  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }
  function loadLocalConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  function saveLocalConfig() {
    if (IS_PRODUCTION) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(localConfig));
    } catch (_) {}
  }

  async function loadServerConfig() {
    if (!IS_PRODUCTION) return false;
    let controller = null;
    let timeoutId = null;
    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timeoutId = window.setTimeout(() => controller.abort(), 5000);
      }
      const res = await fetch('/api/config', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller?.signal
      });
      if (!res.ok) {
        console.warn('[Config] /api/config respondió con', res.status);
        return false;
      }
      const data = await res.json();
      if (!data?.ok || !data?.config) {
        console.warn('[Config] Respuesta inesperada de /api/config');
        return false;
      }
      serverConfig = data.config;
      window.SUPABASE_CONFIG = {
        url: serverConfig.supabaseUrl || '',
        anonKey: serverConfig.supabaseAnonKey || ''
      };
      console.log(
        '%c🔒 PRODUCCIÓN: Config cargada desde servidor. Gemini solo vía /api/gemini-proxy.',
        'color:#10b981;font-weight:700'
      );
      emit('config:changed', getStatus());
      return true;
    } catch (e) {
      if (e?.name === 'AbortError') {
        console.warn('[Config] /api/config tardó más de 5s; continuando en modo degradado');
      } else {
        console.warn('[Config] No se pudo cargar /api/config:', e?.message || e);
      }
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function getSupabaseUrl() {
    if (window.ENV?.SUPABASE_URL) return window.ENV.SUPABASE_URL;
    if (serverConfig?.supabaseUrl) return serverConfig.supabaseUrl;
    return localConfig.supabaseUrl || '';
  }
  function getSupabaseKey() {
    if (window.ENV?.SUPABASE_ANON_KEY) return window.ENV.SUPABASE_ANON_KEY;
    if (serverConfig?.supabaseAnonKey) return serverConfig.supabaseAnonKey;
    return localConfig.supabaseKey || '';
  }
  function setSupabaseConfig(url, key) {
    if (IS_PRODUCTION) {
      console.warn('[Config] Supabase no se configura desde frontend en producción');
      return;
    }
    localConfig.supabaseUrl = String(url || '').trim();
    localConfig.supabaseKey = String(key || '').trim();
    saveLocalConfig();
    emit('config:changed', getStatus());
  }
  function getWebhookUrl() {
    if (serverConfig?.webhookUrl) return serverConfig.webhookUrl;
    return localConfig.webhookUrl || '';
  }
  function setWebhookUrl(url) {
    if (IS_PRODUCTION) {
      console.warn('[Config] Webhook no se configura desde frontend en producción');
      return;
    }
    localConfig.webhookUrl = String(url || '').trim();
    saveLocalConfig();
    emit('config:changed', getStatus());
  }
  function getGeminiEndpoint() {
    return '/api/gemini-proxy';
  }
  function isSupabaseConfigured() {
    return !!getSupabaseUrl() && !!getSupabaseKey();
  }
  function isGeminiConfigured() {
    if (IS_PRODUCTION) return !!serverConfig?.geminiConfigured;
    return true;
  }
  function getMode() {
    if (window.APP_STATE?.isDemo) return 'demo';
    if (isSupabaseConfigured()) return 'production';
    return 'degraded';
  }
  function getStatus() {
    return {
      environment: IS_PRODUCTION ? 'production' : 'local',
      mode: getMode(),
      supabase: isSupabaseConfigured(),
      gemini: isGeminiConfigured(),
      webhook: !!getWebhookUrl()
    };
  }
  async function testSupabase() {
    const url = getSupabaseUrl();
    const key = getSupabaseKey();
    if (!url || !key) return { ok: false, error: 'Supabase no configurado' };
    try {
      const res = await fetch(`${url}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` }
      });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: e?.message || 'Error desconocido' };
    }
  }
  function clearLocalConfig() {
    if (IS_PRODUCTION) return;
    localConfig = {};
    saveLocalConfig();
    emit('config:changed', getStatus());
  }

  return {
    IS_PRODUCTION,
    on,
    loadServerConfig,
    getSupabaseUrl,
    getSupabaseKey,
    setSupabaseConfig,
    getWebhookUrl,
    setWebhookUrl,
    getGeminiEndpoint,
    isSupabaseConfigured,
    isGeminiConfigured,
    getMode,
    getStatus,
    testSupabase,
    clearLocalConfig
  };
})();
window.AppConfig = AppConfig;