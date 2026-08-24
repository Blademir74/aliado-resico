/* ============================================
ALIADO RESICO — Dashboard v2.0 (FIX C.1-C.4)
Opinión de Cumplimiento dinámica + XSS blindado
+ Proyección correcta + UX empática mexicana
Art. 113-E LISR · Art. 32-D CFF · Art. 17-K CFF
============================================ */
const Dashboard = (() => {

  // ── FIX C.2: Escape HTML robusto (reutiliza InputSanitizer si existe) ──
  function safeEscape(str) {
    if (window.InputSanitizer?.escapeHTML) return window.InputSanitizer.escapeHTML(String(str || ''));
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
  }

  function syncAndRender() {
    const state = window.Store?.getState?.() || {};
    const income = Number(state.incomeYTD || 0);
    const limit = window.RESICO_CONFIG?.INCOME_LIMIT || 3500000;
    const remaining = Math.max(0, limit - income);
    const pct = limit > 0 ? (income / limit) * 100 : 0;

    // ── KPIs ─────────────────────────────────────────────────────────────
    const kpiTotal = document.getElementById('kpi-total');
    const kpiConf = document.getElementById('kpi-confidence');
    if (kpiTotal) kpiTotal.textContent = state.metrics?.totalProcessed || 0;
    if (kpiConf) kpiConf.textContent = `${state.metrics?.avgConfidence || 0}%`;

    // ── Monitor de Ingresos (Art. 113-E LISR) ───────────────────────────
    const fill = document.getElementById('income-progress-fill');
    const badge = document.getElementById('income-alert-badge');
    const color = pct < 80 ? '#10b981' : pct < 94 ? '#f59e0b' : '#ef4444';

    if (fill) {
      fill.style.width = `${Math.min(pct, 100)}%`;
      fill.style.background = color;
    }

    const incomeCurrent = document.getElementById('income-current');
    const incomeRemaining = document.getElementById('income-remaining');
    const projectionVal = document.getElementById('projection-val');

    if (incomeCurrent) incomeCurrent.textContent = `$${income.toLocaleString('es-MX')} MXN`;
    if (incomeRemaining) incomeRemaining.textContent = `$${remaining.toLocaleString('es-MX')} MXN`;

    // ── FIX C.3: Proyección anual correcta ──────────────────────────────
    // Solo proyectar si hay al menos 2 meses de datos Y el usuario empezó en enero
    const currentMonth = new Date().getMonth() + 1;
    if (projectionVal) {
      if (income > 0 && currentMonth >= 2) {
        const projected = Math.round((income / currentMonth) * 12);
        const projectedPct = (projected / limit) * 100;
        let projColor = '#10b981';
        let projLabel = '';
        if (projectedPct >= 94) {
          projColor = '#ef4444';
          projLabel = ' ⚠️ Riesgo de expulsión';
        } else if (projectedPct >= 80) {
          projColor = '#f59e0b';
          projLabel = ' ⚠️ Zona preventiva';
        }
        projectionVal.innerHTML = `<span style="color:${projColor};font-weight:700;">$${projected.toLocaleString('es-MX')} MXN/año</span><span style="font-size:12px;color:${projColor};">${projLabel}</span>`;
      } else {
        projectionVal.textContent = '--';
      }
    }

    // ── Badge de riesgo ─────────────────────────────────────────────────
    if (badge) {
      if (pct >= 100) {
        badge.textContent = '🚨 EXCEDIDO';
        badge.className = 'badge-danger';
        badge.style.animation = 'pulse-badge 1s ease infinite';
      } else if (pct >= 94) {
        badge.textContent = 'RIESGO EXPULSIÓN';
        badge.className = 'badge-danger';
        badge.style.animation = 'pulse-badge 1.5s ease infinite';
      } else if (pct >= 80) {
        badge.textContent = 'PREVENTIVO';
        badge.className = 'badge-warning';
        badge.style.animation = '';
      } else {
        badge.textContent = 'SEGURO';
        badge.className = 'badge-safe';
        badge.style.animation = '';
      }
    }

    const alertMsg = document.getElementById('income-alert-message');
    if (alertMsg) {
      if (pct >= 100) {
        alertMsg.innerHTML = `<span style="color:#ef4444;font-weight:600;">🚨 Has excedido el límite de $3,500,000 MXN. El SAT iniciará tu migración a Actividad Empresarial (Art. 113-E LISR). Contacta a tu contador HOY.</span>`;
      } else if (pct >= 94) {
        alertMsg.innerHTML = `<span style="color:#ef4444;">⚠️ Has superado el 94% del límite. Riesgo inminente de expulsión. Te quedan $${remaining.toLocaleString('es-MX')} MXN de margen.</span>`;
      } else if (pct >= 80) {
        alertMsg.innerHTML = `<span style="color:#f59e0b;">⚠️ Alerta preventiva: estás en el ${pct.toFixed(0)}% del límite. Te quedan $${remaining.toLocaleString('es-MX')} MXN antes de la zona de riesgo.</span>`;
      } else if (income > 0) {
        alertMsg.innerHTML = `<span style="color:#10b981;">✅ Vas bien. Llevas el ${pct.toFixed(0)}% del límite anual. Te quedan $${remaining.toLocaleString('es-MX')} MXN de margen seguro.</span>`;
      } else {
        alertMsg.innerHTML = `<span style="color:#94a3b8;">👋 Bienvenido. Cuando registres tu primera factura, aquí verás tu avance contra el límite de $3,500,000 MXN.</span>`;
      }
    }

    // ── Salud Fiscal (Art. 17-K y 17-D CFF) ─────────────────────────────
    const buzon = document.getElementById('buzon-status');
    if (buzon) {
      const active = state.saludFiscal?.buzonTributarioActivo ?? null;
      if (active === true) {
        buzon.textContent = '✅ Activo';
        buzon.style.color = '#10b981';
      } else if (active === false) {
        buzon.textContent = '❌ Inactivo — Multa $10,260';
        buzon.style.color = '#ef4444';
      } else {
        buzon.textContent = '⏳ Sin verificar';
        buzon.style.color = '#f59e0b';
      }
    }

    const efirma = document.getElementById('efirma-status');
    if (efirma) {
      const vigente = state.saludFiscal?.eFirmaVigente ?? null;
      if (vigente === true) {
        efirma.textContent = '✅ Vigente';
        efirma.style.color = '#10b981';
      } else if (vigente === false) {
        efirma.textContent = '❌ Vencida — Renovar SAT';
        efirma.style.color = '#ef4444';
      } else {
        efirma.textContent = '⏳ Sin verificar';
        efirma.style.color = '#f59e0b';
      }
    }

    // ── FIX C.1: Opinión de Cumplimiento DINÁMICA (Art. 32-D CFF) ───────
    const opinion = document.getElementById('opinion-status');
    if (opinion) {
      const carpeta = window.Store?.getCarpetaFiscal?.();
      const opinionLoaded = carpeta?.opinionStatus === 'cargada';
      const alertLevel = state.saludFiscal?.alertLevel;

      if (opinionLoaded) {
        opinion.textContent = '📄 Cargada';
        opinion.style.color = '#10b981';
      } else if (alertLevel === 'danger') {
        opinion.textContent = '🔴 Revisar urgente';
        opinion.style.color = '#ef4444';
      } else if (alertLevel === 'warning') {
        opinion.textContent = '🟡 Pendiente';
        opinion.style.color = '#f59e0b';
      } else {
        opinion.textContent = '⏳ No consultada';
        opinion.style.color = '#94a3b8';
      }
    }

    // ── FIX C.2: Feed de actividad CON ESCAPE XSS ───────────────────────
    const feed = document.getElementById('feed-list');
    const convs = state.conversations || [];
    if (feed) {
      if (convs.length === 0) {
        feed.innerHTML = `
          <p class="feed-empty" style="color:#94a3b8;">
            Sin actividad aún. Escribe tu primera consulta en el Asistente IA
            y aquí verás tu historial fiscal. 🛡️
          </p>`;
      } else {
        feed.innerHTML = convs.slice(0, 5).map(c => {
          const rawText = String(c.text || c.message_text || '...');
          const safeText = safeEscape(rawText).substring(0, 60);
          const truncated = rawText.length > 60 ? '…' : '';
          const safeDate = new Date(c.timestamp || Date.now()).toLocaleDateString('es-MX', {
            day: 'numeric',
            month: 'short'
          });
          const intentLabel = getIntentLabel(c.intent);
          return `<div style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="color:#e2e8f0;flex:1;">${safeText}${truncated}</span>
            <span style="color:#64748b; font-size:12px; flex-shrink:0;">${intentLabel} · ${safeDate}</span>
          </div>`;
        }).join('');
      }
    }
  }

  // ── FIX C.4: Labels empáticos para el usuario mexicano ────────────────
  function getIntentLabel(intent) {
    const labels = {
      'CONSULTA_FISCAL': '📘 Fiscal',
      'SOLICITUD_FACTURA': '📑 Factura',
      'REGISTRO_GASTO': '🧾 Gasto',
      'REPORTE_PAGO': '💳 Pago',
      'SALUD_FISCAL': '🏥 Salud',
      'OTROS': '💬 General'
    };
    return labels[intent] || '💬 General';
  }

  function init() {
    syncAndRender();
  }

  return { init, syncAndRender };
})();
window.Dashboard = Dashboard;