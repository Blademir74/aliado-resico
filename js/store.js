/* ============================================
   ALIADO RESICO — Reactive State Manager
   Supabase Realtime + localStorage Fallback
   v3.0 — e.firma Tracking, Sanitización
   ============================================ */

const Store = (() => {
  const STORAGE_KEY = 'aliado_resico_state';

  const listeners = {};
  let supabaseClient = null;
  let realtimeChannel = null;

  const defaultState = {
    conversations: [],
    metrics: {
      totalProcessed: 0,
      byCategory: { CONSULTA_FISCAL: 0, SOLICITUD_FACTURA: 0, REGISTRO_GASTO: 0, REPORTE_PAGO: 0, OTROS: 0 },
      avgConfidence: 0,
      autoResolutionRate: 82,
      avgResponseTime: 2.3,
    },
    incomeYTD: 1875000,
    settings: {
      autoReply: true,
      incomeAlert: true,
      sound: false,
    },
    documents: [],
    saludFiscal: {
      buzonTributarioActivo: null, // null = unknown, true/false
      eFirmaVigente: null,
      eFirmaExpiry: null,          // ISO date string — Art. 17-D CFF (4 años)
      lastAuditDate: null,
    },
  };

  // =============================================
  // LOCAL STORAGE (always available)
  // =============================================
  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...defaultState,
          ...parsed,
          metrics: { ...defaultState.metrics, ...(parsed.metrics || {}) },
          settings: { ...defaultState.settings, ...(parsed.settings || {}) },
          saludFiscal: { ...defaultState.saludFiscal, ...(parsed.saludFiscal || {}) },
        };
      }
    } catch (e) { console.warn('Store: failed to load from localStorage', e); }
    return { ...defaultState };
  }

  function saveLocal(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn('Store: failed to save to localStorage', e); }
  }

  const state = loadLocal();

  // =============================================
  // SUPABASE CONNECTION
  // =============================================
  function initSupabase() {
    const url = AppConfig.getSupabaseUrl();
    const key = AppConfig.getSupabaseKey();

    if (!url || !key || typeof window.supabase === 'undefined') {
      console.log('%c[Store] Supabase not available — using localStorage only', 'color:#64748b');
      return false;
    }

    try {
      supabaseClient = window.supabase.createClient(url, key);
      console.log('%c[Store] ✅ Supabase connected', 'color:#10b981;font-weight:bold');

      // Subscribe to realtime changes
      subscribeToRealtime();
      // Sync existing data to Supabase
      syncToSupabase();
      // Load fiscal metrics
      loadFiscalMetricsFromSupabase();
      return true;
    } catch (e) {
      console.warn('[Store] Supabase init failed:', e.message);
      supabaseClient = null;
      return false;
    }
  }

  function getSupabase() { return supabaseClient; }

  // --- Realtime subscriptions ---
  function subscribeToRealtime() {
    if (!supabaseClient) return;

    try {
      realtimeChannel = supabaseClient
        .channel('aliado_changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, (payload) => {
          console.log('[Store] Realtime: new conversation', payload.new.id);
          // Only add if not already in local state (avoids duplicates from our own writes)
          const exists = state.conversations.some(c => c.id === payload.new.id);
          if (!exists) {
            const conv = mapSupabaseConversation(payload.new);
            state.conversations.unshift(conv);
            recalcMetrics();
            saveLocal(state);
            emit('conversation:added', conv);
            emit('metrics:updated', state.metrics);
          }
        })
        .subscribe((status) => {
          console.log(`%c[Store] Realtime status: ${status}`, status === 'SUBSCRIBED' ? 'color:#10b981' : 'color:#f59e0b');
        });
    } catch (e) {
      console.warn('[Store] Realtime subscription failed:', e.message);
    }
  }

  function mapSupabaseConversation(row) {
    return {
      id: row.id,
      text: row.text,
      sender: row.sender || 'Usuario',
      time: row.time || new Date(row.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      intent: row.intent,
      confidence: row.confidence,
      keywords: row.keywords || [],
      explanation: row.explanation || '',
      response: row.response || '',
      timestamp: new Date(row.created_at).getTime(),
      source: row.source || 'unknown',
    };
  }

  // --- Sync local data to Supabase (background) ---
  async function syncToSupabase() {
    if (!supabaseClient) return;

    // Load conversations from Supabase
    try {
      const { data, error } = await supabaseClient
        .from('conversations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        console.warn('[Store] Supabase load error:', error.message);
        return;
      }

      if (data && data.length > 0) {
        // Merge: Supabase data takes priority for existing IDs
        const supabaseMap = new Map(data.map(row => [row.id, mapSupabaseConversation(row)]));
        const localOnly = state.conversations.filter(c => !supabaseMap.has(c.id));

        // Upload local-only conversations to Supabase
        for (const conv of localOnly) {
          upsertConversation(conv).catch(() => {});
        }

        // Merge all
        state.conversations = [...supabaseMap.values(), ...localOnly]
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, 200);

        recalcMetrics();
        saveLocal(state);
        emit('metrics:updated', state.metrics);
        console.log(`%c[Store] Synced ${data.length} conversations from Supabase`, 'color:#10b981');
      }
    } catch (e) {
      console.warn('[Store] Sync error:', e.message);
    }
  }

  // --- Upsert conversation to Supabase ---
  async function upsertConversation(conv) {
    if (!supabaseClient) return;

    try {
      const { error } = await supabaseClient.from('conversations').upsert({
        id: conv.id,
        text: conv.text,
        sender: conv.sender || 'Usuario',
        time: conv.time,
        intent: conv.intent,
        confidence: conv.confidence,
        keywords: conv.keywords || [],
        explanation: conv.explanation || '',
        response: conv.response || '',
        source: conv.source || 'local',
        created_at: conv.timestamp ? new Date(conv.timestamp).toISOString() : new Date().toISOString(),
      }, { onConflict: 'id' });

      if (error) console.warn('[Store] Upsert error:', error.message);
    } catch (e) {
      console.warn('[Store] Upsert failed:', e.message);
    }
  }

  // --- Save document to Supabase ---
  async function saveDocument(doc) {
    state.documents.unshift(doc);
    if (state.documents.length > 100) state.documents.pop();
    saveLocal(state);
    emit('document:added', doc);

    if (!supabaseClient) return;

    try {
      await supabaseClient.from('documents').insert({
        file_name: doc.fileName,
        doc_type: doc.type,
        extracted_data: doc.data,
        confidence: doc.confidence,
        validation_status: doc.status,
        needs_review: doc.needsHumanReview || false,
        source: doc.source || 'unknown',
      });
    } catch (e) {
      console.warn('[Store] Document save error:', e.message);
    }
  }

  // --- Update fiscal metrics in Supabase ---
  async function syncMetricsToSupabase() {
    if (!supabaseClient) return;

    try {
      await supabaseClient.from('fiscal_metrics').upsert({
        id: 'primary',
        income_ytd: state.incomeYTD,
        total_processed: state.metrics.totalProcessed,
        by_category: state.metrics.byCategory,
        avg_confidence: state.metrics.avgConfidence,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    } catch (e) {
      console.warn('[Store] Metrics sync error:', e.message);
    }
  }

  // --- Load fiscal metrics from Supabase ---
  async function loadFiscalMetricsFromSupabase() {
    if (!supabaseClient) return;
    try {
      const { data, error } = await supabaseClient
        .from('fiscal_metrics')
        .select('income_ytd')
        .eq('id', 'primary')
        .single();

      if (!error && data && data.income_ytd !== undefined) {
        updateIncome(data.income_ytd);
        console.log('%c[Store] Loaded fiscal metrics from Supabase', 'color:#10b981');
      }
    } catch (e) {
      console.warn('[Store] loadFiscalMetricsFromSupabase error:', e.message);
    }
  }

  // =============================================
  // REACTIVE STATE MANAGEMENT
  // =============================================
  function emit(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  }

  function on(event, fn) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(fn);
  }

  function addConversation(conv) {
    state.conversations.unshift(conv);
    if (state.conversations.length > 200) state.conversations.pop();
    state.metrics.totalProcessed++;
    state.metrics.byCategory[conv.intent] = (state.metrics.byCategory[conv.intent] || 0) + 1;
    recalcConfidence();
    saveLocal(state);
    emit('conversation:added', conv);
    emit('metrics:updated', state.metrics);

    // Fire-and-forget to Supabase
    upsertConversation(conv);
    syncMetricsToSupabase();
  }

  function recalcConfidence() {
    if (state.conversations.length === 0) { state.metrics.avgConfidence = 0; return; }
    const sum = state.conversations.reduce((a, c) => a + (c.confidence || 0), 0);
    state.metrics.avgConfidence = Math.round((sum / state.conversations.length) * 100);
  }

  function recalcMetrics() {
    state.metrics.totalProcessed = state.conversations.length;
    state.metrics.byCategory = { CONSULTA_FISCAL: 0, SOLICITUD_FACTURA: 0, REGISTRO_GASTO: 0, REPORTE_PAGO: 0, OTROS: 0 };
    state.conversations.forEach(c => {
      state.metrics.byCategory[c.intent] = (state.metrics.byCategory[c.intent] || 0) + 1;
    });
    recalcConfidence();
  }

  function getState() { return state; }
  function getMetrics() { return state.metrics; }
  function getConversations() { return state.conversations; }
  function getSettings() { return state.settings; }
  function getDocuments() { return state.documents; }
  function getSaludFiscal() { return state.saludFiscal; }

  function updateSetting(key, value) {
    state.settings[key] = value;
    saveLocal(state);
    emit('settings:changed', { key, value });
  }

  function updateIncome(amount) {
    state.incomeYTD = amount;
    saveLocal(state);
    emit('income:updated', amount);
    syncMetricsToSupabase();
  }

  function updateSaludFiscal(data) {
    Object.assign(state.saludFiscal, data, { lastAuditDate: new Date().toISOString() });
    saveLocal(state);
    emit('saludFiscal:updated', state.saludFiscal);
  }

  // --- e.firma Expiry Check (Art. 17-D CFF — vigencia 4 años) ---
  function checkEFirmaExpiry() {
    const expiry = state.saludFiscal.eFirmaExpiry;
    if (!expiry) return { status: 'unknown', message: 'No se ha registrado fecha de vencimiento de e.firma.' };

    const expiryDate = new Date(expiry);
    const now = new Date();
    const daysUntil = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

    if (daysUntil < 0) {
      return {
        status: 'expired',
        daysUntil,
        message: `🚨 Tu e.firma VENCIÓ hace ${Math.abs(daysUntil)} días (Art. 17-D CFF). NO puedes facturar ni presentar declaraciones. Renueva de inmediato en el portal del SAT.`,
      };
    } else if (daysUntil <= 30) {
      return {
        status: 'expiring_soon',
        daysUntil,
        message: `⚠️ Tu e.firma vence en ${daysUntil} días (${expiryDate.toLocaleDateString('es-MX')}). Programa tu renovación antes de que expire para evitar interrupciones.`,
      };
    } else if (daysUntil <= 90) {
      return {
        status: 'expiring',
        daysUntil,
        message: `📅 Tu e.firma vence el ${expiryDate.toLocaleDateString('es-MX')} (${daysUntil} días). Considera programar tu renovación.`,
      };
    }

    return {
      status: 'valid',
      daysUntil,
      message: `✅ e.firma vigente hasta ${expiryDate.toLocaleDateString('es-MX')} (${daysUntil} días restantes).`,
    };
  }

  function setEFirmaExpiry(dateString) {
    state.saludFiscal.eFirmaExpiry = dateString;
    state.saludFiscal.eFirmaVigente = new Date(dateString) > new Date();
    saveLocal(state);
    emit('saludFiscal:updated', state.saludFiscal);
  }

  function reset() {
    Object.assign(state, JSON.parse(JSON.stringify(defaultState)));
    state.conversations = [];
    state.documents = [];
    state.metrics.totalProcessed = 0;
    state.metrics.byCategory = { CONSULTA_FISCAL: 0, SOLICITUD_FACTURA: 0, REGISTRO_GASTO: 0, REPORTE_PAGO: 0, OTROS: 0 };
    state.metrics.avgConfidence = 0;
    saveLocal(state);
    emit('store:reset');
  }

  function seedDemoData() {
    reset();
    const msgs = window.MOCK_MESSAGES || [];
    msgs.forEach((m, i) => {
      state.conversations.push({
        id: `demo-${i}`,
        text: m.text,
        sender: m.sender,
        time: m.time,
        intent: m.expected,
        confidence: 0.78 + Math.random() * 0.2,
        keywords: [],
        timestamp: Date.now() - (msgs.length - i) * 300000,
        source: 'demo',
      });
      state.metrics.totalProcessed++;
      state.metrics.byCategory[m.expected] = (state.metrics.byCategory[m.expected] || 0) + 1;
    });
    recalcConfidence();
    saveLocal(state);
    emit('store:seeded');
    emit('metrics:updated', state.metrics);
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `aliado_resico_export_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return {
    on, getState, getMetrics, getConversations, getSettings, getDocuments, getSaludFiscal,
    addConversation, updateSetting, updateIncome, updateSaludFiscal,
    checkEFirmaExpiry, setEFirmaExpiry,
    reset, seedDemoData, exportJSON,
    initSupabase, getSupabase, saveDocument,
    syncMetricsToSupabase,
  };
})();

if (typeof window !== 'undefined') window.Store = Store;
