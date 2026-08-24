const Dashboard = (() => {
  function syncAndRender() {
    const state = window.Store?.getState?.() || {};
    const income = Number(state.incomeYTD || 0);
    const limit = window.RESICO_CONFIG?.INCOME_LIMIT || 3500000;
    const remaining = Math.max(0, limit - income);
    const pct = limit > 0 ? (income / limit) * 100 : 0;

    // KPIs
    document.getElementById('kpi-total').textContent = state.metrics?.totalProcessed || 0;
    document.getElementById('kpi-confidence').textContent = `${state.metrics?.avgConfidence || 0}%`;

    // Monitor
    const fill = document.getElementById('income-progress-fill');
    const badge = document.getElementById('income-alert-badge');
    const color = pct < 80 ? '#10b981' : pct < 94 ? '#f59e0b' : '#ef4444';
    if (fill) fill.style.width = `${Math.min(pct,100)}%`;
    if (fill) fill.style.background = color;
    document.getElementById('income-current').textContent = `$${income.toLocaleString('es-MX')} MXN`;
    document.getElementById('income-remaining').textContent = `$${remaining.toLocaleString('es-MX')} MXN`;
    document.getElementById('projection-val').textContent = income > 0 ? `$${Math.round(income / (new Date().getMonth()+1) * 12).toLocaleString('es-MX')} MXN/año estimado` : '--';
    if (badge) {
      if (pct < 80) { badge.textContent = 'SEGURO'; badge.className = 'badge-safe'; }
      else if (pct < 94) { badge.textContent = 'PREVENTIVO'; badge.className = 'badge-warning'; }
      else { badge.textContent = 'RIESGO EXPULSIÓN'; badge.className = 'badge-danger'; }
    }
    const alertMsg = document.getElementById('income-alert-message');
    if (alertMsg) {
      if (pct >= 94) alertMsg.innerHTML = '<span style="color:#ef4444;">⚠️ Has superado el 94% del límite. Riesgo inminente de expulsión.</span>';
      else if (pct >= 80) alertMsg.innerHTML = '<span style="color:#f59e0b;">⚠️ Alerta preventiva: estás en el 80% del límite.</span>';
      else alertMsg.innerHTML = '<span style="color:#10b981;">✅ Ingresos dentro del límite RESICO.</span>';
    }

    // Salud fiscal (simulado)
    const buzon = document.getElementById('buzon-status');
    if (buzon) {
      const active = state.saludFiscal?.buzonTributarioActivo ?? false;
      buzon.textContent = active ? '✅ Activo' : '❌ Inactivo';
      buzon.style.color = active ? '#10b981' : '#ef4444';
    }
    const efirma = document.getElementById('efirma-status');
    if (efirma) {
      const vigente = state.saludFiscal?.eFirmaVigente ?? false;
      efirma.textContent = vigente ? '✅ Vigente' : '❌ Vencida';
      efirma.style.color = vigente ? '#10b981' : '#ef4444';
    }
      // FIX FASE 0.9: Opinión de Cumplimiento basada en estado real
  const opinion = document.getElementById('opinion-status');
  if (opinion) {
    const opinionLoaded = state.carpetaFiscal?.opinionStatus === 'cargada';
    const opinionPositive = state.saludFiscal?.opinionCumplimientoPositiva === true;
    if (opinionLoaded && opinionPositive) {
      opinion.textContent = '✅ Positiva';
      opinion.style.color = '#10b981';
    } else if (opinionLoaded) {
      opinion.textContent = '📄 Cargada — Verificar vigencia';
      opinion.style.color = '#f59e0b';
    } else {
      opinion.textContent = '⚠️ No consultada';
      opinion.style.color = '#94a3b8';
    }
  }

    // Feed de actividad
      // Feed de actividad — FIX FASE 1.6: Blindaje XSS con escapeHTML
    const feed = document.getElementById('feed-list');
    const convs = state.conversations || [];
    if (!feed) return;
    if (convs.length === 0) {
      feed.innerHTML = '<p class="feed-empty" style="color:#94a3b8;">Sin actividad.</p>';
    } else {
      feed.innerHTML = convs.slice(0, 5).map(c => {
        const rawText = String(c.text || c.message_text || '...');
        // Escape robusto contra XSS
        const safeText = rawText
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
          .substring(0, 60);
        const safeDate = new Date(c.timestamp || c.created_at || Date.now()).toLocaleDateString('es-MX');
        return `<div style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between;">
          <span style="color:#e2e8f0;">${safeText}${rawText.length > 60 ? '…' : ''}</span>
          <span style="color:#64748b; font-size:12px; flex-shrink:0; margin-left:8px;">${safeDate}</span>
        </div>`;
      }).join('');
    }
  }

  function init() {
    syncAndRender();
  }

  return { init, syncAndRender };
})();
window.Dashboard = Dashboard;