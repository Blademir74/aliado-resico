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
    { level: 'EXPULSION',  min: ALERT_94, ratio: 0.94 },
    { level: 'RIESGO_ALTO', min: ALERT_90, ratio: 0.90 },
    { level: 'PREVENTIVO', min: ALERT_80, ratio: 0.80 },
    { level: 'SEGURO',     min: 0,        ratio: 0 }
  ];

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
      salarios: 0,
      intereses: 0,
      cfdiGlobal: false,
      buzonActivo: true,
      anualObligatoria: false,
      riesgoMulta: false,
      riesgoBuzon: false,
      riskLevel: 'SEGURO',
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
    const value = Number(income || 0);
    const max = Number(limit || DEFAULT_LIMIT);
    const ratio = max > 0 ? value / max : 0;

    for (const t of RISK_THRESHOLDS) {
      if (value >= t.min || ratio >= t.ratio) return t.level;
    }
    return 'SEGURO';
  }

  const RISK_SEVERITY = { SEGURO: 0, PREVENTIVO: 1, RIESGO_ALTO: 2, EXPULSION: 3 };

  function buildWhatsAppAlertPayload(previousLevel, newLevel, income, limit) {
  const messages = {
    PREVENTIVO: `⚠️ Alerta RESICO: Has superado el 80% de tu límite anual ($2,800,000 MXN). Ingreso actual: $${Number(income).toLocaleString('es-MX')} MXN. Monitorea tu facturación.`,
    RIESGO_ALTO: `🟠 Riesgo Alto RESICO: Estás en el 90% de tu límite anual ($3,150,000 MXN). Ingreso actual: $${Number(income).toLocaleString('es-MX')} MXN. Revisa tu proyección de cierre.`,
    EXPULSION: `🔴 CRÍTICO: Superaste el 94% del límite RESICO ($3,290,000 MXN). Riesgo inminente de expulsión del régimen. Ingreso actual: $${Number(income).toLocaleString('es-MX')} MXN.`
  };

  return {
    channel: 'whatsapp',
    template_type: 'utility_message', // ~$0.17 MXN por mensaje (Meta Business pricing)
    trigger: 'risk_threshold_crossed',
    previous_level: previousLevel,
    new_level: newLevel,
    income_ytd: Number(income || 0),
    annual_limit: Number(limit || DEFAULT_LIMIT),
    ratio_pct: limit > 0 ? Number(((income / limit) * 100).toFixed(2)) : 0,
    message_body: messages[newLevel] || 'Actualización de tu estatus fiscal RESICO.',
    user_id: usr?.id || null,
    user_phone: usr?.phone || usr?.user_metadata?.phone || null,
    timestamp: new Date().toISOString(),
    // Endpoint destino, aún no invocado — preparado para integración futura
    target_endpoint: '/api/n8n-notify-proxy'
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

// ── updateIncome() extendido con detección de cruce ─────────────────────────
function updateIncome(amount) {
  const previousLevel = state.fiscalMetrics.riskLevel;
  state.incomeYTD = Number(amount || 0);
  const newLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit || DEFAULT_LIMIT);
  state.fiscalMetrics.riskLevel = newLevel;

  evaluateRiskLevelChange(previousLevel, newLevel, state.incomeYTD, state.fiscalMetrics.annualLimit);

  persist();
  emitAll();
  upsertMetrics();
}


// ────────────────────────────────────────────────────────────
// FUNCIÓN 1: recalc() — NUNCA sobrescribe income histórico
// ────────────────────────────────────────────────────────────
function recalc() {
  // Métricas de conversaciones (siempre recalcular)
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

  // ⚠️  BLINDAJE CRÍTICO: No recalcular incomeYTD desde conversaciones locales.

  state.fiscalMetrics.riskLevel = calcRiskLevel(
    Number(state.incomeYTD || 0),
    DEFAULT_LIMIT
  );
}

  function logSupabaseError(scope, error, payload = null) {
    if (!error) return;
    console.warn(`[Store] ${scope}:`, {
      message: error.message || 'unknown_error',
      details: error.details || null,
      hint: error.hint || null,
      code: error.code || null,
      payload
    });
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
      doc_type: row.doc_type || normalizeDocumentType(row),
      document_type: normalizeDocumentType(row),
      extracted_data: row.extracted_data || {},
      confidence: Number(row.confidence || 0),
      safety_flag: !!row.safety_flag,
      validation_status: row.validation_status || 'pendiente',
      needs_review: !!row.needs_review,
      source: row.source || 'unknown',
      file_url: row.file_url || null,
      created_at: row.created_at || new Date().toISOString(),
      updated_at: row.updated_at || row.created_at || new Date().toISOString(),
      folder_category: row.folder_category || row.extracted_data?.folder_category || null
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

  function diffDaysFromToday(dateStr) {
    if (!dateStr || dateStr === 'pendiente') return null;
    const today = new Date();
    const target = new Date(dateStr);
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
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
    else if (
      state.carpetaFiscal?.constanciaStatus !== 'actualizada' ||
      state.carpetaFiscal?.opinionStatus !== 'cargada'
    ) {
      alertLevel = state.saludFiscal?.buzonTributarioActivo === false ? 'danger' : 'warning';
    }

    state.saludFiscal = {
      ...state.saludFiscal,
      eFirmaVigente: hasEFirma ? days > 0 : null,
      eFirmaExpiry: expiry,
      alertLevel,
      lastAuditDate: state.saludFiscal?.lastAuditDate || new Date().toISOString()
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
      efirmaExpiry:
        latestEFirma?.extracted_data?.fecha_vencimiento ||
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
        db
          .from('conversations')
          .select('id,user_id,message_text,intent,confidence,is_fiscal_audit_completed,created_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(MAX_CONVERSATIONS),

        db
          .from('fiscal_metrics')
          .select('user_id,income_ytd,total_processed,avg_confidence,updated_at')
          .eq('user_id', usr.id)
          .maybeSingle(),

        db
          .from('documents')
          .select('id,user_id,file_name,doc_type,document_type,file_url,folder_category,extracted_data,confidence,safety_flag,validation_status,needs_review,source,created_at,updated_at')
          .eq('user_id', usr.id)
          .order('created_at', { ascending: false })
          .limit(MAX_DOCUMENTS)
      ]);

      if (!convRes.error && Array.isArray(convRes.data)) {
        state.conversations = convRes.data.map(mapConversation);
      } else {
        logSupabaseError('conversations sync error', convRes.error);
      }

      if (!metricRes.error && metricRes.data) {
        applyMetricRow(metricRes.data);
      } else if (metricRes.error) {
        logSupabaseError('fiscal_metrics sync error', metricRes.error);
      }

      if (!docRes.error && Array.isArray(docRes.data)) {
        state.documents = docRes.data.map(mapDocument);
      } else {
        logSupabaseError('documents sync error', docRes.error);
      }

      recalc();
      rebuildCarpetaFiscal();
      persist();
      emitAll();
    } catch (e) {
      console.warn('[Store] syncDown exception:', e?.message || e);
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
      if (error) logSupabaseError('upsertConversation', error, payload);
    } catch (e) {
      console.warn('[Store] upsertConversation exception:', e?.message || e, payload);
    }
  }

  // ────────────────────────────────────────────────────────────
// FUNCIÓN 2: upsertMetrics() — Payload estricto (4 campos)
// Fix error 428C9: income_ytd ya NO es generated column
// ────────────────────────────────────────────────────────────
async function upsertMetrics() {
  if (!db || !usr?.id) return;

  // PAYLOAD ESTRICTO: exactamente los 4 campos escritos en fiscal_metrics.
  // NO incluir annual_limit, risk_level ni campos calculados por el servidor.
  const payload = {
    user_id:         usr.id,
    income_ytd:      Number(state.incomeYTD || 0),
    total_processed: Number(state.metrics?.totalProcessed || state.conversations.length || 0),
    avg_confidence:  Number(state.metrics?.avgConfidence  || 0)
  };

  try {
    const { error } = await db
      .from('fiscal_metrics')
      .upsert(payload, { onConflict: 'user_id' }); // UNIQUE en user_id habilitado por el SQL

    if (error) logSupabaseError('upsertMetrics', error, payload);
  } catch (e) {
    console.warn('[Store] upsertMetrics exception:', e?.message || e, payload);
  }
}

// ── FIX A.3: applyMetricRow UNIFICADA ─────────────────────────────────────
// Combina: protección contra cero + detección de cruce de umbral
function applyMetricRow(row) {
  if (!row) return;
  const previousLevel = state.fiscalMetrics.riskLevel;
  const remoteIncome = Number(row.income_ytd ?? 0);

  // REGLA DE ORO: Un valor 0 remoto solo se acepta si el estado local
  // también es 0. Nunca limpiar un ingreso histórico ya registrado.
  if (remoteIncome === 0 && state.incomeYTD > 0) {
    console.info('[Store] applyMetricRow: valor remoto 0 ignorado, conservando local:', state.incomeYTD);
  } else {
    state.incomeYTD = remoteIncome;
  }

  // El annual_limit es constante normativa (Art. 113-E LISR), NO viene de la DB
  state.fiscalMetrics.annualLimit = DEFAULT_LIMIT;
  const newLevel = calcRiskLevel(Number(state.incomeYTD || 0), DEFAULT_LIMIT);
  state.fiscalMetrics.riskLevel = newLevel;

  // FIX A.3: Detectar cruce de umbral desde sincronización Supabase
  evaluateRiskLevelChange(previousLevel, newLevel, state.incomeYTD, DEFAULT_LIMIT);
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
      folder_category: doc.folder_category || doc.extracted_data?.folder_category || null,
      updated_at: new Date().toISOString()
    };

    try {
      const { error } = await db.from('documents').upsert(payload, { onConflict: 'id' });
      if (error) logSupabaseError('saveDocumentRemote', error, payload);
    } catch (e) {
      console.warn('[Store] saveDocumentRemote exception:', e?.message || e, payload);
    }
  }

  function subscribeRealtime() {
    if (!db || !usr?.id) return;

    try {
      if (rtChannel) db.removeChannel(rtChannel);
    } catch {}

    rtChannel = db
      .channel(`aliado_rt_${usr.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${usr.id}` }, () => syncDown())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fiscal_metrics', filter: `user_id=eq.${usr.id}` }, () => syncDown())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: `user_id=eq.${usr.id}` }, () => syncDown())
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

    const url = window.SUPABASE_CONFIG?.url || window.AppConfig?.getSupabaseUrl?.();
    const anonKey = window.SUPABASE_CONFIG?.anonKey || window.AppConfig?.getSupabaseKey?.();

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
    }

    window.APP_STATE.supabase = db;
    bindAuthListenerOnce();

    try {
      const { data, error } = await db.auth.getSession();
      if (error) logSupabaseError('getSession', error);

      usr = data?.session?.user || null;
      window.APP_STATE.currentUser = usr;

      if (usr?.id) {
        await syncDown();
        subscribeRealtime();
      }

      return db;
    } catch (e) {
      console.warn('[Store] initSupabase exception:', e?.message || e);
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
  function getInvoiceProfiles() { return state.invoiceProfiles; }

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
        monthlyFolders: normalizeMonthlyFolders(
          partial.carpetaFiscal?.monthlyFolders || state.carpetaFiscal.monthlyFolders
        )
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
    emit('conversationAdded', conv);
    emit('conversationadded', conv);
    emitAll();
    upsertConversation(conv);
    upsertMetrics();
  }

  function updateAnnualLimit(amount) {
    const nextLimit = Number(amount || DEFAULT_LIMIT);
    state.fiscalMetrics.annualLimit = nextLimit > 0 ? nextLimit : DEFAULT_LIMIT;
    state.fiscalMetrics.riskLevel = calcRiskLevel(state.incomeYTD, state.fiscalMetrics.annualLimit);
    persist();
    emitAll();
  }

  function updateSaludFiscal(data) {
    state.saludFiscal = {
      ...state.saludFiscal,
      ...data
    };

    if (data?.eFirmaExpiry) {
      state.carpetaFiscal = {
        ...state.carpetaFiscal,
        efirmaExpiry: data.eFirmaExpiry
      };
    }

    refreshSaludFiscalFromCarpeta();
    persist();
    emit('saludFiscalUpdated', state.saludFiscal);
    emitAll();
  }



