/* ============================================
   ALIADO RESICO — Store v5.4
   Fix: columnas correctas message_text (no text)
   Fix: incluir is_fiscal_audit_completed
   ============================================ */
const Store = (() => {
  const KEY = 'aliado_resico_v5';
  const EVT = {};
  let db = null, usr = null;

  const DEF = {
    conversations: [],
    metrics: {
      totalProcessed: 0,
      byCategory: { CONSULTA_FISCAL:0, SOLICITUD_FACTURA:0, REGISTRO_GASTO:0, REPORTE_PAGO:0, SALUD_FISCAL:0, OTROS:0 },
      avgConfidence: 0, autoResolutionRate: 0, avgResponseTime: 2.3,
    },
    incomeYTD: 0,
    settings: { autoReply:true, incomeAlert:true, sound:false },
    documents: [],
    saludFiscal: {
      buzonTributarioActivo: null, eFirmaVigente: null,
      eFirmaExpiry: null, lastAuditDate: null, alertLevel: 'safe',
    },
    carpetaFiscal: {
      efirmaExpiry: null,
      constanciaStatus: null,
      opinionStatus: null,
      lastUpdated: null,
    },
  };

  function load() { /* igual */ }
  function persist() { /* igual */ }
  let state = load();
  function emit(ev, data) { /* igual */ }
  function on(ev, fn) { /* igual */ }

  function recalc() {
    state.metrics.totalProcessed = state.conversations.length;
    Object.keys(DEF.metrics.byCategory).forEach(k => state.metrics.byCategory[k] = 0);
    state.conversations.forEach(c => {
      if (c.intent in state.metrics.byCategory) state.metrics.byCategory[c.intent]++;
    });
    if (state.conversations.length) {
      state.metrics.avgConfidence = Math.round(
        state.conversations.reduce((a,c) => a + (c.confidence||0), 0)
        / state.conversations.length * 100
      );
    }
  }

  // Carpeta fiscal (sin cambios)
  function getCarpetaFiscal() { return state.carpetaFiscal; }
  async function updateCarpetaFiscal(data) { /* ... */ }
  function setEfirmaExpiry(dateISO) { updateCarpetaFiscal({ efirmaExpiry: dateISO }); }
  function setConstanciaStatus(status) { updateCarpetaFiscal({ constanciaStatus: status }); }
  function setOpinionStatus(status) { updateCarpetaFiscal({ opinionStatus: status }); }

  async function initSupabase() { /* igual */ }

  function _subscribeRealtime() { /* igual */ }

  // Mapeo desde fila de BD → objeto frontend
  function _mapRow(r) {
    return {
      id: r.id,
      text: r.message_text,        // ← columna correcta
      sender: r.sender || 'Usuario',
      time: r.time || '',
      intent: r.intent,
      confidence: r.confidence || 0,
      keywords: r.keywords || [],
      explanation: r.explanation || '',
      response: r.response || '',
      source: r.source || 'supabase',
      timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      is_fiscal_audit_completed: r.is_fiscal_audit_completed || false, // ← nuevo
    };
  }

  async function _syncDown() {
    if (!db || !usr) return;
    try {
      const [{ data: convs }, { data: met }] = await Promise.all([
        db.from('conversations').select('*')
          .eq('user_id', usr.id).order('created_at', { ascending: false }).limit(200),
        db.from('fiscal_metrics')
          .select('income_ytd,total_processed,avg_confidence')
          .eq('user_id', usr.id).maybeSingle(),
      ]);
      if (convs) { state.conversations = convs.map(_mapRow); recalc(); persist(); emit('metrics:updated', state.metrics); }
      if (met?.income_ytd !== undefined) { state.incomeYTD = met.income_ytd; persist(); emit('income:updated', state.incomeYTD); }
    } catch(e) { console.warn('[Store] syncDown:', e.message); }
  }

  async function _upsertConv(c) {
    if (!db || !usr) return;
    try {
      await db.from('conversations').upsert({
        id: c.id,
        user_id: usr.id,
        message_text: c.text,           // ← columna correcta
        sender: c.sender,
        time: c.time,
        intent: c.intent,
        confidence: c.confidence,
        keywords: c.keywords || [],
        explanation: c.explanation || '',
        response: c.response || '',
        source: c.source || 'local',
        is_fiscal_audit_completed: c.is_fiscal_audit_completed || false, // ← nuevo
        created_at: c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch(e) { console.warn('[Store] upsertConv:', e.message); }
  }

  async function _upsertMetrics() {
    if (!db) return;
    let uid = null;
    if (window.AuthManager && typeof window.AuthManager.getUserId === 'function') {
      uid = window.AuthManager.getUserId();
    }
    if (!uid && usr) uid = usr.id;
    if (!uid) return;
    await db.from('fiscal_metrics').upsert({
      user_id: uid,
      income_ytd: state.incomeYTD,
      total_processed: state.metrics.totalProcessed,
      avg_confidence: state.metrics.avgConfidence / 100,
    }, { onConflict: 'user_id' });
  }

  function addConversation(c) {
    // Asegurar que el campo esté presente
    if (c.is_fiscal_audit_completed === undefined) c.is_fiscal_audit_completed = false;
    state.conversations.unshift(c);
    if (state.conversations.length > 200) state.conversations.pop();
    recalc(); persist();
    emit('conversation:added', c);
    emit('metrics:updated', state.metrics);
    _upsertConv(c);
    _upsertMetrics();
  }

  // Resto de funciones (saveDocument, updateIncome, updateSaludFiscal, reset, getters) iguales
  // ...

  return {
    on, getState, getMetrics, getConversations, getSettings, getDocuments, getSaludFiscal,
    addConversation, updateSetting, updateIncome, updateSaludFiscal, saveDocument,
    initSupabase, reset, getCarpetaFiscal, updateCarpetaFiscal, setEfirmaExpiry, setConstanciaStatus, setOpinionStatus,
  };
})();

if (typeof window !== 'undefined') window.Store = Store;