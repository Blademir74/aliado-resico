/* ============================================
   ALIADO RESICO — Dashboard v3.0
   Monitor Art. 113-E LISR + Salud Fiscal CFF
   Bug fix: #income-alert-container → IDs reales
   Bug fix: supabase client desde APP_STATE
   Bug fix: try-catch en toda llamada async
   ============================================ */
const Dashboard = (() => {

  const LIMITS = {
    MAX: 3_500_000,
    A80: 2_800_000,
    A90: 3_150_000,
    A94: 3_300_000,
  };

  // =============================================
  // LÓGICA DE ALERTAS — Art. 113-E LISR
  // =============================================
  function getAlertLevel(income) {
    const pct = (income / LIMITS.MAX) * 100;
    if (income >= LIMITS.MAX) return {
      level: 'expelled', pct: 100,
      badge: '❌ EXPULSADO',
      msg: `<strong>LÍMITE REBASADO ($${income.toLocaleString('es-MX')} MXN).</strong>
        Expulsión automática al Régimen General. Tasas de hasta 35%.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    if (income >= LIMITS.A94) return {
      level: 'critical', pct,
      badge: `🔴 CRÍTICO ${pct.toFixed(1)}%`,
      msg: `<strong>ALERTA ROJA — $${income.toLocaleString('es-MX')} MXN (${pct.toFixed(1)}%).</strong>
        Margen restante: $${(LIMITS.MAX - income).toLocaleString('es-MX')} MXN.
        Detén operaciones facturadas hasta el cierre del ejercicio.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    if (income >= LIMITS.A90) return {
      level: 'high', pct,
      badge: `🟠 RIESGO ${pct.toFixed(1)}%`,
      msg: `<strong>ALERTA NARANJA — $${income.toLocaleString('es-MX')} MXN (${pct.toFixed(1)}%).</strong>
        Margen restante: $${(LIMITS.MAX - income).toLocaleString('es-MX')} MXN.
        Consulta con tu contador la proyección de ingresos del trimestre.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    if (income >= LIMITS.A80) return {
      level: 'warning', pct,
      badge: `⚠️ ALERTA ${pct.toFixed(1)}%`,
      msg: `<strong>ALERTA AMARILLA — $${income.toLocaleString('es-MX')} MXN (${pct.toFixed(1)}%).</strong>
        Quedan $${(LIMITS.MAX - income).toLocaleString('es-MX')} MXN de margen anual.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    return {
      level: 'safe', pct,
      badge: '✅ SEGURO',
      msg: `Ingresos dentro del límite RESICO. Margen:
        <strong>$${(LIMITS.MAX - income).toLocaleString('es-MX')} MXN</strong>.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
  }

  // =============================================
  // RENDER — escribe en los IDs reales del DOM
  // (NO usa #income-alert-container que no existe)
  // =============================================
  function renderIncomeMonitor(income) {
    const fill  = document.getElementById('income-progress-fill');
    const badge = document.getElementById('income-alert-badge');
    const msg   = document.getElementById('income-alert-message');
    const curr  = document.getElementById('income-current');
    const rem   = document.getElementById('income-remaining');
    if (!fill) return; // DOM no listo aún

    const a   = getAlertLevel(income);
    const pct = Math.min(a.pct, 100);

    fill.style.width = pct + '%';
    fill.className   = `progress-fill ${a.level}`;

    if (badge) { badge.className = `alert-badge ${a.level}`; badge.textContent = a.badge; }
    if (curr)  curr.textContent  = '$' + income.toLocaleString('es-MX') + ' MXN';
    if (rem)   rem.textContent   = '$' + Math.max(0, LIMITS.MAX - income).toLocaleString('es-MX') + ' MXN';
    if (msg) {
      msg.className = `alert-message ${a.level}`;
      msg.innerHTML = a.msg + `<span class="alert-ref">${a.ref}</span>`;
    }
  }

  // =============================================
  // SALUD FISCAL — Art. 17-K y 86-C CFF
  // $10,260 MXN multa base | $20,520 reincidencia
  // =============================================
  function renderHealthPanel(buzonActive, efirmaActive) {
    const buzonStatus  = document.getElementById('buzon-status');
    const efirmaStatus = document.getElementById('efirma-status');
    const alertBox     = document.getElementById('health-alert');
    const alertMsg     = document.getElementById('health-alert-msg');
    const alertRef     = document.getElementById('health-alert-ref');

    if (buzonStatus) {
      buzonStatus.textContent = buzonActive ? '✅ Activo' : '❌ Inactivo';
      buzonStatus.className   = 'status ' + (buzonActive ? 'ok' : 'error');
    }
    if (efirmaStatus) {
      efirmaStatus.textContent = efirmaActive ? '✅ Vigente' : '⚠️ Revisar';
      efirmaStatus.className   = 'status ' + (efirmaActive ? 'ok' : 'warning');
    }

    if (!buzonActive && alertBox) {
      alertBox.classList.remove('hidden');
      if (alertMsg) alertMsg.textContent =
        'Buzón tributario inactivo. Multa inmediata: $10,260 MXN. ' +
        'Por reincidencia la multa asciende a $20,520 MXN.';
      if (alertRef) alertRef.textContent =
        'Art. 17-K CFF (obligación de medios electrónicos) | Art. 86-C CFF (reincidencia)';
    } else if (alertBox) {
      alertBox.classList.add('hidden');
    }
  }

  // =============================================
  // KPIs — usa datos de Store (sin Supabase directo)
  // =============================================
  function renderKPIs(metrics) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('kpi-total',         metrics.totalProcessed ?? 0);
    set('kpi-auto-rate',     (metrics.autoResolutionRate ?? 0) + '%');
    set('kpi-confidence',    (metrics.avgConfidence ?? 0) + '%');
    set('kpi-response-time', (metrics.avgResponseTime ?? 0) + 's');
  }

  // =============================================
  // SYNC — obtiene el cliente de APP_STATE
  // Bug fix: NO usa window.supabase directamente
  // =============================================
  async function syncAndRender() {
    // 1. Renderizar KPIs desde Store local (inmediato, sin red)
    if (window.Store) {
      renderKPIs(Store.getMetrics());
      renderIncomeMonitor(Store.getState().incomeYTD || 0);
      const sf = Store.getSaludFiscal();
      renderHealthPanel(sf.buzonTributarioActivo ?? true, sf.eFirmaVigente ?? true);
    }

    // 2. Intentar sincronizar con Supabase si el cliente está listo
    const client = window.APP_STATE?.supabase;
    if (!client) {
      console.warn('[Dashboard] Cliente Supabase no disponible — usando datos locales');
      return;
    }

    try {
      const { data: authData, error: authErr } = await client.auth.getUser();
      if (authErr || !authData?.user) {
        console.warn('[Dashboard] Sin sesión de usuario — datos locales activos');
        return;
      }

      const userId = authData.user.id;

      // Métricas fiscales
      const { data: metrics, error: metricsErr } = await client
        .from('fiscal_metrics')
        .select('income_ytd, total_processed, avg_confidence, by_category, updated_at')
        .eq('user_id', userId)
        .maybeSingle(); // maybeSingle no lanza si no encuentra fila

      if (!metricsErr && metrics) {
        renderIncomeMonitor(metrics.income_ytd || 0);
        renderKPIs({
          totalProcessed:    metrics.total_processed    || 0,
          avgConfidence:     Math.round((metrics.avg_confidence || 0) * 100),
          autoResolutionRate: 0,
          avgResponseTime:   2.3,
        });
        if (window.Store) Store.updateIncome(metrics.income_ytd || 0);
      }

      // Actividad reciente
      const { data: convs } = await client
        .from('conversations')
        .select('id, text, intent, confidence, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (convs) renderFeed(convs);

    } catch (err) {
      console.error('[Dashboard] Error en sync:', err.message);
      // No relanza — el fallback local ya renderizó
    }
  }

  // =============================================
  // FEED DE ACTIVIDAD
  // =============================================
  function renderFeed(items) {
    const list = document.getElementById('feed-list');
    if (!list) return;
    if (!items?.length) {
      list.innerHTML = '<p style="color:var(--text-muted);padding:1rem">Sin actividad reciente.</p>';
      return;
    }
    const CAT = window.CATEGORY_CONFIG || {};
    list.innerHTML = items.map(c => {
      const cat = CAT[c.intent] || { icon: '💬', label: c.intent };
      const ts  = c.created_at
        ? new Date(c.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
        : '';
      return `<div class="feed-item">
        <span class="feed-icon">${cat.icon}</span>
        <div class="feed-body">
          <span class="feed-text">${c.text?.slice(0, 80) ?? ''}${(c.text?.length > 80) ? '...' : ''}</span>
          <span class="feed-meta">${cat.label} · ${Math.round((c.confidence || 0) * 100)}% · ${ts}</span>
        </div>
      </div>`;
    }).join('');
  }

  // =============================================
  // INIT
  // =============================================
  function init() {
    // Render inmediato con datos locales
    renderIncomeMonitor(0);
    renderHealthPanel(true, true);

    // Suscribirse a eventos del Store
    if (window.Store) {
      Store.on('income:updated',    income  => renderIncomeMonitor(income));
      Store.on('metrics:updated',   metrics => renderKPIs(metrics));
      Store.on('saludFiscal:updated', sf    => renderHealthPanel(sf.buzonTributarioActivo, sf.eFirmaVigente));
    }
  }

  return {
    init,
    syncAndRender,
    renderIncomeMonitor,
    renderHealthPanel,
    renderKPIs,
    LIMITS,
  };
})();

if (typeof window !== 'undefined') window.Dashboard = Dashboard;