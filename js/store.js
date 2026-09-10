const Store = (() => {
  const KEY = 'aliado_resico_v10';
  const EVT = {};
  const DEFAULT_LIMIT = 3500000;
  const ALERT_80 = 2800000;
  const ALERT_90 = 3150000;
  const ALERT_94 = 3290000;
  const MAX_CONVERSATIONS = 200;
  const MAX_DOCUMENTS = 100;
  const YEAR = 2026;
  const RISK_THRESHOLDS = [
    { level: 'EXPULSION', min: ALERT_94, ratio: 0.94 },
    { level: 'RIESGO_ALTO', min: ALERT_90, ratio: 0.90 },
    { level: 'PREVENTIVO', min: ALERT_80, ratio: 0.80 },
    { level: 'SEGURO', min: 0, ratio: 0 }
  ];
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  let db = null, usr = null, rtChannel = null, authListenerBound = false;

  function buildMonthlyFolders(year = YEAR) {
    return MONTHS.map((monthName, idx) => ({
      year, monthNumber: idx + 1, monthKey: `${year}-${String(idx + 1).padStart(2, '0')}`, monthName,
      total: 0, categories: { ingresos: [], gastos_iva: [], efirma: [], constancia: [], opinion: [] }
    }));
  }
  const DEF = {
    conversations: [],
    metrics: { totalProcessed: 0, byCategory: { CONSULTA_FISCAL: 0, SOLICITUD_FACTURA: 0, REGISTRO_GASTO: 0, REPORTE_PAGO: 0, SALUD_FISCAL: 0, OTROS: 0 }, avgConfidence: 0, autoResolutionRate: 92, avgResponseTime: 2.3 },
    incomeYTD: 0,
    fiscalMetrics: { annualLimit: DEFAULT_LIMIT, riskLevel: 'SEGURO' },
    settings: { autoReply: true, incomeAlert: true, sound: false },
    documents: [],
    invoiceProfiles: [],
    saludFiscal: { buzonTributarioActivo: null, eFirmaVigente: null, eFirmaExpiry: null, lastAuditDate: null, alertLevel: 'safe' },
    carpetaFiscal: { year: YEAR, monthlyFolders: buildMonthlyFolders(YEAR), summary: { total: 0, ingresos: 0, gastos_iva: 0, efirma: 0, constancia: 0, opinion: 0 }, efirmaExpiry: null, constanciaStatus: 'pendiente', opinionStatus: 'pendiente', lastUpdated: null },
    polizas: [],
    diagnostic: { income: 0, mixtos: false, socioPM: false, salarios: 0, intereses: 0, cfdiGlobal: false, buzonActivo: true, anualObligatoria: false, riesgoMulta: false, riesgoBuzon: false, riskLevel: 'SEGURO', recomendacion: '', completedAt: null }
  };
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
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
      return { ...baseMonth, ...found, categories: {
        ingresos: Array.isArray(found.categories?.ingresos) ? found.categories.ingresos : [],
        gastos_iva: Array.isArray(found.categories?.gastos_iva) ? found.categories.gastos_iva : [],
        efirma: Array.isArray(found.categories?.efirma) ? found.categories.efirma : [],
        constancia: Array.isArray(found.categories?.constancia) ? found.categories.constancia : [],
        opinion: Array.isArray(found.categories?.opinion) ? found.categories.opinion : []
      }};
    });
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEF);
      const parsed = JSON.parse(raw);
      return {
        ...clone(DEF), ...parsed,
        metrics: { ...clone(DEF).metrics, ...(parsed.metrics || {}) },
        fiscalMetrics: { ...clone(DEF).fiscalMetrics, ...(parsed.fiscalMetrics || {}) },
        settings: { ...clone(DEF).settings, ...(parsed.settings || {}) },
        saludFiscal: { ...clone(DEF).saludFiscal, ...(parsed.saludFiscal || {}) },
        carpetaFiscal: { ...clone(DEF).carpetaFiscal, ...(parsed.carpetaFiscal || {}), monthlyFolders: normalizeMonthlyFolders(parsed.carpetaFiscal?.monthlyFolders) },
        invoiceProfiles: Array.isArray(parsed.invoiceProfiles) ? parsed.invoiceProfiles : [],
        diagnostic: { ...clone(DEF).diagnostic, ...(parsed.diagnostic || {}) }
      };
    } catch { return clone(DEF); }
  }
  let state = load();
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function emit(ev, data) { (EVT[ev] || []).forEach(fn => { try { fn(data); } catch {} }); }
  function emitAll() {
    emit('store:updated', state); emit('storeUpdated', state);
    emit('metrics:updated', state.metrics); emit('metricsUpdated', state.metrics);
    emit('income:updated', state.incomeYTD); emit('incomeUpdated', state.incomeYTD);
  }
  function on(ev, fn) { if (!EVT[ev]) EVT[ev] = []; EVT[ev].push(fn); }
  function calcRiskLevel(income, limit = DEFAULT_LIMIT) {
    const value = Number(income || 0); const max = Number(limit || DEFAULT_LIMIT);
    const ratio = max > 0 ? value / max : 0;
    for (const t of RISK_THRESHOLDS) { if (value >= t.min || ratio >= t.ratio) return t.level; }
    return 'SEGURO';
  }
  const RISK_SEVERITY = { SEGURO: 0, PREVENTIVO: 1, RIESGO_ALTO: 2, EXPULSION: 3 };
  function buildWhatsAppAlertPayload(previousLevel, newLevel, income, limit) {
    const messages = {
      PREVENTIVO: `⚠️ Alerta RESICO: Has superado el 80% de tu límite anual ($2,800,000 MXN). Ingreso actual: $${Number(income).toLocaleString('es-MX')} MXN.`,
      RIESGO_ALTO: `🟠 Riesgo Alto RESICO: Estás en el 90% de tu límite anual ($3,150,000 MXN).`,
      EXPULSION: `🔴 CRÍTICO: Superaste el 94% del límite RESICO ($3,290,000 MXN). Riesgo de expulsión.`
    };
    return {
      channel: 'whatsapp', template_type: 'utility_message',
      trigger: 'risk_threshold_crossed', previous_level: previousLevel,
      new_level: newLevel, income_ytd: Number(income || 0),
      annual_limit: Number(limit || DEFAULT_LIMIT),
      ratio_pct: limit > 0 ? Number(((income / limit) * 100).toFixed(2)) : 0,
      message_body: messages[newLevel] || 'Actualización de tu estatus fiscal RESICO.',
      user_id: usr?.id || null, user_phone: usr?.phone || usr?.user_metadata?.phone || null,
      timestamp: new Date().toISOString(), target_endpoint: '/api/n8n-notify-proxy'
    };
  }
  function evaluateRiskLevelChange(previousLevel, newLevel, income, limit) {
    const wasWorse = RISK_SEVERITY[newLevel] > RISK_SEVERITY[previousLevel || 'SEGURO'];
    if (wasWorse && newLevel !== 'SEGURO') {
      const payload = buildWhatsAppAlertPayload(previousLevel, newLevel, income, limit);
      emit('riskThresholdCrossed', payload);
      console.info('[Store] Umbral de riesgo cruzado — payload WhatsApp listo:', payload);
      return payload;
    }
    return null;
  }
  function updateIncome(amount) {
    const previousLevel = state.fiscalMetrics.riskLevel;
    state.incomeYTD = Number(amount || 0);
    const newLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit || DEFAULT_LIMIT);
    state.fiscalMetrics.riskLevel = newLevel;
    evaluateRiskLevelChange(previousLevel, newLevel, state.incomeYTD, state.fiscalMetrics.annualLimit);
    persist(); emitAll(); upsertMetrics();
  }
  function applyMetricRow(row) {
    if (!row) return;
    const previousLevel = state.fiscalMetrics.riskLevel;
    const remoteIncome = Number(row.income_ytd ?? row.cumulative_income ?? 0);
    if (remoteIncome === 0 && state.incomeYTD > 0) {
      console.info('[Store] applyMetricRow: valor remoto 0 ignorado, conservando local:', state.incomeYTD);
    } else {
      state.incomeYTD = remoteIncome;
    }
    state.fiscalMetrics.annualLimit = DEFAULT_LIMIT;
    const newLevel = calcRiskLevel(Number(state.incomeYTD || 0), DEFAULT_LIMIT);
    state.fiscalMetrics.riskLevel = newLevel;
    evaluateRiskLevelChange(previousLevel, newLevel, state.incomeYTD, DEFAULT_LIMIT);
  }
  function recalc() {
    state.metrics.totalProcessed = state.conversations.length;
    Object.keys(state.metrics.byCategory).forEach(k => { state.metrics.byCategory[k] = 0; });
    let confidenceSum = 0;
    state.conversations.forEach(c => {
      const intent = c.intent || 'OTROS';
      if (intent in state.metrics.byCategory) state.metrics.byCategory[intent]++;
      else state.metrics.byCategory.OTROS++;
      confidenceSum += Number(c.confidence || 0);
    });
    state.metrics.avgConfidence = state.conversations.length ? Math.round((confidenceSum / state.conversations.length) * 100) : 0;
    state.fiscalMetrics.riskLevel = calcRiskLevel(Number(state.incomeYTD || 0), DEFAULT_LIMIT);
  }
  function logSupabaseError(scope, error, payload = null) {
    if (!error) return;
    console.warn(`[Store] ${scope}:`, { message: error.message || 'unknown_error', details: error.details || null, hint: error.hint || null, code: error.code || null, payload });
  }
  function mapConversation(row) {
    return { id: row.id, text: row.message_text || '', message_text: row.message_text || '', intent: row.intent || 'OTROS', confidence: Number(row.confidence || 0), is_fiscal_audit_completed: !!row.is_fiscal_audit_completed, timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(), source: 'supabase' };
  }
  function normalizeDocumentType(row) { return row.document_type || row.doc_type || 'OTRO'; }
  function mapDocument(row) {
    return { id: row.id, file_name: row.file_name || 'archivo', doc_type: row.doc_type || normalizeDocumentType(row), document_type: normalizeDocumentType(row), extracted_data: row.extracted_data || {}, confidence: Number(row.confidence || 0), safety_flag: !!row.safety_flag, validation_status: row.validation_status || 'pendiente', needs_review: !!row.needs_review, source: row.source || 'unknown', file_url: row.file_url || null, created_at: row.created_at || new Date().toISOString(), updated_at: row.updated_at || row.created_at || new Date().toISOString(), folder_category: row.folder_category || row.extracted_data?.folder_category || null };
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
    return { id: doc.id, file_name: doc.file_name || 'archivo', document_type: doc.document_type || doc.doc_type || 'OTRO', created_at: doc.created_at || new Date().toISOString(), fecha_fiscal: doc.extracted_data?.fecha || null, confidence: Number(doc.confidence || 0), needs_review: !!doc.needs_review || !!doc.safety_flag, validation_status: doc.validation_status || 'pendiente', source: doc.source || 'local' };
  }
  function diffDaysFromToday(dateStr) {
    if (!dateStr || dateStr === 'pendiente') return null;
    const today = new Date(); const target = new Date(dateStr);
    today.setHours(0, 0, 0, 0); target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }
  function refreshSaludFiscalFromCarpeta() {
    const expiry = state.carpetaFiscal?.efirmaExpiry || state.saludFiscal?.eFirmaExpiry || null;
    const days = diffDaysFromToday(expiry);
    const hasEFirma = !!expiry && expiry !== 'pendiente';
    let alertLevel = 'safe';
    if (state.saludFiscal?.buzonTributarioActivo === false) alertLevel = 'danger';
    if (days !== null && days <= 0) alertLevel = 'danger';
    else if (days !== null && days <= 30) alertLevel = 'warning';
    else if (state.carpetaFiscal?.constanciaStatus !== 'actualizada' || state.carpetaFiscal?.opinionStatus !== 'cargada') {
      alertLevel = state.saludFiscal?.buzonTributarioActivo === false ? 'danger' : 'warning';
    }
    state.saludFiscal = { ...state.saludFiscal, eFirmaVigente: hasEFirma ? days > 0 : null, eFirmaExpiry: expiry, alertLevel, lastAuditDate: state.saludFiscal?.lastAuditDate || new Date().toISOString() };
  }

  function rebuildCarpetaFiscal() {
  // FIX: Validación defensiva de buildMonthlyFolders
  let folders;
  try {
    folders = buildMonthlyFolders(YEAR);
    if (!Array.isArray(folders) || folders.length !== 12) {
      console.warn('[Store] buildMonthlyFolders devolvió estructura inválida, recreando...');
      folders = MONTHS.map((monthName, idx) => ({
        year: YEAR,
        monthNumber: idx + 1,
        monthKey: `${YEAR}-${String(idx + 1).padStart(2, '0')}`,
        monthName,
        total: 0,
        categories: { ingresos: [], gastos_iva: [], efirma: [], constancia: [], opinion: [] }
      }));
    }
  } catch (e) {
    console.error('[Store] buildMonthlyFolders falló:', e);
    folders = MONTHS.map((monthName, idx) => ({
      year: YEAR,
      monthNumber: idx + 1,
      monthKey: `${YEAR}-${String(idx + 1).padStart(2, '0')}`,
      monthName,
      total: 0,
      categories: { ingresos: [], gastos_iva: [], efirma: [], constancia: [], opinion: [] }
    }));
  }

  const summary = { total: 0, ingresos: 0, gastos_iva: 0, efirma: 0, constancia: 0, opinion: 0 };
  let latestEFirma = null, latestConstancia = null, latestOpinion = null;
  
  (state.documents || []).forEach(doc => {
    try {
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
        if (!latestEFirma || new Date(doc.created_at) > new Date(latestEFirma.created_at)) {
          latestEFirma = doc;
        }
      }
      if (category === 'constancia') {
        if (!latestConstancia || new Date(doc.created_at) > new Date(latestConstancia.created_at)) {
          latestConstancia = doc;
        }
      }
      if (category === 'opinion') {
        if (!latestOpinion || new Date(doc.created_at) > new Date(latestOpinion.created_at)) {
          latestOpinion = doc;
        }
      }
    } catch (e) {
      console.warn('[Store] Error procesando documento en rebuildCarpetaFiscal:', e, doc);
    }
  });

  state.carpetaFiscal = {
    ...state.carpetaFiscal,
    year: YEAR,
    monthlyFolders: folders,
    summary,
    efirmaExpiry: latestEFirma?.extracted_data?.fecha_vencimiento || 
                  latestEFirma?.extracted_data?.fecha || 
                  state.carpetaFiscal?.efirmaExpiry || 
                  'pendiente',
    constanciaStatus: latestConstancia ? 'actualizada' : 'pendiente',
    opinionStatus: latestOpinion ? 'cargada' : 'pendiente',
    lastUpdated: new Date().toISOString()
  };
  
  refreshSaludFiscalFromCarpeta();
  emit('carpetaUpdated', state.carpetaFiscal);
}
 async function syncDown() {
  if (!db || !usr?.id) return;
  
  try {
    const [convRes, metricRes, docRes] = await Promise.all([
      db.from('conversations')
        .select('id,user_id,message_text,intent,confidence,is_fiscal_audit_completed,created_at')
        .eq('user_id', usr.id)
        .order('created_at', { ascending: false })
        .limit(MAX_CONVERSATIONS),
      db.from('fiscal_metrics')
        .select('user_id,income_ytd,total_processed,avg_confidence,updated_at')
        .eq('user_id', usr.id)
        .maybeSingle(),
      db.from('documents')
        .select('id,user_id,file_name,doc_type,document_type,file_url,folder_category,extracted_data,confidence,safety_flag,validation_status,needs_review,source,created_at,updated_at')
        .eq('user_id', usr.id)
        .order('created_at', { ascending: false })
        .limit(MAX_DOCUMENTS)
    ]);

    // Procesar conversaciones
    if (!convRes.error && Array.isArray(convRes.data)) {
      state.conversations = convRes.data.map(mapConversation);
    } else if (convRes.error) {
      logSupabaseError('conversations sync error', convRes.error);
    }

    // Procesar métricas
    if (!metricRes.error && metricRes.data) {
      applyMetricRow(metricRes.data);
    } else if (metricRes.error) {
      logSupabaseError('fiscal_metrics sync error', metricRes.error);
    }

    // Procesar documentos
    if (!docRes.error && Array.isArray(docRes.data)) {
      state.documents = docRes.data.map(mapDocument);
    } else if (docRes.error) {
      logSupabaseError('documents sync error', docRes.error);
    }

    // Recalcular métricas y reconstruir carpeta
    try {
      recalc();
    } catch (e) {
      console.warn('[Store] recalc() falló:', e);
    }

    try {
      rebuildCarpetaFiscal();
    } catch (e) {
      console.error('[Store] rebuildCarpetaFiscal() falló:', e);
      // Crear estructura mínima para evitar cascada de errores
      state.carpetaFiscal = {
        year: YEAR,
        monthlyFolders: MONTHS.map((monthName, idx) => ({
          year: YEAR,
          monthNumber: idx + 1,
          monthKey: `${YEAR}-${String(idx + 1).padStart(2, '0')}`,
          monthName,
          total: 0,
          categories: { ingresos: [], gastos_iva: [], efirma: [], constancia: [], opinion: [] }
        })),
        summary: { total: 0, ingresos: 0, gastos_iva: 0, efirma: 0, constancia: 0, opinion: 0 },
        efirmaExpiry: 'pendiente',
        constanciaStatus: 'pendiente',
        opinionStatus: 'pendiente',
        lastUpdated: new Date().toISOString()
      };
    }

    persist();
    emitAll();
  } catch (e) {
    console.warn('[Store] syncDown exception:', e?.message || e);
  }
}
  async function upsertConversation(c) {
    if (!db || !usr?.id) return;
    const payload = { id: c.id || safeUUID(), user_id: usr.id, message_text: String(c.message_text || c.text || '').slice(0, 10000), intent: c.intent || 'OTROS', confidence: Number(c.confidence || 0), is_fiscal_audit_completed: !!c.is_fiscal_audit_completed };
    try { const { error } = await db.from('conversations').upsert(payload, { onConflict: 'id' }); if (error) logSupabaseError('upsertConversation', error, payload); }
    catch (e) { console.warn('[Store] upsertConversation exception:', e?.message || e, payload); }
  }
 async function upsertMetrics() {
  if (!db || !usr?.id) return;

  // FIX CRÍTICO-1: income_ytd es GENERATED ALWAYS AS (cumulative_income) STORED en PostgreSQL.
  // Incluirla en el payload genera error 428C9 y el UPSERT falla silenciosamente → amnesia de ingresos.
  // Se escribe ÚNICAMENTE en cumulative_income; Supabase calcula income_ytd automáticamente.
  const payload = {
    user_id: usr.id,
    cumulative_income: Number(state.incomeYTD || 0),  // columna maestra — NO income_ytd
    total_processed: Number(state.metrics?.totalProcessed || state.conversations.length || 0),
    avg_confidence: Number(state.metrics?.avgConfidence || 0),
    annual_limit: DEFAULT_LIMIT,
    risk_level: state.fiscalMetrics.riskLevel || 'SEGURO'
  };

  try {
    const { error } = await db.from('fiscal_metrics').upsert(payload, { onConflict: 'user_id' });
    if (error) logSupabaseError('upsertMetrics', error, payload);
  } catch (e) {
    console.warn('[Store] upsertMetrics exception:', e?.message || e, payload);
  }
}

  async function saveDocumentRemote(doc) {
    if (!db || !usr?.id) return;
    const normalizedType = doc.document_type || doc.doc_type || 'OTRO';
    const payload = { id: doc.id || safeUUID(), user_id: usr.id, file_name: doc.file_name || 'unnamed_file', doc_type: normalizedType, document_type: normalizedType, extracted_data: doc.extracted_data || {}, confidence: Number(doc.confidence || 0), safety_flag: !!doc.safety_flag, validation_status: doc.validation_status || 'pendiente', needs_review: !!doc.needs_review || !!doc.safety_flag, source: doc.source || 'web_upload', file_url: doc.file_url || null, folder_category: doc.folder_category || doc.extracted_data?.folder_category || null, updated_at: new Date().toISOString() };
    try { const { error } = await db.from('documents').upsert(payload, { onConflict: 'id' }); if (error) logSupabaseError('saveDocumentRemote', error, payload); }
    catch (e) { console.warn('[Store] saveDocumentRemote exception:', e?.message || e, payload); }
  }
  function subscribeRealtime() {
    if (!db || !usr?.id) return;
    try { if (rtChannel) db.removeChannel(rtChannel); } catch {}
    rtChannel = db.channel(`aliado_rt_${usr.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${usr.id}` }, () => syncDown())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fiscal_metrics', filter: `user_id=eq.${usr.id}` }, () => syncDown())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: `user_id=eq.${usr.id}` }, () => syncDown())
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setTimeout(() => subscribeRealtime(), 5000); });
  }
  function bindAuthListenerOnce() {
    if (!db || authListenerBound) return;
    db.auth.onAuthStateChange(async (_event, session) => {
      usr = session?.user || null; window.APP_STATE.currentUser = usr;
      if (usr?.id) { await syncDown(); subscribeRealtime(); }
      else { try { if (rtChannel) db.removeChannel(rtChannel); } catch {} rtChannel = null; }
    });
    authListenerBound = true;
  }
  async function initSupabase() {
    ensureAppState();
    const url = window.SUPABASE_CONFIG?.url || window.AppConfig?.getSupabaseUrl?.();
    const anonKey = window.SUPABASE_CONFIG?.anonKey || window.AppConfig?.getSupabaseKey?.();
    if (!url || !anonKey || !window.supabase?.createClient) { window.APP_STATE.supabase = null; return null; }
    if (!db) {
      db = window.supabase.createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    }
    window.APP_STATE.supabase = db;
    bindAuthListenerOnce();
    try {
      const { data, error } = await db.auth.getSession();
      if (error) logSupabaseError('getSession', error);
      usr = data?.session?.user || null; window.APP_STATE.currentUser = usr;
      if (usr?.id) { await syncDown(); subscribeRealtime(); }
      return db;
    } catch (e) { console.warn('[Store] initSupabase exception:', e?.message || e); return db; }
  }
  function getState() { return state; }
  function getMetrics() { return state.metrics; }
  function getConversations() { return state.conversations; }
  function getSettings() { return state.settings; }
  function getDocuments() { return state.documents; }
  function getSaludFiscal() { return state.saludFiscal; }
  function getCarpetaFiscal() {
  const docs = state.documents || [];
  const year = new Date().getFullYear();
  const monthlyFolders = [];
  
  for (let month = 0; month < 12; month++) {
    const monthDocs = docs.filter(d => {
      const fecha = d.extracted_data?.fecha || d.created_at;
      if (!fecha) return false;
      const d2 = new Date(fecha);
      return d2.getFullYear() === year && d2.getMonth() === month;
    });
    
    const categories = {
      ingresos: monthDocs.filter(d => 
        d.document_type === 'CFDI' && 
        d.extracted_data?.tax_usefulness === 'ISR'
      ),
      gastos_iva: monthDocs.filter(d => 
        d.extracted_data?.tax_usefulness === 'IVA' || 
        d.extracted_data?.tax_usefulness === 'AMBOS'
      ),
      diario: monthDocs.filter(d => 
        d.extracted_data?.metodo_pago === 'PPD' ||
        d.folder_category === 'diario'
      ),
      efirma: monthDocs.filter(d => d.folder_category === 'efirma'),
      constancia: monthDocs.filter(d => d.folder_category === 'constancia'),
      opinion: monthDocs.filter(d => d.folder_category === 'opinion')
    };
    
    monthlyFolders.push({
      monthName: ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][month],
      categories,
      total: monthDocs.length
    });
  }
  
  return {
    year,
    monthlyFolders,
    summary: {
      ingresos: docs.filter(d => d.extracted_data?.tax_usefulness === 'ISR').length,
      gastos_iva: docs.filter(d => d.extracted_data?.tax_usefulness === 'IVA').length,
      diario: docs.filter(d => d.extracted_data?.metodo_pago === 'PPD').length,
      efirma: docs.filter(d => d.folder_category === 'efirma').length,
      constancia: docs.filter(d => d.folder_category === 'constancia').length,
      opinion: docs.filter(d => d.folder_category === 'opinion').length,
      total: docs.length
    }
  };
}
  function getDiagnostic() { return state.diagnostic; }
  function getInvoiceProfiles() { return state.invoiceProfiles; }
  function setState(partial = {}) {
    state = {
      ...state, ...partial,
      metrics: { ...state.metrics, ...(partial.metrics || {}) },
      fiscalMetrics: { ...state.fiscalMetrics, ...(partial.fiscalMetrics || {}) },
      settings: { ...state.settings, ...(partial.settings || {}) },
      saludFiscal: { ...state.saludFiscal, ...(partial.saludFiscal || {}) },
      carpetaFiscal: { ...state.carpetaFiscal, ...(partial.carpetaFiscal || {}), monthlyFolders: normalizeMonthlyFolders(partial.carpetaFiscal?.monthlyFolders || state.carpetaFiscal.monthlyFolders) },
      invoiceProfiles: Array.isArray(partial.invoiceProfiles) ? partial.invoiceProfiles : state.invoiceProfiles,
      diagnostic: { ...state.diagnostic, ...(partial.diagnostic || {}) }
    };
    recalc(); rebuildCarpetaFiscal(); persist(); emitAll();
  }
  function addConversation(c) {
    const conv = { id: c.id || safeUUID(), text: c.text || c.message_text || '', message_text: c.message_text || c.text || '', intent: c.intent || 'OTROS', confidence: Number(c.confidence || 0), timestamp: c.timestamp || Date.now(), is_fiscal_audit_completed: !!c.is_fiscal_audit_completed, source: c.source || 'local' };
    state.conversations.unshift(conv);
    if (state.conversations.length > MAX_CONVERSATIONS) state.conversations = state.conversations.slice(0, MAX_CONVERSATIONS);
    recalc(); persist();
    emit('conversationAdded', conv); emit('conversationadded', conv); emitAll();
    upsertConversation(conv); upsertMetrics();
  }
  function updateAnnualLimit(amount) {
    const nextLimit = Number(amount || DEFAULT_LIMIT);
    state.fiscalMetrics.annualLimit = nextLimit > 0 ? nextLimit : DEFAULT_LIMIT;
    state.fiscalMetrics.riskLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit);
    persist(); emitAll();
  }
  function updateSaludFiscal(data) {
    state.saludFiscal = { ...state.saludFiscal, ...data };
    if (data?.eFirmaExpiry) state.carpetaFiscal = { ...state.carpetaFiscal, efirmaExpiry: data.eFirmaExpiry };
    refreshSaludFiscalFromCarpeta(); persist();
    emit('saludFiscalUpdated', state.saludFiscal); emitAll();
  }
  const EFIRMA_VALIDITY_YEARS = 4;
  function computeEFirmaVigencia(extractedData) {
    const fechaEmision = extractedData?.fecha || extractedData?.fecha_emision;
    if (!fechaEmision) return null;
    const issued = new Date(fechaEmision);
    if (Number.isNaN(issued.getTime())) return null;
    const expires = new Date(issued); expires.setFullYear(expires.getFullYear() + EFIRMA_VALIDITY_YEARS);
    const today = new Date(); today.setHours(0, 0, 0, 0); expires.setHours(0, 0, 0, 0);
    const diasRestantes = Math.ceil((expires - today) / (1000 * 60 * 60 * 24));
    return { fechaEmision: issued.toISOString().split('T')[0], fechaVencimiento: expires.toISOString().split('T')[0], diasRestantes, vigente: diasRestantes > 0 };
  }
  async function saveDocument(doc) {
    const normalizedType = doc.document_type || doc.doc_type || 'OTRO';
    const localDoc = { id: doc.id || safeUUID(), file_name: doc.file_name || 'unnamed_file', doc_type: normalizedType, document_type: normalizedType, extracted_data: doc.extracted_data || {}, confidence: Number(doc.confidence || 0), safety_flag: !!doc.safety_flag, validation_status: doc.validation_status || 'pendiente', needs_review: !!doc.needs_review || !!doc.safety_flag, source: doc.source || 'local', file_url: doc.file_url || null, created_at: doc.created_at || new Date().toISOString(), updated_at: doc.updated_at || new Date().toISOString(), folder_category: doc.folder_category || doc.extracted_data?.folder_category || null };
    state.documents.unshift(localDoc);
    if (state.documents.length > MAX_DOCUMENTS) state.documents = state.documents.slice(0, MAX_DOCUMENTS);
    if (normalizedType === 'EFIRMA') {
      const vigencia = computeEFirmaVigencia(localDoc.extracted_data);
      if (vigencia) {
        state.saludFiscal = { ...state.saludFiscal, eFirmaVigente: vigencia.vigente, eFirmaExpiry: vigencia.fechaVencimiento, lastAuditDate: new Date().toISOString(), alertLevel: vigencia.diasRestantes <= 0 ? 'danger' : vigencia.diasRestantes <= 30 ? 'warning' : 'safe' };
        state.carpetaFiscal = { ...state.carpetaFiscal, efirmaExpiry: vigencia.fechaVencimiento };
        emit('efirmaVigenciaCalculada', vigencia);
        console.info(`[Store] e.firma: vence ${vigencia.fechaVencimiento} (${vigencia.diasRestantes} días restantes)`);
      }
    }
    rebuildCarpetaFiscal(); persist();
    emit('documentAdded', localDoc); emit('documentadded', localDoc); emitAll();
    await saveDocumentRemote(localDoc);
    return localDoc;
  }
  async function saveInvoiceDocument(invoiceData) {
    const totalFactura = Number(invoiceData?.total || 0);
    const doc = {
      id: safeUUID(),
      file_name: `CFDI_${invoiceData?.invoice_number || invoiceData?.invoice_id || 'sin_folio'}.xml`,
      document_type: 'CFDI', doc_type: 'CFDI',
      extracted_data: {
        alegra_invoice_id: invoiceData?.invoice_id || null,
        invoice_number: invoiceData?.invoice_number || null,
        rfc_receptor: invoiceData?.rfc_receptor || null,
        uso_cfdi: invoiceData?.uso_cfdi || null,
        regimen_fiscal_emisor: invoiceData?.regimen_fiscal_emisor || '626',
        total: totalFactura,
        fecha: invoiceData?.fecha || new Date().toISOString().slice(0, 10),
        tax_usefulness: 'ISR', folder_category: 'ingresos'
      },
      confidence: 1, safety_flag: false, validation_status: 'TIMBRADO',
      needs_review: false, source: 'alegra_invoice', folder_category: 'ingresos',
      created_at: new Date().toISOString()
    };
    const savedDoc = await saveDocument(doc);
    const previousLevel = state.fiscalMetrics.riskLevel;
    const nuevoIncomeYTD = Number(state.incomeYTD || 0) + totalFactura;
    state.incomeYTD = nuevoIncomeYTD;
    const newLevel = calcRiskLevel(nuevoIncomeYTD, state.fiscalMetrics.annualLimit || DEFAULT_LIMIT);
    state.fiscalMetrics.riskLevel = newLevel;
    evaluateRiskLevelChange(previousLevel, newLevel, nuevoIncomeYTD, state.fiscalMetrics.annualLimit || DEFAULT_LIMIT);
    persist();
    emit('income:updated', state.incomeYTD); emit('incomeUpdated', state.incomeYTD);
    emit('invoiceTimbrada', { ...invoiceData, savedDoc }); emitAll();
    await upsertMetrics();
    return savedDoc;
  }
  function updateCarpetaFiscal(data) {
    state.carpetaFiscal = { ...state.carpetaFiscal, ...data, monthlyFolders: normalizeMonthlyFolders(data?.monthlyFolders || state.carpetaFiscal.monthlyFolders), lastUpdated: new Date().toISOString() };
    refreshSaludFiscalFromCarpeta(); persist();
    emit('carpetaUpdated', state.carpetaFiscal); emitAll();
  }
  function setInvoiceProfiles(list) {
    state.invoiceProfiles = Array.isArray(list) ? list.slice(0, 50) : [];
    persist(); emitAll();
  }
 function updateDiagnostic(data) {
  state.diagnostic = { ...state.diagnostic, ...data, completedAt: data?.completedAt || state.diagnostic.completedAt || new Date().toISOString() };
  persist(); emit('diagnosticUpdated', state.diagnostic); emitAll();
  persistDiagnosticRemote(state.diagnostic); // Tarea 1.4: auditoría en Supabase
}
async function persistDiagnosticRemote(d) {
  if (!db || !usr?.id || !d?.completedAt) return;
  const payload = {
    user_id: usr.id, income: Number(d.income || 0), salarios: Number(d.salarios || 0),
    intereses: Number(d.intereses || 0), mixtos: !!d.mixtos, socio_pm: !!d.socioPM,
    cfdi_global: !!d.cfdiGlobal, buzon_activo: !!d.buzonActivo,
    anual_obligatoria: !!d.anualObligatoria, riesgo_multa: !!d.riesgoMulta,
    riesgo_buzon: !!d.riesgoBuzon, risk_level: d.riskLevel || 'SEGURO',
    recomendacion: d.recomendacion || ''
  };
  try { const { error } = await db.from('diagnostic_results').insert(payload); if (error) logSupabaseError('persistDiagnosticRemote', error, payload); }
  catch (e) { console.warn('[Store] persistDiagnosticRemote:', e?.message || e); }
}
  function reset() {
    state = clone(DEF); persist();
    try { if (rtChannel && db) db.removeChannel(rtChannel); } catch {}
    rtChannel = null;
    emit('storeReset', null); emitAll(); rebuildCarpetaFiscal();
  }

