/* ============================================
   ALIADO RESICO — Store v6.0
   Alineado a esquema productivo DOC05
   conversations.message_text
   fiscal_metrics.cumulative_income / annual_limit / risk_level
   ============================================ */

const Store = (() => {
  const KEY = 'aliado_resico_v6';
  const EVT = {};
  const DEFAULT_LIMIT = 3500000;

  let db = null;
  let usr = null;
  let rtChannel = null;

  const DEF = {
    conversations: [],
    metrics: {
      totalProcessed: 0,
      byCategory: {
        CONSULTA_FISCAL: 0,
        SOLICITUD_FACTURA: 0,
        REGISTRO_GASTO: 0,
        REPORTE_PAGO: 0,
        SALUD_FISCAL: 0,
        OTROS: 0,
      },
      avgConfidence: 0,
      autoResolutionRate: 0,
      avgResponseTime: 2.3,
    },
    incomeYTD: 0,
    fiscalMetrics: {
      annualLimit: DEFAULT_LIMIT,
      riskLevel: 'SEGURO',
    },
    settings: {
      autoReply: true,
      incomeAlert: true,
      sound: false,
    },
    documents: [],
    saludFiscal: {
      buzonTributarioActivo: null,
      eFirmaVigente: null,
      eFirmaExpiry: null,
      lastAuditDate: null,
      alertLevel: 'safe',
    },
    carpetaFiscal: {
      efirmaExpiry: null,
      constanciaStatus: null,
      opinionStatus: null,
      lastUpdated: null,
    },
  };

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function ensureAppState() {
    window.APP_STATE = window.APP_STATE || {};
    if (!('supabase' in window.APP_STATE)) window.APP_STATE.supabase = null;
    if (!('currentUser' in window.APP_STATE)) window.APP_STATE.currentUser = null;
    if (!('isDemo' in window.APP_STATE)) window.APP_STATE.isDemo = false;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEF);
      return { ...clone(DEF), ...JSON.parse(raw) };
    } catch {
      return clone(DEF);
    }
  }

  let state = load();

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  function emit(ev, data) {
    (EVT[ev] || []).forEach(fn => {
      try { fn(data); } catch (_) {}
    });
  }

  function on(ev, fn) {
    if (!EVT[ev]) EVT[ev] = [];
    EVT[ev].push(fn);
  }

  function calcRiskLevel(income, limit = DEFAULT_LIMIT) {
    const ratio = limit > 0 ? income / limit : 0;
    if (ratio >= 0.94) return 'EXPULSION';
    if (ratio >= 0.90) return 'RIESGO_ALTO';
    if (ratio >= 0.80) return 'PREVENTIVO';
    return 'SEGURO';
  }

  function recalc() {
    state.metrics.totalProcessed = state.conversations.length;
    Object.keys(state.metrics.byCategory).forEach(k => { state.metrics.byCategory[k] = 0; });

    let confidenceSum = 0;
    state.conversations.forEach(c => {
      const intent = c.intent || 'OTROS';
      if (intent in state.metrics.byCategory) state.metrics.byCategory[intent]++;
      confidenceSum += Number(c.confidence || 0);
    });

    state.metrics.avgConfidence = state.conversations.length
      ? Math.round((confidenceSum / state.conversations.length) * 100)
      : 0;

    state.fiscalMetrics.riskLevel = calcRiskLevel(
      Number(state.incomeYTD || 0),
      Number(state.fiscalMetrics.annualLimit || DEFAULT_LIMIT)
    );
  }

  function _mapConversation(row) {
    return {
      id: row.id,
      text: row.message_text || '',
      intent: row.intent || 'OTROS',
      confidence: Number(row.confidence || 0),
      is_fiscal_audit_completed: !!row.is_fiscal_audit_completed,
      timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      source: 'supabase',
    };
  }

  async function _syncUser() {
    if (!db?.auth?.getUser) return null;
    try {
      const { data } = await db.auth.getUser();
      usr = data?.user || null;
      window.APP_STATE.currentUser = usr;
      return usr;
    } catch (_) {
      usr = null;
      window.APP_STATE.currentUser = null;
      return null;
    }
  }

  async function _syncDown() {
    if (!db || !usr?.id) return;

    try {
      const [convRes, metricRes] = await Promise.all([
        db.from('conversations')
          .select('id,user_id,message_text,intent,confidence,is_fiscal_audit_completed,created_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(200),
        db.from('fiscal_metrics')
          .select('user_id,cumulative_income,annual_limit,risk_level')
          .eq('user_id', usr.id)
          .maybeSingle(),
      ]);

      if (!convRes.error && Array.isArray(convRes.data)) {
        state.conversations = convRes.data.map(_mapConversation);
      }

      if (!metricRes.error && metricRes.data) {
        state.incomeYTD = Number(metricRes.data.cumulative_income || 0);
        state.fiscalMetrics.annualLimit = Number(metricRes.data.annual_limit || DEFAULT_LIMIT);
        state.fiscalMetrics.riskLevel = metricRes.data.risk_level || calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit);
      }

      recalc();
      persist();
      emit('store:updated', state);
      emit('metrics:updated', state.metrics);
      emit('income:updated', state.incomeYTD);
    } catch (e) {
      console.warn('[Store] syncDown:', e.message);
    }
  }

  async function _upsertConversation(c) {
    if (!db || !usr?.id) return;

    const payload = {
      id: c.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
      user_id: usr.id,
      message_text: String(c.text || c.message_text || '').slice(0, 10000),
      intent: c.intent || 'OTROS',
      confidence: Number(c.confidence || 0),
      is_fiscal_audit_completed: !!c.is_fiscal_audit_completed,
    };

    try {
      await db.from('conversations').upsert(payload, { onConflict: 'id' });
    } catch (e) {
      console.warn('[Store] upsertConversation:', e.message);
    }
  }

  async function _upsertMetrics() {
    if (!db || !usr?.id) return;

    const payload = {
      user_id: usr.id,
      cumulative_income: Number(state.incomeYTD || 0),
      annual_limit: Number(state.fiscalMetrics.annualLimit || DEFAULT_LIMIT),
      risk_level: state.fiscalMetrics.riskLevel || calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit),
    };

    try {
      await db.from('fiscal_metrics').upsert(payload, { onConflict: 'user_id' });
    } catch (e) {
      console.warn('[Store] upsertMetrics:', e.message);
    }
  }

  function _subscribeRealtime() {
    if (!db || !usr?.id) return;

    try {
      if (rtChannel) db.removeChannel(rtChannel);
    } catch (_) {}

    rtChannel = db
      .channel(`conversations_rt_${usr.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `user_id=eq.${usr.id}`,
        },
        () => _syncDown()
      )
      .subscribe();
  }

  async function initSupabase() {
    ensureAppState();

    const url = window.SUPABASE_CONFIG?.url || window.AppConfig?.getSupabaseUrl?.() || '';
    const anonKey = window.SUPABASE_CONFIG?.anonKey || window.AppConfig?.getSupabaseKey?.() || '';

    if (!url || !anonKey) {
      window.APP_STATE.supabase = null;
      return null;
    }

    if (!window.supabase?.createClient) {
      window.APP_STATE.supabase = null;
      return null;
    }

    if (!db) {
      db = window.supabase.createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });

      window.APP_STATE.supabase = db;

      db.auth.onAuthStateChange(async (_event, session) => {
        usr = session?.user || null;
        window.APP_STATE.currentUser = usr;
        if (usr?.id) {
          await _syncDown();
          _subscribeRealtime();
        }
      });
    }

    try {
      const { data } = await db.auth.getSession();
      usr = data?.session?.user || null;
      window.APP_STATE.currentUser = usr;

      if (usr?.id) {
        await _syncDown();
        _subscribeRealtime();
      }

      return db;
    } catch (e) {
      console.warn('[Store] initSupabase:', e.message);
      window.APP_STATE.supabase = db;
      return db;
    }
  }

  function getState() { return state; }
  function getMetrics() { return state.metrics; }
  function getConversations() { return state.conversations; }
  function getSettings() { return state.settings; }
  function getDocuments() { return state.documents; }
  function getSaludFiscal() { return state.saludFiscal; }
  function getCarpetaFiscal() { return state.carpetaFiscal; }

  function setState(partial = {}) {
    state = {
      ...state,
      ...partial,
      metrics: { ...state.metrics, ...(partial.metrics || {}) },
      fiscalMetrics: { ...state.fiscalMetrics, ...(partial.fiscalMetrics || {}) },
      settings: { ...state.settings, ...(partial.settings || {}) },
      saludFiscal: { ...state.saludFiscal, ...(partial.saludFiscal || {}) },
      carpetaFiscal: { ...state.carpetaFiscal, ...(partial.carpetaFiscal || {}) },
    };
    recalc();
    persist();
    emit('store:updated', state);
    emit('metrics:updated', state.metrics);
    emit('income:updated', state.incomeYTD);
  }

  function addConversation(c) {
    const conv = {
      id: c.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
      text: c.text || '',
      intent: c.intent || 'OTROS',
      confidence: Number(c.confidence || 0),
      timestamp: c.timestamp || Date.now(),
      is_fiscal_audit_completed: !!c.is_fiscal_audit_completed,
      source: c.source || 'local',
    };

    state.conversations.unshift(conv);
    if (state.conversations.length > 200) state.conversations.pop();
    recalc();
    persist();
    emit('conversation:added', conv);
    emit('metrics:updated', state.metrics);
    _upsertConversation(conv);
    _upsertMetrics();
  }

  function updateSetting(key, val) {
    state.settings[key] = val;
    persist();
    emit('settings:updated', state.settings);
  }

  function updateIncome(amount) {
    state.incomeYTD = Number(amount || 0);
    recalc();
    persist();
    emit('income:updated', state.incomeYTD);
    emit('metrics:updated', state.metrics);
    _upsertMetrics();
  }

  function updateSaludFiscal(data) {
    state.saludFiscal = { ...state.saludFiscal, ...data };
    persist();
    emit('saludfiscal:updated', state.saludFiscal);
  }

  function saveDocument(doc) {
    state.documents.unshift(doc);
    persist();
    emit('document:added', doc);
  }

  function updateCarpetaFiscal(data) {
    state.carpetaFiscal = {
      ...state.carpetaFiscal,
      ...data,
      lastUpdated: new Date().toISOString(),
    };
    persist();
    emit('carpeta:updated', state.carpetaFiscal);
  }

  function setEfirmaExpiry(dateISO) { updateCarpetaFiscal({ efirmaExpiry: dateISO }); }
  function setConstanciaStatus(status) { updateCarpetaFiscal({ constanciaStatus: status }); }
  function setOpinionStatus(status) { updateCarpetaFiscal({ opinionStatus: status }); }

  function reset() {
    state = clone(DEF);
    persist();
    emit('store:reset', null);
  }

  return {
    on,
    initSupabase,
    getState,
    getMetrics,
    getConversations,
    getSettings,
    getDocuments,
    getSaludFiscal,
    getCarpetaFiscal,
    setState,
    addConversation,
    updateSetting,
    updateIncome,
    updateSaludFiscal,
    saveDocument,
    updateCarpetaFiscal,
    setEfirmaExpiry,
    setConstanciaStatus,
    setOpinionStatus,
    reset,
  };
})();

window.Store = Store;