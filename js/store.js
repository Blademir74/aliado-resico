/* ============================================
   ALIADO RESICO — Store v5.0
   Fix: initSupabase usa APP_STATE.supabase
        NO window.supabase (librería CDN)
   Fix: maybeSingle() en queries que pueden
        devolver 0 filas
   ============================================ */
const Store = (() => {
  const KEY = 'aliado_resico_v5';
  const EVT = {};
  let db = null, user = null;

  const DEF = {
    conversations: [],
    metrics: { totalProcessed:0, byCategory:{CONSULTA_FISCAL:0,SOLICITUD_FACTURA:0,REGISTRO_GASTO:0,REPORTE_PAGO:0,SALUD_FISCAL:0,OTROS:0}, avgConfidence:0, autoResolutionRate:0, avgResponseTime:2.3 },
    incomeYTD: 0,
    settings: { autoReply:true, incomeAlert:true, sound:false },
    documents: [],
    saludFiscal: { buzonTributarioActivo:null, eFirmaVigente:null, eFirmaExpiry:null, lastAuditDate:null, alertLevel:'safe' },
  };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return { ...DEF, ...p, metrics:{...DEF.metrics,...(p.metrics||{})}, settings:{...DEF.settings,...(p.settings||{})}, saludFiscal:{...DEF.saludFiscal,...(p.saludFiscal||{})} };
      }
    } catch(_) {}
    return JSON.parse(JSON.stringify(DEF));
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(_){} }
  let state = load();

  function emit(ev, data) { (EVT[ev]||[]).forEach(fn => fn(data)); }
  function on(ev, fn) { if (!EVT[ev]) EVT[ev]=[]; EVT[ev].push(fn); }

  function recalc() {
    state.metrics.totalProcessed = state.conversations.length;
    Object.keys(DEF.metrics.byCategory).forEach(k => state.metrics.byCategory[k] = 0);
    state.conversations.forEach(c => {
      if (state.metrics.byCategory[c.intent] !== undefined) state.metrics.byCategory[c.intent]++;
    });
    if (state.conversations.length) {
      state.metrics.avgConfidence = Math.round(
        state.conversations.reduce((a,c)=>a+(c.confidence||0),0)/state.conversations.length*100
      );
    }
  }

  // ------------------------------------------
  // SUPABASE — cliente desde APP_STATE
  // ------------------------------------------
  async function initSupabase() {
    const client = window.APP_STATE?.supabase;
    if (!client) { console.warn('[Store] APP_STATE.supabase ausente — modo localStorage'); return false; }
    db = client;
    try {
      const { data, error } = await db.auth.getUser();
      if (error || !data?.user) { console.warn('[Store] Sin sesión — localStorage activo'); return false; }
      user = data.user;
      console.log(`%c[Store] ✅ Auth: ${user.email}`, 'color:#10b981;font-weight:bold');
      subscribeRealtime();
      await syncDown();
      return true;
    } catch(e) { console.error('[Store]', e.message); return false; }
  }

  function subscribeRealtime() {
    if (!db || !user) return;
    try {
      db.channel(`user_${user.id}`)
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'conversations', filter:`user_id=eq.${user.id}` }, p => {
          if (p.new) { state.conversations.unshift(mapRow(p.new)); recalc(); save(); emit('conversation:added', p.new); emit('metrics:updated', state.metrics); }
        })
        .subscribe();
    } catch(e) { console.warn('[Store] Realtime:', e.message); }
  }

  function mapRow(r) {
    return { id:r.id, text:r.text, sender:r.sender||'Usuario', time:r.time||'', intent:r.intent, confidence:r.confidence||0, keywords:r.keywords||[], explanation:r.explanation||'', response:r.response||'', source:r.source||'supabase', timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now() };
  }

  async function syncDown() {
    if (!db || !user) return;
    try {
      const [{ data:convs }, { data:met }] = await Promise.all([
        db.from('conversations').select('*').eq('user_id', user.id).order('created_at',{ascending:false}).limit(200),
        db.from('fiscal_metrics').select('income_ytd').eq('user_id', user.id).maybeSingle(),
      ]);
      if (convs) { state.conversations = convs.map(mapRow); recalc(); save(); emit('metrics:updated', state.metrics); }
      if (met?.income_ytd !== undefined) { state.incomeYTD = met.income_ytd; save(); emit('income:updated', state.incomeYTD); }
    } catch(e) { console.warn('[Store] syncDown:', e.message); }
  }

  async function upsertConv(c) {
    if (!db || !user) return;
    try {
      await db.from('conversations').upsert({
        id:c.id, user_id:user.id, text:c.text, sender:c.sender, time:c.time,
        intent:c.intent, confidence:c.confidence, keywords:c.keywords||[], explanation:c.explanation||'',
        response:c.response||'', source:c.source||'local',
        created_at: c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString(),
      }, { onConflict:'id' });
    } catch(e) { console.warn('[Store] upsert:', e.message); }
  }

  async function upsertMetrics() {
    if (!db || !user) return;
    try {
      await db.from('fiscal_metrics').upsert({
        user_id:user.id, income_ytd:state.incomeYTD,
        total_processed:state.metrics.totalProcessed, by_category:state.metrics.byCategory,
        avg_confidence: state.metrics.avgConfidence/100,
        updated_at: new Date().toISOString(),
      }, { onConflict:'user_id' });
    } catch(e) { console.warn('[Store] upsertMetrics:', e.message); }
  }

  function addConversation(c) {
    state.conversations.unshift(c);
    if (state.conversations.length > 200) state.conversations.pop();
    recalc(); save();
    emit('conversation:added', c); emit('metrics:updated', state.metrics);
    upsertConv(c); upsertMetrics();
  }

  function updateIncome(v) { state.incomeYTD = v; save(); emit('income:updated', v); upsertMetrics(); }
  function updateSetting(k, v) { state.settings[k]=v; save(); emit('settings:changed',{key:k,value:v}); }
  function updateSaludFiscal(d) {
    Object.assign(state.saludFiscal, d, { lastAuditDate: new Date().toISOString() });
    state.saludFiscal.alertLevel = (!state.saludFiscal.eFirmaVigente || !state.saludFiscal.buzonTributarioActivo) ? 'critical' : 'safe';
    save(); emit('saludFiscal:updated', state.saludFiscal);
  }

  async function saveDocument(doc) {
    state.documents.unshift(doc);
    if (state.documents.length > 100) state.documents.pop();
    save(); emit('document:added', doc);
    if (!db || !user) return;
    try {
      await db.from('documents').insert({
        user_id:user.id, file_name:doc.fileName, doc_type:doc.type,
        extracted_data:doc.data, confidence:doc.confidence,
        needs_review:doc.needsHumanReview||false,
      });
    } catch(e) { console.warn('[Store] saveDocument:', e.message); }
  }

  function getState()        { return state; }
  function getMetrics()      { return state.metrics; }
  function getConversations(){ return state.conversations; }
  function getSettings()     { return state.settings; }
  function getDocuments()    { return state.documents; }
  function getSaludFiscal()  { return state.saludFiscal; }
  function reset() { Object.assign(state, JSON.parse(JSON.stringify(DEF))); save(); emit('store:reset'); }

  return { on, getState, getMetrics, getConversations, getSettings, getDocuments, getSaludFiscal, addConversation, updateSetting, updateIncome, updateSaludFiscal, saveDocument, initSupabase, reset };
})();
if (typeof window !== 'undefined') window.Store = Store;