// ════════════════════════════════════════════════════════════
// INYECCIÓN PF/PM 2026 — Perfil Fiscal + Gastos + Pólizas + Alarmas
// ════════════════════════════════════════════════════════════

// ── PERFIL FISCAL PF/PM ─────────────────────────────────────────────────
const PERFIL_DEF = {
  tipo_persona: null, // 'PF' | 'PM'
  rfc: '',
  cp: '',
  razon_social: '',
  ventas_publico_general: false,
  completedAt: null
};

function getPerfilFiscal() {
  return state.perfilFiscal || PERFIL_DEF;
}

function setPerfilFiscal(data) {
  state.perfilFiscal = { ...(state.perfilFiscal || PERFIL_DEF), ...data };
  persist();
  emit('perfilUpdated', state.perfilFiscal);
  emitAll();
  persistPerfilRemote(state.perfilFiscal);
}

async function persistPerfilRemote(p) {
  if (!db || !usr?.id) return;
  const payload = {
    user_id: usr.id,
    rfc: p.rfc || null,
    tipo_persona: p.tipo_persona || null,
    cp: p.cp || null,
    razon_social: p.razon_social || null
  };
  try {
    const { error } = await db.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
    if (error) logSupabaseError('persistPerfilRemote', error, payload);
  } catch (e) {
    console.warn('[Store] persistPerfilRemote:', e?.message || e);
  }
}

