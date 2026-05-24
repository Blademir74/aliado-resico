/* ============================================
   ALIADO RESICO — Dashboard v5.0
   Fix: usa APP_STATE.supabase (cliente real)
   Fix: IDs correctos del DOM
   Fix: maybeSingle() — no lanza si fila ausente
   Fix: renderIncomeAlert → IDs reales del HTML
   ============================================ */
const Dashboard = (() => {
  const L = { MAX: 3_500_000, A80: 2_800_000, A90: 3_150_000, A94: 3_300_000 };

  // ------------------------------------------
  // ALERTAS — Art. 113-E LISR
  // ------------------------------------------
  function level(income) {
    const pct = (income / L.MAX) * 100;
    if (income >= L.MAX) return { cls:'expelled', pct:100,
      badge:'❌ EXPULSADO',
      msg:`<strong>LÍMITE REBASADO — $${fmt(income)} MXN.</strong> Expulsión automática a Régimen General. Tasas hasta 35%.`,
      ref:'Art. 113-E, fracc. III, LISR 2024' };
    if (income >= L.A94) return { cls:'critical', pct,
      badge:`🔴 CRÍTICO ${pct.toFixed(1)}%`,
      msg:`<strong>ALERTA ROJA — $${fmt(income)} MXN.</strong> Margen restante: $${fmt(L.MAX-income)} MXN. Detén operaciones facturadas.`,
      ref:'Art. 113-E, fracc. III, LISR 2024' };
    if (income >= L.A90) return { cls:'high', pct,
      badge:`🟠 RIESGO ${pct.toFixed(1)}%`,
      msg:`<strong>ALERTA NARANJA — $${fmt(income)} MXN.</strong> Margen: $${fmt(L.MAX-income)} MXN. Revisa proyección con contador.`,
      ref:'Art. 113-E, fracc. III, LISR 2024' };
    if (income >= L.A80) return { cls:'warning', pct,
      badge:`⚠️ ALERTA ${pct.toFixed(1)}%`,
      msg:`<strong>ALERTA AMARILLA — $${fmt(income)} MXN.</strong> Quedan $${fmt(L.MAX-income)} MXN de margen anual.`,
      ref:'Art. 113-E, fracc. III, LISR 2024' };
    return { cls:'safe', pct,
      badge:'✅ SEGURO',
      msg:`Ingresos dentro del límite. Margen disponible: <strong>$${fmt(L.MAX-income)} MXN</strong>.`,
      ref:'Art. 113-E, fracc. III, LISR 2024' };
  }

  function fmt(n) { return n.toLocaleString('es-MX'); }

  // ------------------------------------------
  // RENDER — escribe en IDs reales del HTML
  // (el div #income-alert-container no existe;
  //  los IDs reales son los de abajo)
  // ------------------------------------------
  function renderIncomeMonitor(income = 0) {
    const fill  = document.getElementById('income-progress-fill');
    const badge = document.getElementById('income-alert-badge');
    const msg   = document.getElementById('income-alert-message');
    const curr  = document.getElementById('income-current');
    const rem   = document.getElementById('income-remaining');
    if (!fill) return;

    const a = level(income);
    fill.style.width = Math.min(a.pct, 100) + '%';
    fill.className   = `progress-fill ${a.cls}`;
    if (badge) { badge.className = `alert-badge ${a.cls}`; badge.textContent = a.badge; }
    if (curr)  curr.textContent  = `$${fmt(income)} MXN`;
    if (rem)   rem.textContent   = `$${fmt(Math.max(0, L.MAX-income))} MXN`;
    if (msg) {
      msg.className = `alert-message ${a.cls}`;
      msg.innerHTML = a.msg + `<span class="alert-ref">${a.ref}</span>`;
    }
  }

  // ------------------------------------------
  // SALUD FISCAL — Art. 17-K y 86-C CFF
  // ------------------------------------------
  function renderHealth(buzon, efirma) {
    const bEl = document.getElementById('buzon-status');
    const eEl = document.getElementById('efirma-status');
    const box = document.getElementById('health-alert');
    const mEl = document.getElementById('health-alert-msg');
    const rEl = document.getElementById('health-alert-ref');

    if (bEl) { bEl.textContent = buzon  ? '✅ Activo'  : '❌ Inactivo'; bEl.className = 'status ' + (buzon  ? 'ok' : 'error'); }
    if (eEl) { eEl.textContent = efirma ? '✅ Vigente' : '⚠️ Revisar';  eEl.className = 'status ' + (efirma ? 'ok' : 'warning'); }

    if (!buzon && box) {
      box.classList.remove('hidden');
      if (mEl) mEl.textContent = 'Buzón tributario inactivo. Multa inmediata: $10,260 MXN. Por reincidencia: $20,520 MXN.';
      if (rEl) rEl.textContent = 'Art. 17-K CFF (medios electrónicos) | Art. 86-C CFF (reincidencia)';
    } else if (box) { box.classList.add('hidden'); }
  }

  // ------------------------------------------
  // KPIs
  // ------------------------------------------
  function renderKPIs(m = {}) {
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s('kpi-total',        m.totalProcessed    || 0);
    s('kpi-auto-rate',   (m.autoResolutionRate || 0) + '%');
    s('kpi-confidence',  (m.avgConfidence     || 0) + '%');
    s('kpi-response-time',(m.avgResponseTime  || 2.3).toFixed(1) + 's');
  }

  // ------------------------------------------
  // FEED
  // ------------------------------------------
  function renderFeed(items = []) {
    const list = document.getElementById('feed-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p style="color:var(--text-muted);padding:1rem 0">Sin actividad reciente.</p>';
      return;
    }
    const CFG = window.CATEGORY_CONFIG || {};
    list.innerHTML = items.map(c => {
      const cat = CFG[c.intent] || { icon:'💬', label: c.intent };
      const ts  = c.created_at
        ? new Date(c.created_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})
        : c.time || '';
      const txt = (c.text || '').slice(0, 90) + ((c.text?.length > 90) ? '…' : '');
      return `<div class="feed-item">
        <span class="feed-icon">${cat.icon}</span>
        <div class="feed-body">
          <span class="feed-text">${txt}</span>
          <span class="feed-meta">${cat.label} · ${Math.round((c.confidence||0)*100)}% · ${ts}</span>
        </div>
      </div>`;
    }).join('');
  }

  // ------------------------------------------
  // SYNC — cliente desde APP_STATE, no window.supabase
  // ------------------------------------------
  async function syncAndRender() {
    // 1. Render inmediato desde Store local
    if (window.Store) {
      renderKPIs(Store.getMetrics());
      renderIncomeMonitor(Store.getState().incomeYTD || 0);
      const sf = Store.getSaludFiscal();
      renderHealth(
        sf.buzonTributarioActivo !== false,
        sf.eFirmaVigente !== false
      );
      renderFeed(Store.getConversations().slice(0, 10));
    }

    // 2. Sync con Supabase si hay cliente y sesión
    const client = window.APP_STATE?.supabase;
    if (!client) return;

    try {
      const { data: auth } = await client.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return;

      const [{ data: met }, { data: convs }] = await Promise.all([
        client.from('fiscal_metrics')
          .select('income_ytd,total_processed,avg_confidence')
          .eq('user_id', uid).maybeSingle(),
        client.from('conversations')
          .select('id,text,intent,confidence,created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false }).limit(10),
      ]);

      if (met) {
        renderIncomeMonitor(met.income_ytd || 0);
        renderKPIs({
          totalProcessed:    met.total_processed    || 0,
          avgConfidence:     Math.round((met.avg_confidence || 0) * 100),
          autoResolutionRate: 0,
          avgResponseTime:   2.3,
        });
        Store?.updateIncome?.(met.income_ytd || 0);
      }
      if (convs) renderFeed(convs);

    } catch (err) {
      console.warn('[Dashboard] sync:', err.message);
    }
  }

  // ------------------------------------------
  // INIT
  // ------------------------------------------
  function init() {
    renderIncomeMonitor(0);
    renderHealth(true, true);

    if (window.Store) {
      Store.on('income:updated',      v  => renderIncomeMonitor(v));
      Store.on('metrics:updated',     m  => renderKPIs(m));
      Store.on('saludFiscal:updated', sf => renderHealth(sf.buzonTributarioActivo, sf.eFirmaVigente));
      Store.on('conversation:added',  () => renderFeed(Store.getConversations().slice(0,10)));
    }
  }

  return { init, syncAndRender, renderIncomeMonitor, renderHealth, renderKPIs, LIMITS: L };
})();
if (typeof window !== 'undefined') window.Dashboard = Dashboard;