const EFIRMA_VALIDITY_YEARS = 4; // Art. 17-D CFF

function computeEFirmaVigencia(extractedData) {
  const fechaEmision = extractedData?.fecha || extractedData?.fecha_emision;
  if (!fechaEmision) return null;

  const issued = new Date(fechaEmision);
  if (Number.isNaN(issued.getTime())) return null;

  const expires = new Date(issued);
  expires.setFullYear(expires.getFullYear() + EFIRMA_VALIDITY_YEARS);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expires.setHours(0, 0, 0, 0);

  const diasRestantes = Math.ceil((expires - today) / (1000 * 60 * 60 * 24));

  return {
    fechaEmision: issued.toISOString().split('T')[0],
    fechaVencimiento: expires.toISOString().split('T')[0],
    diasRestantes,
    vigente: diasRestantes > 0
  };
}

// ── saveDocument() extendido con trigger de e.firma ────────────────────────
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

  // ── TRIGGER: Si es e.firma, calcular vigencia de 4 años ────────────────
  if (normalizedType === 'EFIRMA') {
    const vigencia = computeEFirmaVigencia(localDoc.extracted_data);
    if (vigencia) {
      state.saludFiscal = {
        ...state.saludFiscal,
        eFirmaVigente: vigencia.vigente,
        eFirmaExpiry: vigencia.fechaVencimiento,
        lastAuditDate: new Date().toISOString(),
        alertLevel: vigencia.diasRestantes <= 0 ? 'danger'
                   : vigencia.diasRestantes <= 30 ? 'warning' : 'safe'
      };
      state.carpetaFiscal = {
        ...state.carpetaFiscal,
        efirmaExpiry: vigencia.fechaVencimiento
      };

      emit('efirmaVigenciaCalculada', vigencia);
      console.info(
        `[Store] e.firma: vence ${vigencia.fechaVencimiento} ` +
        `(${vigencia.diasRestantes} días restantes)`
      );
    }
  }

  rebuildCarpetaFiscal();
  persist();
  emit('documentAdded', localDoc);
  emit('documentadded', localDoc);
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

    refreshSaludFiscalFromCarpeta();
    persist();
    emit('carpetaUpdated', state.carpetaFiscal);
    emitAll();
  }

  function setInvoiceProfiles(list) {
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
    rebuildCarpetaFiscal();
  }

  rebuildCarpetaFiscal();

  // ── FIX A.1: saveInvoiceDocument DENTRO del IIFE (acceso al closure) ─────