// ── TRATAMIENTO DE GASTOS PF vs PM ──────────────────────────────────────
// PF: egresos solo para IVA acreditable (ISR sobre brutos, Art. 113-E LISR)
// PM: egresos deducibles ISR (30% utilidad fiscal) + IVA acreditable
function computeGastoTreatment(doc) {
  const e = doc?.extracted_data || {};
  const isPM = (state.perfilFiscal?.tipo_persona || 'PF') === 'PM';
  
  // Detección de combustible
  const fuel = /GASOLIN|PEMEX|OXXO GAS|SHELL|BP\b|MOBIL|G500|COMBUSTIBLE|DIESEL|MAGNA|PREMIUM/i.test(
    `${e.nombre_emisor || ''} ${e.rfc_emisor || ''} ${e.concepto || ''} ${doc?.file_name || ''}`
  );
  const cash = String(e.metodo_pago || e.forma_pago || '') === '01' || /EFECTIVO/i.test(String(e.metodo_pago || ''));
  
  // VALIDACIÓN CRÍTICA: Gasolina en efectivo (Art. 27 Fracc. III LISR)
  if (fuel && cash) {
    return {
      gasto_acreditable: false,
      isr_deducible: false,
      fuel_cash: true,
      legal: 'Art. 27 Fracc. III LISR',
      microcopy: '🚨 Gasolina pagada en EFECTIVO: NO deducible (ISR) ni acreditable (IVA) en ningún caso. Regulariza a tarjeta, transferencia o monedero electrónico.'
    };
  }
  
  // PM: egresos deducibles ISR + IVA acreditable
  if (isPM) {
    return {
      gasto_acreditable: true,
      isr_deducible: true,
      fuel_cash: false,
      legal: 'Arts. 27-31 y 9 LISR · Art. 5 Ley IVA',
      microcopy: '✅ PM: egreso deducible para ISR (30% sobre utilidad fiscal) y acreditable para IVA con CFDI válido.'
    };
  }
  
  // PF: egresos solo IVA acreditable (ISR sobre brutos sin deducciones)
  return {
    gasto_acreditable: true,
    isr_deducible: false,
    fuel_cash: false,
    legal: 'Art. 113-E LISR · Art. 5 Ley IVA',
    microcopy: '✅ PF RESICO: el egreso NO deduce ISR (ingresos brutos sin deducciones) pero SÍ acredita IVA con CFDI válido y gasto indispensable.'
  };
}

