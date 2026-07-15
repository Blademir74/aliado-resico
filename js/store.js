const Store = (() => {
  const KEY = 'aliado_resico_v8';
  const EVT = {};
  const DEFAULT_LIMIT = 3500000;
  const MAX_CONVERSATIONS = 200;
  const MAX_DOCUMENTS = 100;
  const YEAR = 2026;
  const MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  let db = null;
  let usr = null;
  let rtChannel = null;
  let authListenerBound = false;

  function buildMonthlyFolders(year = YEAR) {
    return MONTHS.map((monthName, idx) => ({
      year,
      monthNumber: idx + 1,
      monthKey: `${year}-${String(idx + 1).padStart(2, '0')}`,
      monthName,
      total: 0,
      categories: {
        ingresos: [],
        gastos_iva: [],
        efirma: [],
        constancia: [],
        opinion: []
      }
    }));
  }

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
    invoiceProfiles: [],
    saludFiscal: {
      buzonTributarioActivo: null,
      eFirmaVigente: null,
      eFirmaExpiry: null,
      lastAuditDate: null,
      alertLevel: 'safe'
    },
    carpetaFiscal: {
      year: YEAR,
      monthlyFolders: buildMonthlyFolders(YEAR),
      summary: {
        total: 0,
        ingresos: 0,
        gastos_iva: 0,
        efirma: 0,
        constancia: 0,
        opinion: 0
      },
      efirmaExpiry: null,
      constanciaStatus: 'pendiente',
      opinionStatus: 'pendiente',
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

  function normalizeMonthlyFolders(input) {
    const base = buildMonthlyFolders(YEAR);
    if (!Array.isArray(input) || !input.length) return base;

    return base.map(baseMonth => {
      const found = input.find(m => String(m.monthKey) === String(baseMonth.monthKey));
      if (!found) return baseMonth;
      return {
        ...baseMonth,
        ...found,
        categories: {
          ingresos: Array.isArray(found.categories?.ingresos) ? found.categories.ingresos : [],
          gastos_iva: Array.isArray(found.categories?.gastos_iva) ? found.categories.gastos_iva : [],
          efirma: Array.isArray(found.categories?.efirma) ? found.categories.efirma : [],
          constancia: Array.isArray(found.categories?.constancia) ? found.categories.constancia : [],
          opinion: Array.isArray(found.categories?.opinion) ? found.categories.opinion : []
        }
      };
    });
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
        carpetaFiscal: {
          ...clone(DEF).carpetaFiscal,
          ...(parsed.carpetaFiscal || {}),
          monthlyFolders: normalizeMonthlyFolders(parsed.carpetaFiscal?.monthlyFolders)
        },
        invoiceProfiles: Array.isArray(parsed.invoiceProfiles) ? parsed.invoiceProfiles : [],
        diagnostic: { ...clone(DEF).diagnostic, ...(parsed.diagnostic || {}) }
      };
    } catch {
      return clone(DEF);
    }
  }

  let state = load();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }

  function emit(ev, data) {
    (EVT[ev] || []).forEach(fn => {
      try { fn(data); } catch {}
    });
  }

  function emitAll() {
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
      if (intent in state.metrics.byCategory) state.metrics.byCategory[intent]++;
      else state.metrics.byCategory.OTROS++;
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

  function mapConversation(row) {
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

  function normalizeDocumentType(row) {
    return row.document_type || row.doc_type || 'OTRO';
  }

  function mapDocument(row) {
    return {
      id: row.id,
      file_name: row.file_name || 'archivo',
      doc_type: normalizeDocumentType(row),
      document_type: normalizeDocumentType(row),
      extracted_data: row.extracted_data || {},
      confidence: Number(row.confidence || 0),
      safety_flag: !!row.safety_flag,
      validation_status: row.validation_status || 'pendiente',
      needs_review: !!row.needs_review,
      source: row.source || 'unknown',
      file_url: row.file_url || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || row.created_at || new Date().toISOString()
    };
  }

  function deriveDocumentDate(doc) {
    const fiscalDate = doc?.extracted_data?.fecha || doc?.created_at || doc?.updated_at;
    const parsed = new Date(fiscalDate);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  function normalizeFolderCategory(value) {
    const v = String(value || '').trim().toLowerCase();
    if (['ingresos', 'gastos_iva', 'efirma', 'constancia', 'opinion'].includes(v)) return v;
    return 'gastos_iva';
  }

  function detectFolderCategory(doc) {
    const explicit = doc?.folder_category || doc?.extracted_data?.folder_category;
    if (explicit) return normalizeFolderCategory(explicit);

    const type = String(doc.document_type || doc.doc_type || '').toUpperCase();
    const source = String(doc.source || '').toLowerCase();
    const usefulness = String(doc.extracted_data?.tax_usefulness || '').toUpperCase();

    if (source.includes('alegra') || source.includes('invoice')) return 'ingresos';
    if (type === 'EFIRMA') return 'efirma';
    if (type === 'CONSTANCIA') return 'constancia';
    if (type === 'OPINION') return 'opinion';
    if (type === 'CFDI' && usefulness === 'ISR') return 'ingresos';
    if (type === 'CFDI' && (usefulness === 'IVA' || usefulness === 'AMBOS')) return 'gastos_iva';
    if (type === 'TICKET') return 'gastos_iva';
    return 'gastos_iva';
  }

  function slimFolderDoc(doc) {
    return {
      id: doc.id,
      file_name: doc.file_name || 'archivo',
      document_type: doc.document_type || doc.doc_type || 'OTRO',
      created_at: doc.created_at || new Date().toISOString(),
      fecha_fiscal: doc.extracted_data?.fecha || null,
      confidence: Number(doc.confidence || 0),
      needs_review: !!doc.needs_review || !!doc.safety_flag,
      validation_status: doc.validation_status || 'pendiente',
      source: doc.source || 'local'
    };
  }

  function rebuildCarpetaFiscal() {
    const folders = buildMonthlyFolders(YEAR);
    const summary = {
      total: 0,
      ingresos: 0,
      gastos_iva: 0,
      efirma: 0,
      constancia: 0,
      opinion: 0
    };

    let latestEFirma = null;
    let latestConstancia = null;
    let latestOpinion = null;

    (state.documents || []).forEach(doc => {
      const d = deriveDocumentDate(doc);
      if (d.getFullYear() !== YEAR) return;

      const monthIdx = d.getMonth();
      const category = detectFolderCategory(doc);
      const folder = folders[monthIdx];
      if (!folder || !folder.categories[category]) return;

      const slim = slimFolderDoc(doc);
      folder.categories[category].push(slim);
      folder.total += 1;
      summary.total += 1;
      summary[category] += 1;

      if (category === 'efirma') {
        if (!latestEFirma || new Date(doc.created_at) > new Date(latestEFirma.created_at)) latestEFirma = doc;
      }
      if (category === 'constancia') {
        if (!latestConstancia || new Date(doc.created_at) > new Date(latestConstancia.created_at)) latestConstancia = doc;
      }
      if (category === 'opinion') {
        if (!latestOpinion || new Date(doc.created_at) > new Date(latestOpinion.created_at)) latestOpinion = doc;
      }
    });

    state.carpetaFiscal = {
      ...state.carpetaFiscal,
      year: YEAR,
      monthlyFolders: folders,
      summary,
      efirmaExpiry: latestEFirma?.extracted_data?.fecha_vencimiento || latestEFirma?.extracted_data?.fecha || state.carpetaFiscal.efirmaExpiry || 'pendiente',
      constanciaStatus: latestConstancia ? 'actualizada' : 'pendiente',
      opinionStatus: latestOpinion ? 'cargada' : 'pendiente',
      lastUpdated: new Date().toISOString()
    };

    emit('carpetaUpdated', state.carpetaFiscal);
  }

  async function syncDown() {
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
          .select('id,user_id,file_name,doc_type,document_type,file_url,extracted_data,confidence,safety_flag,validation_status,needs_review,source,created_at,updated_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(MAX_DOCUMENTS)
      ]);

      if (!convRes.error && Array.isArray(convRes.data)) {
        state.conversations = convRes.data.map(mapConversation);
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
        state.documents = docRes.data.map(mapDocument);
      } else if (docRes.error) {
        console.warn('[Store] documents sync error:', docRes.error.message);
      }

      recalc();
      rebuildCarpetaFiscal();
      persist();
      emitAll();
    } catch (e) {
      console.warn('[Store] syncDown:', e.message);
    }
  }

  async function upsertConversation(c) {
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
      if (error) console.warn('[Store] upsertConversation:', error.message);
    } catch (e) {
      console.warn('[Store] upsertConversation:', e.message);
    }
  }

  async function upsertMetrics() {
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
      if (error) console.warn('[Store] upsertMetrics:', error.message);
    } catch (e) {
      console.warn('[Store] upsertMetrics:', e.message);
    }
  }

  async function saveDocumentRemote(doc) {
    if (!db || !usr?.id) return;

    const normalizedType = doc.document_type || doc.doc_type || 'OTRO';

    const payload = {
      id: doc.id || safeUUID(),
      user_id: usr.id,
      file_name: doc.file_name || 'unnamed_file',
      doc_type: normalizedType,
      document_type: normalizedType,
      extracted_data: doc.extracted_data || {},
      confidence: Number(doc.confidence || 0),
      safety_flag: !!doc.safety_flag,
      validation_status: doc.validation_status || 'pendiente',
      needs_review: !!doc.needs_review || !!doc.safety_flag,
      source: doc.source || 'web_upload',
      file_url: doc.file_url || null,
      updated_at: new Date().toISOString()
    };

    try {
      const { error } = await db.from('documents').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('[Store] saveDocumentRemote:', error.message);
    } catch (e) {
      console.warn('[Store] saveDocumentRemote:', e.message);
    }
  }

  function subscribeRealtime() {
    if (!db || !usr?.id) return;

    try {
      if (rtChannel) db.removeChannel(rtChannel);
    } catch {}

    rtChannel = db
      .channel(`aliado_rt_${usr.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${usr.id}` },
        () => syncDown()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fiscal_metrics', filter: `user_id=eq.${usr.id}` },
        () => syncDown()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documents', filter: `user_id=eq.${usr.id}` },
        () => syncDown()
      )
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setTimeout(() => subscribeRealtime(), 5000);
        }
      });
  }

  function bindAuthListenerOnce() {
    if (!db || authListenerBound) return;

    db.auth.onAuthStateChange(async (_event, session) => {
      usr = session?.user || null;
      window.APP_STATE.currentUser = usr;

      if (usr?.id) {
        await syncDown();
        subscribeRealtime();
      } else {
        try {
          if (rtChannel) db.removeChannel(rtChannel);
        } catch {}
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
      bindAuthListenerOnce();
    }

    try {
      const { data, error } = await db.auth.getSession();
      if (error) console.warn('[Store] getSession:', error.message);

      usr = data?.session?.user || null;
      window.APP_STATE.currentUser = usr;

      if (usr?.id) {
        await syncDown();
        subscribeRealtime();
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
  function getInvoiceProfiles() { return state.invoiceProfiles || []; }

  function setState(partial = {}) {
    state = {
      ...state,
      ...partial,
      metrics: { ...state.metrics, ...(partial.metrics || {}) },
      fiscalMetrics: { ...state.fiscalMetrics, ...(partial.fiscalMetrics || {}) },
      settings: { ...state.settings, ...(partial.settings || {}) },
      saludFiscal: { ...state.saludFiscal, ...(partial.saludFiscal || {}) },
      carpetaFiscal: {
        ...state.carpetaFiscal,
        ...(partial.carpetaFiscal || {}),
        monthlyFolders: normalizeMonthlyFolders(partial.carpetaFiscal?.monthlyFolders || state.carpetaFiscal.monthlyFolders)
      },
      invoiceProfiles: Array.isArray(partial.invoiceProfiles) ? partial.invoiceProfiles : state.invoiceProfiles,
      diagnostic: { ...state.diagnostic, ...(partial.diagnostic || {}) }
    };

    recalc();
    rebuildCarpetaFiscal();
    persist();
    emitAll();
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
    emitAll();

    upsertConversation(conv);
    upsertMetrics();
  }

  function updateIncome(amount) {
    state.incomeYTD = Number(amount || 0);
    state.fiscalMetrics.riskLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit);
    persist();
    emitAll();
    upsertMetrics();
  }

  function updateAnnualLimit(amount) {
    const nextLimit = Number(amount || DEFAULT_LIMIT);
    state.fiscalMetrics.annualLimit = nextLimit > 0 ? nextLimit : DEFAULT_LIMIT;
    state.fiscalMetrics.riskLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit);
    persist();
    emitAll();
    upsertMetrics();
  }

  function updateSaludFiscal(data) {
    state.saludFiscal = { ...state.saludFiscal, ...data };
    persist();
    emit('saludFiscalUpdated', state.saludFiscal);
    emitAll();
  }

  async function saveDocument(doc) {
    const normalizedType = doc.document_type || doc.doc_type || 'OTRO';

    const localDoc = {
      id: doc.id || safeUUID(),
      file_name: doc.file_name || 'unnamed_file',
      doc_type: normalizedType,
      document_type: normalizedType,
      extracted_data: doc.extracted_data || {},
      confidence: Number(doc.confidence || 0),
      safety_flag: !!doc.safety_flag,
      validation_status: doc.validation_status || 'pendiente',
      needs_review: !!doc.needs_review || !!doc.safety_flag,
      source: doc.source || 'local',
      file_url: doc.file_url || null,
      created_at: doc.created_at || new Date().toISOString(),
      updated_at: doc.updated_at || new Date().toISOString(),
      folder_category: doc.folder_category || doc.extracted_data?.folder_category || null
    };

    state.documents.unshift(localDoc);
    if (state.documents.length > MAX_DOCUMENTS) {
      state.documents = state.documents.slice(0, MAX_DOCUMENTS);
    }

    rebuildCarpetaFiscal();
    persist();
    emit('document:added', localDoc);
    emit('documentAdded', localDoc);
    emitAll();

    await saveDocumentRemote(localDoc);
    return localDoc;
  }

  function updateCarpetaFiscal(data) {
    state.carpetaFiscal = {
      ...state.carpetaFiscal,
      ...data,
      monthlyFolders: normalizeMonthlyFolders(data?.monthlyFolders || state.carpetaFiscal.monthlyFolders),
      lastUpdated: new Date().toISOString()
    };
    persist();
    emit('carpetaUpdated', state.carpetaFiscal);
    emitAll();
  }

  function setInvoiceProfiles(list = []) {
    state.invoiceProfiles = Array.isArray(list) ? list.slice(0, 50) : [];
    persist();
    emitAll();
  }

  function updateDiagnostic(data) {
    state.diagnostic = {
      ...state.diagnostic,
      ...data,
      completedAt: data?.completedAt || state.diagnostic.completedAt || new Date().toISOString()
    };
    persist();
    emit('diagnosticUpdated', state.diagnostic);
    emitAll();
  }

  function reset() {
    state = clone(DEF);
    persist();

    try {
      if (rtChannel && db) db.removeChannel(rtChannel);
    } catch {}
    rtChannel = null;

    emit('storeReset', null);
    emitAll();
  }

  rebuildCarpetaFiscal();

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
    getInvoiceProfiles,
    setInvoiceProfiles,
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