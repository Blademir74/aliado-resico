const Store = (() => {
  const KEY = 'aliado_resico_v7';
  const EVT = {};
  const DEFAULT_LIMIT = 3500000;
  const MAX_CONVERSATIONS = 200;
  const MAX_DOCUMENTS = 100;

  let db = null;
  let usr = null;
  let rtChannel = null;
  let authListenerBound = false;

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
        OTROS: 0
      },
      avgConfidence: 0,
      autoResolutionRate: 92,
      avgResponseTime: 2.3
    },
    incomeYTD: 0,
    fiscalMetrics: {
      annualLimit: DEFAULT_LIMIT,
      riskLevel: 'SEGURO'
    },
    settings: {
      autoReply: true,
      incomeAlert: true,
      sound: false
    },
    documents: [],
    saludFiscal: {
      buzonTributarioActivo: null,
      eFirmaVigente: null,
      eFirmaExpiry: null,
      lastAuditDate: null,
      alertLevel: 'safe'
    },
    carpetaFiscal: {
      efirmaExpiry: null,
      constanciaStatus: null,
      opinionStatus: null,
      lastUpdated: null
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

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function ensureAppState() {
    window.APP_STATE = window.APP_STATE || {};
    if (!('supabase' in window.APP_STATE)) window.APP_STATE.supabase = null;
    if (!('currentUser' in window.APP_STATE)) window.APP_STATE.currentUser = null;
    if (!('isDemo' in window.APP_STATE)) window.APP_STATE.isDemo = false;
  }

  function safeUUID() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEF);
      const parsed = JSON.parse(raw);
      return {
        ...clone(DEF),
        ...parsed,
        metrics: { ...clone(DEF).metrics, ...(parsed.metrics || {}) },
        fiscalMetrics: { ...clone(DEF).fiscalMetrics, ...(parsed.fiscalMetrics || {}) },
        settings: { ...clone(DEF).settings, ...(parsed.settings || {}) },
        saludFiscal: { ...clone(DEF).saludFiscal, ...(parsed.saludFiscal || {}) },
        carpetaFiscal: { ...clone(DEF).carpetaFiscal, ...(parsed.carpetaFiscal || {}) },
        diagnostic: { ...clone(DEF).diagnostic, ...(parsed.diagnostic || {}) }
      };
    } catch (_) {
      return clone(DEF);
    }
  }

  let state = load();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function emit(ev, data) {
    (EVT[ev] || []).forEach(fn => {
      try { fn(data); } catch (_) {}
    });
  }

  function emitAll(data) {
    emit('store:updated', state);
    emit('storeUpdated', state);
    emit('metrics:updated', state.metrics);
    emit('metricsUpdated', state.metrics);
    emit('income:updated', state.incomeYTD);
    emit('incomeUpdated', state.incomeYTD);
  }

  function on(ev, fn) {
    if (!EVT[ev]) EVT[ev] = [];
    EVT[ev].push(fn);
  }

  function calcRiskLevel(income, limit = DEFAULT_LIMIT) {
    const ratio = limit > 0 ? Number(income || 0) / Number(limit || DEFAULT_LIMIT) : 0;
    if (ratio >= 0.94) return 'EXPULSION';
    if (ratio >= 0.90) return 'RIESGO_ALTO';
    if (ratio >= 0.80) return 'PREVENTIVO';
    return 'SEGURO';
  }

  function recalc() {
    state.metrics.totalProcessed = state.conversations.length;

    Object.keys(state.metrics.byCategory).forEach(k => {
      state.metrics.byCategory[k] = 0;
    });

    let confidenceSum = 0;

    state.conversations.forEach(c => {
      const intent = c.intent || 'OTROS';
      if (intent in state.metrics.byCategory) {
        state.metrics.byCategory[intent]++;
      } else {
        state.metrics.byCategory.OTROS++;
      }
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
      message_text: row.message_text || '',
      intent: row.intent || 'OTROS',
      confidence: Number(row.confidence || 0),
      is_fiscal_audit_completed: !!row.is_fiscal_audit_completed,
      timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      source: 'supabase'
    };
  }

  function _mapDocument(row) {
    return {
      id: row.id,
      file_name: row.file_name || 'archivo',
      confidence: Number(row.confidence || 0),
      document_type: row.doc_type || 'OTRO',
      extracted_data: row.extracted_data || {},
      safety_flag: !!row.safety_flag,
      validation_status: row.validation_status || 'pendiente',
      needs_review: !!row.needs_review,
      source: row.source || 'unknown',
      created_at: row.created_at || new Date().toISOString()
    };
  }

  async function _syncDown() {
    if (!db || !usr?.id) return;

    try {
      const [convRes, metricRes, docRes] = await Promise.all([
        db
          .from('conversations')
          .select('id,user_id,message_text,intent,confidence,is_fiscal_audit_completed,created_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(MAX_CONVERSATIONS),

        db
          .from('fiscal_metrics')
          .select('user_id,cumulative_income,annual_limit,risk_level')
          .eq('user_id', usr.id)
          .maybeSingle(),

        db
          .from('documents')
          .select('id,user_id,file_name,doc_type,extracted_data,confidence,safety_flag,validation_status,needs_review,source,created_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(MAX_DOCUMENTS)
      ]);

      if (!convRes.error && Array.isArray(convRes.data)) {
        state.conversations = convRes.data.map(_mapConversation);
      } else if (convRes.error) {
        console.warn('[Store] conversations sync error:', convRes.error.message);
      }

      if (!metricRes.error && metricRes.data) {
        state.incomeYTD = Number(metricRes.data.cumulative_income || 0);
        state.fiscalMetrics.annualLimit = Number(metricRes.data.annual_limit || DEFAULT_LIMIT);
        state.fiscalMetrics.riskLevel = metricRes.data.risk_level || calcRiskLevel(
          Number(metricRes.data.cumulative_income || 0),
          Number(metricRes.data.annual_limit || DEFAULT_LIMIT)
        );
      } else if (metricRes.error) {
        console.warn('[Store] fiscal_metrics sync error:', metricRes.error.message);
      }

      if (!docRes.error && Array.isArray(docRes.data)) {
        state.documents = docRes.data.map(_mapDocument);
      } else if (docRes.error) {
        console.warn('[Store] documents sync error:', docRes.error.message);
      }

      recalc();
      persist();
      emitAll(state);
    } catch (e) {
      console.warn('[Store] syncDown:', e.message);
    }
  }

  async function _upsertConversation(c) {
    if (!db || !usr?.id) return;

    const payload = {
      id: c.id || safeUUID(),
      user_id: usr.id,
      message_text: String(c.message_text || c.text || '').slice(0, 10000),
      intent: c.intent || 'OTROS',
      confidence: Number(c.confidence || 0),
      is_fiscal_audit_completed: !!c.is_fiscal_audit_completed
    };

    try {
      const { error } = await db.from('conversations').upsert(payload, { onConflict: 'id' });
      if (error) {
        console.warn('[Store] upsertConversation:', error.message);
      }
    } catch (e) {
      console.warn('[Store] upsertConversation:', e.message);
    }
  }

  async function _upsertMetrics() {
    if (!db || !usr?.id) return;

    const payload = {
      user_id: usr.id,
      cumulative_income: Number(state.incomeYTD || 0),
      annual_limit: Number(state.fiscalMetrics?.annualLimit || DEFAULT_LIMIT),
      risk_level: calcRiskLevel(
        Number(state.incomeYTD || 0),
        Number(state.fiscalMetrics?.annualLimit || DEFAULT_LIMIT)
      )
    };

    try {
      const { error } = await db.from('fiscal_metrics').upsert(payload, { onConflict: 'user_id' });
      if (error) {
        console.warn('[Store] upsertMetrics:', error.message, error);
      }
    } catch (e) {
      console.warn('[Store] upsertMetrics:', e.message);
    }
  }

  async function _saveDocumentRemote(doc) {
    if (!db || !usr?.id) return;

    const payload = {
      id: doc.id || safeUUID(),
      user_id: usr.id,
      file_name: doc.file_name || 'unnamed_file',
      doc_type: doc.document_type || 'OTRO',
      extracted_data: doc.extracted_data || {},
      confidence: Number(doc.confidence || 0),
      safety_flag: !!doc.safety_flag,
      validation_status: doc.validation_status || 'pendiente',
      needs_review: !!doc.needs_review || !!doc.safety_flag,
      source: doc.source || 'web_upload'
    };

    try {
      const { error } = await db.from('documents').upsert(payload, { onConflict: 'id' });
      if (error) {
        console.warn('[Store] saveDocument error:', error.message, error);
      }
    } catch (e) {
      console.warn('[Store] saveDocument error:', e.message);
    }
  }

  function _subscribeRealtime() {
    if (!db || !usr?.id) return;

    try {
      if (rtChannel) {
        db.removeChannel(rtChannel);
      }
    } catch (_) {}

    rtChannel = db
      .channel(`aliado_rt_${usr.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversations',
          filter: `user_id=eq.${usr.id}`
        },
        () => _syncDown()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'fiscal_metrics',
          filter: `user_id=eq.${usr.id}`
        },
        () => _syncDown()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'documents',
          filter: `user_id=eq.${usr.id}`
        },
        () => _syncDown()
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setTimeout(() => _subscribeRealtime(), 5000);
        }
      });
  }

  function _bindAuthListenerOnce() {
    if (!db || authListenerBound) return;

    db.auth.onAuthStateChange(async (_event, session) => {
      usr = session?.user || null;
      window.APP_STATE.currentUser = usr;

      if (usr?.id) {
        await _syncDown();
        _subscribeRealtime();
      } else {
        try {
          if (rtChannel) db.removeChannel(rtChannel);
        } catch (_) {}
        rtChannel = null;
      }
    });

    authListenerBound = true;
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
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      window.APP_STATE.supabase = db;
      _bindAuthListenerOnce();
    }

    try {
      const { data, error } = await db.auth.getSession();
      if (error) {
        console.warn('[Store] getSession:', error.message);
      }

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
  function getDiagnostic() { return state.diagnostic; }

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
    emitAll(state);
  }

  function addConversation(c) {
    const conv = {
      id: c.id || safeUUID(),
      text: c.text || c.message_text || '',
      message_text: c.message_text || c.text || '',
      intent: c.intent || 'OTROS',
      confidence: Number(c.confidence || 0),
      timestamp: c.timestamp || Date.now(),
      is_fiscal_audit_completed: !!c.is_fiscal_audit_completed,
      source: c.source || 'local'
    };

    state.conversations.unshift(conv);
    if (state.conversations.length > MAX_CONVERSATIONS) {
      state.conversations = state.conversations.slice(0, MAX_CONVERSATIONS);
    }

    recalc();
    persist();
    emit('conversation:added', conv);
    emit('conversationAdded', conv);
    emitAll(state);

    _upsertConversation(conv);
    _upsertMetrics();
  }

  function updateIncome(amount) {
    state.incomeYTD = Number(amount || 0);
    state.fiscalMetrics.riskLevel = calcRiskLevel(
      state.incomeYTD,
      state.fiscalMetrics.annualLimit
    );

    persist();
    emitAll(state);
    _upsertMetrics();
  }

  function updateAnnualLimit(amount) {
    const nextLimit = Number(amount || DEFAULT_LIMIT);
    state.fiscalMetrics.annualLimit = nextLimit > 0 ? nextLimit : DEFAULT_LIMIT;
    state.fiscalMetrics.riskLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit);

    persist();
    emitAll(state);
    _upsertMetrics();
  }

  function updateSaludFiscal(data) {
    state.saludFiscal = { ...state.saludFiscal, ...data };
    persist();
    emit('saludfiscal:updated', state.saludFiscal);
    emit('saludFiscalUpdated', state.saludFiscal);
    emitAll(state);
  }

  async function saveDocument(doc) {
    const localDoc = {
      id: doc.id || safeUUID(),
      file_name: doc.file_name || 'unnamed_file',
      confidence: Number(doc.confidence || 0),
      document_type: doc.document_type || 'OTRO',
      extracted_data: doc.extracted_data || {},
      safety_flag: !!doc.safety_flag,
      validation_status: doc.validation_status || 'pendiente',
      needs_review: !!doc.needs_review || !!doc.safety_flag,
      source: doc.source || 'local',
      created_at: doc.created_at || new Date().toISOString()
    };

    state.documents.unshift(localDoc);
    if (state.documents.length > MAX_DOCUMENTS) {
      state.documents = state.documents.slice(0, MAX_DOCUMENTS);
    }

    persist();
    emit('document:added', localDoc);
    emit('documentAdded', localDoc);
    emitAll(state);

    await _saveDocumentRemote(localDoc);
  }

  function updateCarpetaFiscal(data) {
    state.carpetaFiscal = {
      ...state.carpetaFiscal,
      ...data,
      lastUpdated: new Date().toISOString()
    };
    persist();
    emit('carpeta:updated', state.carpetaFiscal);
    emit('carpetaUpdated', state.carpetaFiscal);
    emitAll(state);
  }

  function updateDiagnostic(data) {
    state.diagnostic = {
      ...state.diagnostic,
      ...data,
      completedAt: data?.completedAt || state.diagnostic.completedAt || new Date().toISOString()
    };
    persist();
    emit('diagnostic:updated', state.diagnostic);
    emit('diagnosticUpdated', state.diagnostic);
    emitAll(state);
  }

  function reset() {
    state = clone(DEF);
    persist();

    try {
      if (rtChannel && db) db.removeChannel(rtChannel);
    } catch (_) {}
    rtChannel = null;

    emit('store:reset', null);
    emit('storeReset', null);
    emitAll(state);
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
    getDiagnostic,
    setState,
    addConversation,
    updateIncome,
    updateAnnualLimit,
    updateSaludFiscal,
    saveDocument,
    updateCarpetaFiscal,
    updateDiagnostic,
    reset
  };
})();

window.Store = Store;