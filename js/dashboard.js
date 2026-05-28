/* ════════════════════════════════════════════════
   ALIADO RESICO — Dashboard v6.4 FINAL
   Fix: columnas exactas fiscal_metrics (sin by_category, sin updated_at)
   Fix: semáforo $2.8M / $3.15M / $3.3M / $3.5M
   Fix: Art. 17-K CFF mensaje completo
   Fix: logout con cache-busting
   ════════════════════════════════════════════════ */
const Dashboard = (() => {
  // Umbrales Art. 113-E LISR
  const L = {
    MAX: 3_500_000,   // Expulsión
    A94: 3_300_000,   // 🔴 Crítico  94%
    A90: 3_150_000,   // 🟠 Alto     90%
    A80: 2_800_000,   // ⚠️ Alerta   80%
  };
  const fmt = n => n.toLocaleString('es-MX');

  // ── SEMÁFORO ─────────────────────────────────
  function _level(income) {
    const pct = (income / L.MAX) * 100;
    if (income >= L.MAX) return {
      cls:'expelled', pct:100, badge:'❌ EXPULSADO',
      msg:`<strong>LÍMITE REBASADO — $${fmt(income)} MXN.</strong> Expulsión automática al Régimen General (Art. 113-E, fracc. III LISR). Tu ISR sube hasta 35%.`,
      ref:'Art. 113-E, fracc. III, LISR 2024',
    };
    if (income >= L.A94) return {
      cls:'critical', pct, badge:`🔴 CRÍTICO ${pct.toFixed(1)}%`,
      msg:`<strong>ALERTA ROJA — $${fmt(income)} MXN (${pct.toFixed(1)}% del límite).</strong> Margen restante: $${fmt(L.MAX-income)} MXN. Riesgo inminente de expulsión. Suspende operaciones facturadas este ejercicio.`,
      ref:'Art. 113-E, fracc. III, LISR 2024',
    };
    if (income >= L.A90) return {
      cls:'high', pct, badge:`🟠 RIESGO ${pct.toFixed(1)}%`,
      msg:`<strong>ALERTA NARANJA — $${fmt(income)} MXN (${pct.toFixed(1)}% del límite).</strong> Margen: $${fmt(L.MAX-income)} MXN. Revisa tu proyección anual con tu contador.`,
      ref:'Art. 113-E, fracc. III, LISR 2024',
    };
    if (income >= L.A80) return {
      cls:'warning', pct, badge:`⚠️ ALERTA ${pct.toFixed(1)}%`,
      msg:`<strong>ALERTA AMARILLA — $${fmt(income)} MXN (${pct.toFixed(1)}% del límite).</strong> Quedan $${fmt(L.MAX-income)} MXN de margen anual. Monitorea tus ingresos mensualmente.`,
      ref:'Art. 113-E, fracc. III, LISR 2024',
    };
    return {
      cls:'safe', pct, badge:'✅ SEGURO',
      msg:`Ingresos dentro del límite RESICO. Margen disponible: <strong>$${fmt(L.MAX-income)} MXN</strong>.`,
      ref:'Art. 113-E, fracc. III, LISR 2024',
    };
  }

  // ── RENDER INCOME ─────────────────────────────
  function renderIncomeMonitor(income = 0) {
    const fill  = document.getElementById('income-progress-fill');
    const badge = document.getElementById('income-alert-badge');
    const msg   = document.getElementById('income-alert-message');
    const curr  = document.getElementById('income-current');
    const rem   = document.getElementById('income-remaining');
    const proj  = document.getElementById('projection-val');
    if (!fill) return;

    const a = _level(income);
    fill.style.width  = Math.min(a.pct, 100) + '%';
    fill.className    = `progress-fill ${a.cls}`;
    fill.setAttribute('aria-valuenow', Math.round(a.pct));

    if (badge) { badge.className = `alert-badge ${a.cls}`; badge.textContent = a.badge; }
    if (curr)  curr.textContent  = `$${fmt(income)} MXN`;
    if (rem)   { rem.textContent = `$${fmt(Math.max(0, L.MAX-income))} MXN`; rem.className = `metric-val ${a.cls==='safe'?'safe':a.cls==='warning'?'warning':''}`.trim(); }
    if (msg)   { msg.className = `income-alert ${a.cls}`; msg.innerHTML = a.msg + `<span class="alert-ref">${a.ref}</span>`; }

    // Proyección anual basada en mes actual
    if (proj && income > 0) {
      const mes = new Date().getMonth() + 1;
      if (mes >= 2) {
        const proyeccion = Math.round((income / mes) * 12);
        const pCls = proyeccion >= L.MAX ? 'danger' : proyeccion >= L.A80 ? 'warning' : 'safe';
        proj.textContent  = `$${fmt(proyeccion)} MXN/año estimado`;
        proj.className    = `projection-val ${pCls}`;
      } else {
        proj.textContent = 'Disponible desde febrero';
        proj.className   = 'projection-val safe';
      }
    } else if (proj) {
      proj.textContent = 'Captura ingresos para proyectar';
      proj.className   = 'projection-val safe';
    }
  }

  // ── SALUD FISCAL — Art. 17-K & 86-C CFF ──────
  function renderHealth(buzon, efirma) {
    const bEl = document.getElementById('buzon-status');
    const eEl = document.getElementById('efirma-status');
    const dEl = document.getElementById('declaraciones-status');
    const box = document.getElementById('health-alert');
    const mEl = document.getElementById('health-alert-msg');
    const rEl = document.getElementById('health-alert-ref');

    if (bEl) {
      bEl.textContent = buzon ? '✅ Activo' : '❌ Inactivo';
      bEl.className = `status-pill ${buzon ? 'ok' : 'error'}`;
    }
    if (eEl) {
      eEl.textContent = efirma ? '✅ Vigente' : '⚠️ Revisar';
      eEl.className = `status-pill ${efirma ? 'ok' : 'warning'}`;
    }
    if (dEl) {
      dEl.textContent = '✅ Al corriente';
      dEl.className = 'status-pill ok';
    }

    if (!buzon && box) {
      box.classList.remove('hidden');
      if (mEl) mEl.innerHTML =
        '⚠️ <strong>Atención: Multa de $10,260 MXN</strong> por Buzón Tributario inactivo (Art. 17-K CFF). ' +
        'En caso de reincidencia la multa se duplica (Art. 86-C CFF). ' +
        'Activa tu buzón en <strong>sat.gob.mx</strong> hoy mismo.';
      if (rEl) rEl.textContent = 'Art. 17-K CFF — Obligación de medios electrónicos | Art. 86-C CFF — Reincidencia';
    } else if (box) {
      box.classList.add('hidden');
    }
  }

  // ── KPIs ─────────────────────────────────────
  function renderKPIs(m = {}) {
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s('kpi-total',         m.totalProcessed      || 0);
    s('kpi-auto-rate',    (m.autoResolutionRate   || 0) + '%');
    s('kpi-confidence',   (m.avgConfidence        || 0) + '%');
    s('kpi-response-time',(m.avgResponseTime      || 2.3).toFixed(1) + 's');
  }

  // ── FEED ─────────────────────────────────────
  function renderFeed(items = []) {
    const list = document.getElementById('feed-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p class="feed-empty">Sin actividad. Envía una consulta al Asistente IA.</p>';
      return;
    }
    const CFG = window.CATEGORY_CONFIG || {};
    list.innerHTML = items.map(c => {
      const cat = CFG[c.intent] || { icon:'💬', label: c.intent || 'General' };
      const ts  = c.created_at
        ? new Date(c.created_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})
        : (c.time || '');
      const txt = (c.text||'').slice(0,90) + ((c.text?.length||0)>90?'…':'');
      return `<div class="feed-item">
        <span class="feed-icon">${cat.icon}</span>
        <div class="feed-body">
          <span class="feed-text">${txt}</span>
          <span class="feed-meta">${cat.label} · ${Math.round((c.confidence||0)*100)}% · ${ts}</span>
        </div>
      </div>`;
    }).join('');
  }

  // ── SYNC — columnas exactas de Supabase ──────
  // Tabla fiscal_metrics: income_ytd, total_processed, avg_confidence
  // NO incluye: by_category, updated_at (causan error 400 si no existen)
  async function syncAndRender() {
    // 1. Render inmediato desde Store local (cero latencia)
    if (window.Store) {
      renderKPIs(Store.getMetrics());
      renderIncomeMonitor(Store.getState().incomeYTD || 0);
      const sf = Store.getSaludFiscal();
      renderHealth(sf.buzonTributarioActivo !== false, sf.eFirmaVigente !== false);
      renderFeed(Store.getConversations().slice(0,10));
    }

    const client = window.APP_STATE?.supabase;
    if (!client) return;

    try {
      const { data: auth, error: authErr } = await client.auth.getUser();
      if (authErr || !auth?.user?.id) return;
      const uid = auth.user.id;

      // Columnas exactas — sin by_category ni updated_at
      const [metRes, convsRes] = await Promise.all([
        client.from('fiscal_metrics')
          .select('income_ytd,total_processed,avg_confidence')
          .eq('user_id', uid)
          .maybeSingle(),
        client.from('conversations')
          .select('id,text,intent,confidence,created_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      if (metRes.error) {
        console.warn('[Dashboard] fiscal_metrics:', metRes.error.message);
      } else if (metRes.data) {
        const met = metRes.data;
        renderIncomeMonitor(Number(met.income_ytd) || 0);
        renderKPIs({
          totalProcessed:    Number(met.total_processed) || 0,
          avgConfidence:     Math.round((Number(met.avg_confidence) || 0) * 100),
          autoResolutionRate: 0,
          avgResponseTime:   2.3,
        });
        Store?.updateIncome?.(Number(met.income_ytd) || 0);
      }

      if (convsRes.error) {
        console.warn('[Dashboard] conversations:', convsRes.error.message);
      } else if (convsRes.data) {
        renderFeed(convsRes.data);
      }

    } catch(err) {
      console.warn('[Dashboard] sync error:', err.message);
    }
  }

  function render() { return syncAndRender(); }

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

  return { init, syncAndRender, render, renderIncomeMonitor, renderHealth, renderKPIs, LIMITS: L };
})();
if (typeof window !== 'undefined') window.Dashboard = Dashboard;
