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
      autoResolutionRate: 92,
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
    diagnostic: {
      income: 0,
      mixtos: false,
      socioPM: false,
      cfdiGlobal: false,
      anualObligatoria: false,
      riesgoMulta: false,
      recomendacion: '',
      completedAt: null
    }
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

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

  // Mapeo de fila de conversación a objeto local (usa message_text)
  function _mapConversation(row) {
    return {
      id: row.id,
      text: row.message_text || '',          // <-- se mapea message_text a text para el frontend
      intent: row.intent || 'OTROS',
      confidence: Number(row.confidence || 0),
      is_fiscal_audit_completed: !!row.is_fiscal_audit_completed,
      timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      source: 'supabase',
    };
  }

  async function _syncDown() {
    if (!db || !usr?.id) return;

    try {
      const [convRes, metricRes, docRes] = await Promise.all([
        db.from('conversations')
          .select('id,user_id,message_text,intent,confidence,is_fiscal_audit_completed,created_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(200),
        db.from('fiscal_metrics')
          .select('user_id,income_ytd,total_processed,avg_confidence')
          .eq('user_id', usr.id)
          .maybeSingle(),
        db.from('documents')
          .select('id,user_id,file_name,doc_type,extracted_data,confidence,safety_flag,validation_status,needs_review,source,created_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(100)
      ]);

      if (!convRes.error && Array.isArray(convRes.data)) {
        state.conversations = convRes.data.map(_mapConversation);
      }

      if (!metricRes.error && metricRes.data) {
        state.incomeYTD = Number(metricRes.data.income_ytd || 0);
        state.metrics.totalProcessed = Number(metricRes.data.total_processed || 0);
        state.metrics.avgConfidence = Number(metricRes.data.avg_confidence || 0);
        state.fiscalMetrics.riskLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit);
      }

      if (!docRes.error && Array.isArray(docRes.data)) {
        state.documents = docRes.data.map(d => ({
          id: d.id,
          file_name: d.file_name,
          confidence: Number(d.confidence || 0),
          document_type: d.doc_type || 'OTRO',
          extracted_data: d.extracted_data || {},
          safety_flag: !!d.safety_flag,
          validation_status: d.validation_status || 'pendiente',
          needs_review: !!d.needs_review,
          source: d.source || 'unknown',
          created_at: d.created_at
        }));
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
      message_text: String(c.text || c.message_text || '').slice(0, 10000), // <-- usa message_text
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
      income_ytd: Number(state.incomeYTD || 0),        // <-- coincide con la BD
      total_processed: Number(state.metrics?.totalProcessed || 0),
      avg_confidence: Number(state.metrics?.avgConfidence || 0),
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
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          // Reintentar la suscripción después de un breve retraso
          setTimeout(() => _subscribeRealtime(), 5000);
        }
      });
  }

  async function initSupabase() {
    ensureAppState();

    const url = window.SUPABASE_CONFIG?.url || window.AppConfig?.getSupabaseUrl?.() || '';
    const anonKey = window.SUPABASE_CONFIG?.anonKey || window.AppConfig?.getSupabaseKey?.() || '';

    if (!url || !anonKey || !window.supabase?.createClient) {
      window.APP_STATE.supabase = null;
      return null;
    }

    if (!db) {
      db = window.supabase.createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
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
      diagnostic: { ...state.diagnostic, ...(partial.diagnostic || {}) }
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
    emit('store:updated', state);
    _upsertConversation(conv);
    _upsertMetrics();
  }

  function updateIncome(amount) {
    state.incomeYTD = Number(amount || 0);
    recalc();
    persist();
    emit('income:updated', state.incomeYTD);
    emit('metrics:updated', state.metrics);
    emit('store:updated', state);
    _upsertMetrics();
  }

  function updateSaludFiscal(data) {
    state.saludFiscal = { ...state.saludFiscal, ...data };
    persist();
    emit('saludfiscal:updated', state.saludFiscal);
    emit('store:updated', state);
  }

  async function saveDocument(doc) {
    state.documents.unshift(doc);
    persist();
    emit('document:added', doc);
    emit('store:updated', state);

    if (db && usr?.id) {
      const payload = {
        id: doc.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
        user_id: usr.id,
        file_name: doc.file_name || 'unnamed_file',
        doc_type: doc.document_type || 'OTRO',
        extracted_data: doc.extracted_data || {},
        confidence: Number(doc.confidence || 0),
        safety_flag: !!doc.safety_flag,
        validation_status: doc.validation_status || 'pendiente',
        needs_review: !!doc.safety_flag,
        source: doc.source || 'web_upload'
      };
      try {
        await db.from('documents').upsert(payload, { onConflict: 'id' });
      } catch (e) {
        console.warn('[Store] saveDocument error:', e.message);
      }
    }
  }

  function updateCarpetaFiscal(data) {
    state.carpetaFiscal = {
      ...state.carpetaFiscal,
      ...data,
      lastUpdated: new Date().toISOString(),
    };
    persist();
    emit('carpeta:updated', state.carpetaFiscal);
    emit('store:updated', state);
  }

  function reset() {
    state = clone(DEF);
    persist();
    emit('store:reset', null);
    emit('store:updated', state);
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
    updateIncome,
    updateSaludFiscal,
    saveDocument,
    updateCarpetaFiscal,
    reset,
  };
})();

window.Store = Store;