// ── GENERACIÓN AUTOMÁTICA DE PÓLIZAS (Event-Driven) ────────────────────
// PUE → INGRESOS · REP → INGRESOS(cobro) · PPD → DIARIO(provisión) · gasto → EGRESOS
function generatePoliza(doc) {
  const e = doc?.extracted_data || {};
  const tipo = String(doc.document_type || '').toUpperCase();
  const metodo = String(e.metodo_pago || '').toUpperCase();
  const sub = Number(e.subtotal || 0), iva = Number(e.iva || 0), tot = Number(e.total || 0);
  const fecha = e.fecha || String(doc.created_at || '').slice(0, 10);
  
  let p = null;
  
  // Pólizas de INGRESOS (CFDI emitidos)
  if (tipo === 'CFDI' && String(e.tax_usefulness || '').toUpperCase() === 'ISR') {
    if (metodo === 'PPD') {
      p = {
        tipo: 'DIARIO',
        concepto: 'CFDI PPD — provisión de ingreso (cuentas por cobrar)',
        pendiente_rep: true,
        partidas: [
          { cuenta: '1101 Clientes', debe: tot, haber: 0 },
          { cuenta: '4101 Ingresos', debe: 0, haber: sub },
          { cuenta: '2205 IVA trasladado', debe: 0, haber: iva }
        ]
      };
    } else if (metodo === 'REP') {
      p = {
        tipo: 'INGRESOS',
        concepto: 'Complemento de pago REP — flujo cobrado',
        pendiente_rep: false,
        partidas: [
          { cuenta: '1101 Bancos', debe: tot, haber: 0 },
          { cuenta: '1101 Clientes', debe: 0, haber: tot }
        ]
      };
    } else {
      p = {
        tipo: 'INGRESOS',
        concepto: 'CFDI PUE — ingreso efectivamente cobrado',
        pendiente_rep: false,
        partidas: [
          { cuenta: '1101 Bancos', debe: tot, haber: 0 },
          { cuenta: '4101 Ingresos', debe: 0, haber: sub },
          { cuenta: '2205 IVA trasladado', debe: 0, haber: iva }
        ]
      };
    }
  }
  
  // Pólizas de EGRESOS (gastos/tickets)
  else if (tipo === 'TICKET' || ['IVA', 'AMBOS'].includes(String(e.tax_usefulness || '').toUpperCase())) {
    const t = computeGastoTreatment(doc);
    const partidas = [
      { cuenta: '5101 Gastos', debe: sub, haber: 0 }
    ];
    if (t.gasto_acreditable) {
      partidas.push({ cuenta: '1150 IVA acreditable', debe: iva, haber: 0 });
    }
    partidas.push({ cuenta: '1101 Bancos', debe: 0, haber: tot });
    
    p = {
      tipo: 'EGRESOS',
      concepto: t.fuel_cash ? 'Egreso NO acreditable (gasolina efectivo)' : 'Egreso pagado',
      riesgo: t.fuel_cash,
      pendiente_rep: false,
      partidas
    };
  }
  
  if (!p) return null;
  
  return {
    id: safeUUID(),
    doc_id: doc.id,
    folio: e.folio || doc.file_name,
    fecha,
    ...p,
    created_at: new Date().toISOString()
  };
}

