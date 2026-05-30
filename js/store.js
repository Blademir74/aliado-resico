/* ============================================
   ALIADO RESICO — Store v5.2
   Fix crítico: initSupabase usa APP_STATE.supabase
   (cliente instanciado por init-db.js)
   NO window.supabase — esa es la librería CDN
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
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          ...DEF, ...p,
          metrics:     { ...DEF.metrics,     ...(p.metrics     || {}) },
          settings:    { ...DEF.settings,    ...(p.settings    || {}) },
          saludFiscal: { ...DEF.saludFiscal, ...(p.saludFiscal || {}) },
        };
      }
    } catch(_) {}
    return JSON.parse(JSON.stringify(DEF));
  }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(_){} }
  let state = load();

  function emit(ev, data) { (EVT[ev]||[]).forEach(fn => { try { fn(data); } catch(_){} }); }
  function on(ev, fn) { if (!EVT[ev]) EVT[ev]=[]; EVT[ev].push(fn); }

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

  // ─────────────────────────────────────────────
  // FIX: usa window.APP_STATE.supabase (cliente)
  //      NO window.supabase (librería CDN)
  // ─────────────────────────────────────────────
  async function initSupabase() {
    const client = window.APP_STATE?.supabase;
    if (!client) {
      console.warn('[Store] APP_STATE.supabase no disponible — modo localStorage');
      return false;
    }
    db = client;
    try {
      const { data, error } = await db.auth.getUser();
      if (error || !data?.user) {
        console.warn('[Store] Sin sesión autenticada — localStorage activo');
        return false;
      }
      usr = data.user;
      console.log(`%c[Store] ✅ Auth: ${usr.email}`, 'color:#10b981;font-weight:bold');
      _subscribeRealtime();
      await _syncDown();
      return true;
    } catch(e) {
      console.warn('[Store] initSupabase:', e.message);
      return false;
    }
  }

  function _subscribeRealtime() {
    if (!db || !usr) return;
    try {
      db.channel(`store_${usr.id}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'conversations',
          filter: `user_id=eq.${usr.id}`,
        }, p => {
          if (!p.new) return;
          state.conversations.unshift(_mapRow(p.new));
          recalc(); persist();
          emit('conversation:added', p.new);
          emit('metrics:updated', state.metrics);
        })
        .subscribe();
    } catch(e) { console.warn('[Store] Realtime:', e.message); }
  }

  function _mapRow(r) {
    return {
      id: r.id, text: r.text, sender: r.sender||'Usuario', time: r.time||'',
      intent: r.intent, confidence: r.confidence||0, keywords: r.keywords||[],
      explanation: r.explanation||'', response: r.response||'',
      source: r.source||'supabase',
      timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
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
        id: c.id, user_id: usr.id, text: c.text, sender: c.sender,
        time: c.time, intent: c.intent, confidence: c.confidence,
        keywords: c.keywords||[], explanation: c.explanation||'',
        response: c.response||'', source: c.source||'local',
        created_at: c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch(e) { console.warn('[Store] upsertConv:', e.message); }
  }

  async function _upsertMetrics() {
    if (!db || !usr) return;
    try {
      const { error } = await db.from('fiscal_metrics')
        .upsert({
          user_id:         usr.id,
          income_ytd:      Number(state.incomeYTD)                     || 0,
          total_processed: Number(state.metrics.totalProcessed)         || 0,
          avg_confidence:  (Number(state.metrics.avgConfidence) / 100)  || 0,
        }, { onConflict: 'user_id' });

      if (error) console.warn('[Store] metrics:', error.message);
    } catch(e) { console.warn('[Store] metrics:', e.message); }
  }

  function addConversation(c) {
    state.conversations.unshift(c);
    if (state.conversations.length > 200) state.conversations.pop();
    recalc(); persist();
    emit('conversation:added', c);
    emit('metrics:updated', state.metrics);
    _upsertConv(c);
    _upsertMetrics();
  }

  async function saveDocument(doc) {
    state.documents.unshift(doc);
    if (state.documents.length > 100) state.documents.pop();
    persist(); emit('document:added', doc);
    if (!db || !usr) return;
    try {
      await db.from('documents').insert({
        user_id: usr.id, file_name: doc.fileName, doc_type: doc.type,
        extracted_data: doc.data, confidence: doc.confidence,
        needs_review: doc.needsHumanReview||false,
      });
    } catch(e) { console.warn('[Store] saveDocument:', e.message); }
  }

  function updateIncome(v) { state.incomeYTD = v; persist(); emit('income:updated', v); _upsertMetrics(); }
  function updateSetting(k, v) { state.settings[k] = v; persist(); emit('settings:changed', {key:k,value:v}); }
  function updateSaludFiscal(data) {
    Object.assign(state.saludFiscal, data, { lastAuditDate: new Date().toISOString() });
    const { buzonTributarioActivo: b, eFirmaVigente: e } = state.saludFiscal;
    state.saludFiscal.alertLevel = (!b || !e) ? 'critical' : 'safe';
    persist(); emit('saludFiscal:updated', state.saludFiscal);
  }
  function reset() { Object.assign(state, JSON.parse(JSON.stringify(DEF))); persist(); emit('store:reset'); }

  function getState()         { return state; }
  function getMetrics()       { return state.metrics; }
  function getConversations() { return state.conversations; }
  function getSettings()      { return state.settings; }
  function getDocuments()     { return state.documents; }
  function getSaludFiscal()   { return state.saludFiscal; }

  return {
    on, getState, getMetrics, getConversations, getSettings, getDocuments, getSaludFiscal,
    addConversation, updateSetting, updateIncome, updateSaludFiscal, saveDocument,
    initSupabase, reset,
  };
})();
if (typeof window !== 'undefined') window.Store = Store;