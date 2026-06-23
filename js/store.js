/* ============================================
   ALIADO RESICO — Store v5.5
   Fix: load/persist/emit/on implementados
   Fix: exposición window.Store garantizada
   ============================================ */
const Store = (() => {
  const KEY = 'aliado_resico_v5';
  const EVT = {};
  let db = null, usr = null;

  const DEF = {
    conversations: [],
    metrics: {
      totalProcessed: 0,
      byCategory: {
        CONSULTA_FISCAL: 0, SOLICITUD_FACTURA: 0,
        REGISTRO_GASTO: 0, REPORTE_PAGO: 0,
        SALUD_FISCAL: 0, OTROS: 0,
      },
      avgConfidence: 0,
      autoResolutionRate: 0,
      avgResponseTime: 2.3,
    },
    incomeYTD: 0,
    settings: { autoReply: true, incomeAlert: true, sound: false },
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

  /* ── Persistencia local ── */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(DEF));
      return Object.assign(JSON.parse(JSON.stringify(DEF)), JSON.parse(raw));
    } catch {
      return JSON.parse(JSON.stringify(DEF));
    }
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* cuota llena */ }
  }

  let state = load();

  /* ── Eventos internos ── */
  function emit(ev, data) {
    (EVT[ev] || []).forEach(fn => { try { fn(data); } catch { /* silencioso */ } });
  }

  function on(ev, fn) {
    if (!EVT[ev]) EVT[ev] = [];
    EVT[ev].push(fn);
  }

  /* ── Recálculo de métricas ── */
  function recalc() {
    state.metrics.totalProcessed = state.conversations.length;
    Object.keys(DEF.metrics.byCategory).forEach(k => (state.metrics.byCategory[k] = 0));
    state.conversations.forEach(c => {
      if (c.intent in state.metrics.byCategory) state.metrics.byCategory[c.intent]++;
    });
    if (state.conversations.length) {
      state.metrics.avgConfidence = Math.round(
        state.conversations.reduce((a, c) => a + (c.confidence || 0), 0)
        / state.conversations.length * 100
      );
    }
  }

  /* ── Mapeo BD → frontend ── */
  function _mapRow(r) {
    return {
      id: r.id,
      text: r.message_text,
      sender: r.sender || 'Usuario',
      time: r.time || '',
      intent: r.intent,
      confidence: r.confidence || 0,
      keywords: r.keywords || [],
      explanation: r.explanation || '',
      response: r.response || '',
      source: r.source || 'supabase',
      timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      is_fiscal_audit_completed: r.is_fiscal_audit_completed || false,
    };
  }

  /* ── Supabase: sincronización bajada ── */
  async function _syncDown() {
    if (!db) return;
    // Resolver usuario activo (puede no estar en `usr` tras recarga)
    if (!usr?.id) await _syncUser();
    const uid = usr?.id || _resolveUserId();
    if (!uid) return;
    try {
      const [{ data: convs }, { data: met }] = await Promise.all([
        db.from('conversations')
          .select('*')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(200),
        db.from('fiscal_metrics')
          .select('income_ytd,total_processed,avg_confidence')
          .eq('user_id', uid)
          .maybeSingle(),
      ]);
      if (convs) { state.conversations = convs.map(_mapRow); recalc(); persist(); emit('metrics:updated', state.metrics); }
      if (met?.income_ytd !== undefined) { state.incomeYTD = met.income_ytd; persist(); emit('income:updated', state.incomeYTD); }
    } catch (e) { console.warn('[Store] syncDown:', e.message); }
  }

  /* ── Resolución robusta del user_id ──
     El RLS exige auth.uid() = user_id en cada INSERT/UPDATE.
     Si la variable interna `usr` no se seteó (login tardío, recarga de
     pestaña con sesión persistente, etc.), resolvemos el UID desde
     otras fuentes antes de abortar la escritura. */
  function _resolveUserId() {
    if (usr?.id) return usr.id;
    if (window.AuthManager?.getUserId) {
      const uid = window.AuthManager.getUserId();
      if (uid) return uid;
    }
    if (window.APP_STATE?.currentUser?.id) return window.APP_STATE.currentUser.id;
    return null;
  }

  // Sincronización síncrona del usuario activo hacia `usr`.
  // Se llama desde initSupabase y antes de cada upsert defensivamente.
  async function _syncUser() {
    if (usr?.id) return usr;
    const client = window.APP_STATE?.supabase;
    if (!client?.auth?.getUser) return null;
    try {
      const { data: { user } } = await client.auth.getUser();
      if (user) { usr = user; }
    } catch (_) { /* sesión inexistente — se maneja abajo */ }
    return usr;
  }

  /* ── Supabase: upsert conversación ── */
  async function _upsertConv(c) {
    if (!db) return;
    // Garantizar user_id: clave para que el RLS permita la escritura
    let uid = usr?.id || _resolveUserId();
    if (!uid) { await _syncUser(); uid = usr?.id || _resolveUserId(); }
    if (!uid) { console.warn('[Store] upsertConv omitido: sin user_id (RLS lo bloquearía)'); return; }
    try {
      await db.from('conversations').upsert({
        id: c.id,
        user_id: uid,
        message_text: c.text,           // columna correcta — nunca "text"
        sender: c.sender,
        time: c.time,
        intent: c.intent,
        confidence: c.confidence,
        keywords: c.keywords || [],
        explanation: c.explanation || '',
        response: c.response || '',
        source: c.source || 'local',
        is_fiscal_audit_completed: c.is_fiscal_audit_completed || false,
        created_at: c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (e) { console.warn('[Store] upsertConv:', e.message); }
  }

  /* ── Supabase: upsert métricas ── */
  async function _upsertMetrics() {
    if (!db) return;
    let uid = usr?.id || _resolveUserId();
    if (!uid) { await _syncUser(); uid = usr?.id || _resolveUserId(); }
    if (!uid) return;
    try {
      await db.from('fiscal_metrics').upsert({
        user_id: uid,
        income_ytd: state.incomeYTD,
        total_processed: state.metrics.totalProcessed,
        avg_confidence: state.metrics.avgConfidence / 100,
      }, { onConflict: 'user_id' });
    } catch (e) { console.warn('[Store] upsertMetrics:', e.message); }
  }

  /* ── Supabase: suscripción realtime ── */
  function _subscribeRealtime() {
    if (!db) return;
    const uid = usr?.id || _resolveUserId();
    if (!uid) return;
    db.channel('conversations_rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: `user_id=eq.${uid}` },
        () => _syncDown())
      .subscribe();
  }

  /* ── Init Supabase ── */
  async function initSupabase() {
    try {
      const cfg = window.SUPABASE_CONFIG || window.AppConfig?.supabase;
      if (!cfg?.url || !cfg?.anonKey) return;
      if (!window.supabase?.createClient) return;
      db = window.supabase.createClient(cfg.url, cfg.anonKey);
      const { data: { user } } = await db.auth.getUser();
      if (user) { usr = user; await _syncDown(); _subscribeRealtime(); }
    } catch (e) { console.warn('[Store] initSupabase:', e.message); }
  }

  /* ── API pública ── */
  function getState()         { return state; }
  function getMetrics()       { return state.metrics; }
  function getConversations() { return state.conversations; }
  function getSettings()      { return state.settings; }
  function getDocuments()     { return state.documents; }
  function getSaludFiscal()   { return state.saludFiscal; }
  function getCarpetaFiscal() { return state.carpetaFiscal; }

  function addConversation(c) {
    if (c.is_fiscal_audit_completed === undefined) c.is_fiscal_audit_completed = false;
    state.conversations.unshift(c);
    if (state.conversations.length > 200) state.conversations.pop();
    recalc(); persist();
    emit('conversation:added', c);
    emit('metrics:updated', state.metrics);
    _upsertConv(c);
    _upsertMetrics();
  }

  function updateSetting(key, val) {
    state.settings[key] = val;
    persist();
    emit('settings:updated', state.settings);
  }

  function updateIncome(amount) {
    state.incomeYTD = amount;
    persist();
    emit('income:updated', state.incomeYTD);
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

  async function updateCarpetaFiscal(data) {
    state.carpetaFiscal = { ...state.carpetaFiscal, ...data, lastUpdated: new Date().toISOString() };
    persist();
    emit('carpeta:updated', state.carpetaFiscal);
  }

  function setEfirmaExpiry(dateISO)      { updateCarpetaFiscal({ efirmaExpiry: dateISO }); }
  function setConstanciaStatus(status)   { updateCarpetaFiscal({ constanciaStatus: status }); }
  function setOpinionStatus(status)      { updateCarpetaFiscal({ opinionStatus: status }); }

  function reset() {
    state = JSON.parse(JSON.stringify(DEF));
    persist();
    emit('store:reset', null);
  }

  return {
    on, getState, getMetrics, getConversations, getSettings,
    getDocuments, getSaludFiscal, getCarpetaFiscal,
    addConversation, updateSetting, updateIncome,
    updateSaludFiscal, saveDocument, updateCarpetaFiscal,
    setEfirmaExpiry, setConstanciaStatus, setOpinionStatus,
    initSupabase, reset,
  };
})();

/* Exposición global garantizada — sin guarda condicional adicional */
window.Store = Store;