function getPolizas() {
  return state.polizas || [];
}

function rebuildPolizas() {
  state.polizas = (state.documents || []).map(generatePoliza).filter(Boolean);
}

// ── MOTOR DE ALARMAS PREVENTIVAS ────────────────────────────────────────
// e.firma 4 años (Art. 17-D CFF) · REP día 5 (Art. 29-A CFF) · CFDI Global
function runPreventiveAlarms() {
  const alarms = [];
  const now = new Date();
  const perfil = getPerfilFiscal();
  
  // 1. ALERTA e.firma (4 años vigencia, Art. 17-D CFF)
  const expiry = state.saludFiscal?.eFirmaExpiry;
  if (expiry && expiry !== 'pendiente') {
    // FIX CRÍTICO-3: computeDaysRemaining no existe → ReferenceError.
    // Usar diffDaysFromToday() (declarada en línea ~199) que es idéntica.
    const days = diffDaysFromToday(expiry);
    if (days !== null) {
      if (days <= 0) {
        alarms.push({
          level: 'critical',
          text: `🔴 e.firma VENCIDA: Renueva inmediatamente en el portal SAT. Sin e.firma no puedes timbrar CFDI ni presentar declaraciones (Art. 17-D CFF).`
        });
      } else if (days <= 15) {
        alarms.push({
          level: 'critical',
          text: `⚠️ ¡CRÍTICO! Tu e.firma vence en ${days} día(s). Agenda cita SAT hoy mismo (Art. 17-D CFF).`
        });
      } else if (days <= 30) {
        alarms.push({
          level: 'warning',
          text: `⏰ Tu e.firma vence en ${days} día(s). Programa tu cita en el SAT (Art. 17-D CFF).`
        });
      } else if (days <= 90) {
        alarms.push({
          level: 'info',
          text: `🔐 e.firma vigente hasta ${new Date(expiry).toLocaleDateString('es-MX')} (${days} días restantes).`
        });
      }
    }
  }
  
  // 2. ALERTA REP (Complemento de Pago, Art. 29-A CFF)
  // Si hay CFDI PPD sin REP, debe emitirse antes del día 5 del mes siguiente
  const docs = state.documents || [];
  docs.forEach(d => {
    const metodo = String(d.extracted_data?.metodo_pago || '').toUpperCase();
    const repEmitido = d.extracted_data?.rep_emitido;
    if (metodo === 'PPD' && !repEmitido) {
      const fechaDoc = new Date(d.extracted_data?.fecha || d.created_at);
      const deadline = new Date(fechaDoc.getFullYear(), fechaDoc.getMonth() + 1, 5); // día 5 del mes siguiente
      const daysToDeadline = Math.ceil((deadline - now) / 86400000);
      
      if (daysToDeadline < 0) {
        alarms.push({
          level: 'expired',
          text: `🚨 REP VENCIDO: CFDI PPD ${d.extracted_data?.folio || d.file_name} sin complemento de pago. Venció el ${deadline.toLocaleDateString('es-MX')}. Emite el REP inmediatamente (Art. 29-A CFF).`
        });
      } else if (daysToDeadline <= 5) {
        alarms.push({
          level: 'critical',
          text: `⏰ REP URGENTE: Emite el complemento de pago del CFDI PPD ${d.extracted_data?.folio || d.file_name} antes del ${deadline.toLocaleDateString('es-MX')} (faltan ${daysToDeadline} días). Art. 29-A CFF.`
        });
      }
    }
  });
  
  // 3. ALERTA CFDI Global (público en general, 24h post-cierre mensual)
  if (perfil.ventas_publico_general && now.getDate() === 1 && now.getHours() < 24) {
    alarms.push({
      level: 'critical',
      text: '🌐 CFDI GLOBAL: Tienes 24 horas tras el cierre mensual para emitir el CFDI global de público en general (RFC genérico XAXX010101000). Art. 29-A CFF / regla 2.7.1.8 RMF 2026.'
    });
  }
  
  return alarms;
}