async function saveInvoiceDocument(invoiceData) {
  const totalFactura = Number(invoiceData?.total || 0);
  const doc = {
    id: safeUUID(),
    file_name: `CFDI_${invoiceData?.invoice_number || invoiceData?.invoice_id || 'sin_folio'}.xml`,
    document_type: 'CFDI',
    doc_type: 'CFDI',
    extracted_data: {
      alegra_invoice_id: invoiceData?.invoice_id || null,
      invoice_number: invoiceData?.invoice_number || null,
      rfc_receptor: invoiceData?.rfc_receptor || null,
      uso_cfdi: invoiceData?.uso_cfdi || null,
      regimen_fiscal_emisor: invoiceData?.regimen_fiscal_emisor || '626',
      total: totalFactura,
      fecha: invoiceData?.fecha || new Date().toISOString().slice(0, 10),
      tax_usefulness: 'ISR',
      folder_category: 'ingresos'
    },
    confidence: 1,
    safety_flag: false,
    validation_status: 'TIMBRADO',
    needs_review: false,
    source: 'alegra_invoice',
    folder_category: 'ingresos',
    created_at: new Date().toISOString()
  };

  const savedDoc = await saveDocument(doc);

  // Sumar al Monitor de Ingresos y recalcular semáforo RESICO (Art. 113-E LISR)
  const previousLevel = state.fiscalMetrics.riskLevel;
  const nuevoIncomeYTD = Number(state.incomeYTD || 0) + totalFactura;
  state.incomeYTD = nuevoIncomeYTD;
  const newLevel = calcRiskLevel(nuevoIncomeYTD, state.fiscalMetrics.annualLimit || DEFAULT_LIMIT);
  state.fiscalMetrics.riskLevel = newLevel;

  // FIX A.1: Detectar cruce de umbral al timbrar (alertas WhatsApp)
  evaluateRiskLevelChange(previousLevel, newLevel, nuevoIncomeYTD, state.fiscalMetrics.annualLimit || DEFAULT_LIMIT);

  persist();
  emit('income:updated', state.incomeYTD);
  emit('incomeUpdated', state.incomeYTD);
  emit('invoiceTimbrada', { ...invoiceData, savedDoc });
  emitAll();
  await upsertMetrics();
  return savedDoc;
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
    getInvoiceProfiles,
    setInvoiceProfiles,
    setState,
    addConversation,
    updateIncome,
    updateAnnualLimit,
    updateSaludFiscal,
    saveDocument,
    saveInvoiceDocument,
    updateCarpetaFiscal,
    updateDiagnostic,
    reset,
    buildWhatsAppAlertPayload,
    evaluateRiskLevelChange,
  };

})();
window.Store = Store;