// ── Exponer nuevas funciones en el return final ─────────────────────────
// Añade estas líneas al objeto return antes del cierre del IIFE:
// getPerfilFiscal, setPerfilFiscal, computeGastoTreatment, 
// getPolizas, rebuildPolizas, runPreventiveAlarms

// ════════════════════════════════════════════════════════════
// PROTOCOLO PILOTO — 5 Clientes · Carpetas Storage + Link WhatsApp
// ════════════════════════════════════════════════════════════

/**
 * initPilotFolders()
 * Crea automáticamente los marcadores de carpeta en Supabase Storage
 * bajo la ruta /[user_id]/2026/[mes]/  para Ingresos, Gastos y Pólizas.
 * Se llama al completar el onboarding en modo producción.
 * Usa un archivo .keep de 0 bytes como marcador (práctica estándar S3/Supabase).
 */
async function initPilotFolders() {
  if (!db || !usr?.id) return { ok: false, reason: 'no_session' };
  const supabaseUrl = window.SUPABASE_CONFIG?.url || window.AppConfig?.getSupabaseUrl?.() || '';
  const anonKey    = window.SUPABASE_CONFIG?.anonKey || window.AppConfig?.getSupabaseKey?.() || '';
  if (!supabaseUrl || !anonKey) return { ok: false, reason: 'no_config' };

  const YEAR  = 2026;
  const MONTH = '08';
  const BASE  = `${usr.id}/${YEAR}/${MONTH}`;
  const CATS  = ['Ingresos', 'Gastos', 'Polizas']; // Ingresos, Gastos, Pólizas (sin tilde para Storage)

  const results = [];
  for (const cat of CATS) {
    const path = `${BASE}/${cat}/.keep`;
    try {
      const { error } = await db.storage
        .from('carpeta-fiscal')
        .upload(path, new Blob([''], { type: 'text/plain' }), { upsert: true });
      results.push({ cat, path, ok: !error, error: error?.message || null });
      if (error) console.warn(`[Store] initPilotFolders ${cat}:`, error.message);
    } catch (e) {
      results.push({ cat, path, ok: false, error: e.message });
      console.warn(`[Store] initPilotFolders exception ${cat}:`, e.message);
    }
  }

  const allOk = results.every(r => r.ok);
  console.info('[Store] Carpetas piloto inicializadas:', results);
  emit('pilotFoldersCreated', { results, allOk, base: BASE });
  return { ok: allOk, results, base: BASE };
}

/**
 * generatePilotLink(options)
 * Genera la URL de prospección para los 5 clientes piloto.
 * Incluye ?ref=piloto y opcionalmente el RFC del prospecto.
 * Lista para compartir por WhatsApp/Telegram.
 *
 * @param {{ rfc?: string, agentName?: string, customMsg?: boolean }} options
 * @returns {{ url: string, waText: string, waLink: string }}
 */
function generatePilotLink({ rfc = '', agentName = 'Tu Aliado RESICO', customMsg = true } = {}) {
  const base  = window.location.origin || 'https://aliado-resico.vercel.app';
  const params = new URLSearchParams({ ref: 'piloto', utm_source: 'whatsapp', utm_medium: 'referral' });
  if (rfc) params.set('rfc', rfc.toUpperCase().trim());

  const url = `${base}/?${params.toString()}`;

  const msg = customMsg
    ? `🛡️ *Salud Fiscal RESICO Gratuita* — Cortesía de ${agentName}\n\n` +
      `👉 Ingresa en: ${url}\n\n` +
      `✅ En 2 minutos sabrás:\n` +
      `• Si tu e.firma está vigente o próxima a vencer\n` +
      `• Si tu Buzón Tributario está activo\n` +
      `• Tu nivel de riesgo vs el límite de $3,500,000 MXN\n\n` +
      `⚠️ Sin costo · Sin registro obligatorio · 100% confidencial`
    : url;

  const waLink = `https://wa.me/?text=${encodeURIComponent(msg)}`;

  return { url, waText: msg, waLink };
}

  return {
    on, initSupabase, getState, getMetrics, getConversations, getSettings,
    getDocuments, getSaludFiscal, getCarpetaFiscal, getDiagnostic,
    getInvoiceProfiles, setInvoiceProfiles, setState, addConversation,
    updateIncome, updateAnnualLimit, updateSaludFiscal, saveDocument,
    saveInvoiceDocument, updateCarpetaFiscal, updateDiagnostic, reset,
    getPerfilFiscal, setPerfilFiscal, computeGastoTreatment,
    getPolizas, rebuildPolizas, runPreventiveAlarms,
    // ── Protocolo Piloto ──────────────────────────────────
    initPilotFolders, generatePilotLink,
  };
})();

window.Store = Store;