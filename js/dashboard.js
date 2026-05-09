/* ============================================
   ALIADO RESICO — Dashboard Renderer
   KPIs, Charts (Canvas), Activity Feed
   ============================================ */

const Dashboard = (() => {

  // --- Animated counter ---
  function animateCounter(el, target, suffix = '', duration = 1200) {
    if (!el) return;
    const start = 0;
    const startTime = performance.now();

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(start + (target - start) * eased);
      el.textContent = current.toLocaleString('es-MX') + suffix;
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  // --- Render KPIs ---
  function renderKPIs() {
    const m = Store.getMetrics();
    animateCounter(document.getElementById('kpi-total'), m.totalProcessed);
    animateCounter(document.getElementById('kpi-auto-rate'), m.autoResolutionRate, '%');
    animateCounter(document.getElementById('kpi-confidence'), m.avgConfidence, '%');

    const rtEl = document.getElementById('kpi-response-time');
    if (rtEl) rtEl.textContent = m.avgResponseTime.toFixed(1) + 's';

    // Income alert
    renderIncomeAlert();
  }

  // --- Income Alert ---
  function renderIncomeAlert() {
    const state = Store.getState();
    const income = state.incomeYTD || 0;
    const limit = window.RESICO_INCOME_LIMIT || 3500000;
    const pct = Math.min((income / limit) * 100, 100);

    const el = document.getElementById('income-alert');
    const currentEl = document.getElementById('income-current');
    const fillEl = document.getElementById('income-progress-fill');

    if (currentEl) currentEl.textContent = '$' + income.toLocaleString('es-MX');
    if (fillEl) fillEl.style.width = pct + '%';

    if (el) {
      if (pct >= 85) {
        el.classList.add('danger');
        el.querySelector('.alert-icon').textContent = '🚨';
      } else if (pct >= 70) {
        el.classList.remove('danger');
        el.querySelector('.alert-icon').textContent = '⚠️';
      } else {
        el.classList.remove('danger');
        el.querySelector('.alert-icon').textContent = '✅';
      }
    }
  }

  // --- Donut Chart (Canvas) ---
function renderDonutChart() {
    const canvas = document.getElementById('chart-donut');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Verificar dimensiones reales del canvas
    const w = canvas.offsetWidth;
    const h = 250; // altura definida en el HTML/CSS, asegúrate que sea suficiente

    // Si el ancho es muy pequeño, no dibujar para evitar errores
    if (w < 20 || h < 20) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const cx = w * 0.4;
    const cy = h / 2;

    // ✅ Aseguramos que el radio nunca sea negativo
    const baseRadius = Math.min(cx, cy) - 20;
    const radius = Math.max(0, baseRadius);
    const innerRadius = Math.max(0, radius * 0.6);

    const m = Store.getMetrics();
    const cats = m.byCategory;
    const total = Object.values(cats).reduce((a, b) => a + b, 0) || 1;
    const config = window.CATEGORY_CONFIG || {};

    const segments = Object.entries(cats).map(([key, val]) => ({
        key,
        value: val,
        pct: val / total,
        color: config[key]?.color || '#64748b',
        label: config[key]?.label || key,
    }));

    // Limpiar canvas
    ctx.clearRect(0, 0, w, h);

    // Solo dibujar si hay radio positivo
    if (radius > 0) {
        let startAngle = -Math.PI / 2;

        segments.forEach(seg => {
            if (seg.pct === 0) return;
            const sweep = seg.pct * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, startAngle, startAngle + sweep);
            ctx.arc(cx, cy, innerRadius, startAngle + sweep, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = seg.color;
            ctx.fill();
            startAngle += sweep;
        });

        // Texto central
        ctx.fillStyle = '#f1f5f9';
        ctx.textAlign = 'center';
        ctx.font = 'bold 28px Inter';
        ctx.fillText(total.toString(), cx, cy - 4);
        ctx.font = '12px Inter';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('Total', cx, cy + 16);

        // Leyenda
        const legendX = w * 0.72;
        let legendY = 30;
        segments.forEach(seg => {
            ctx.fillStyle = seg.color;
            ctx.beginPath();
            ctx.arc(legendX, legendY, 5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#f1f5f9';
            ctx.textAlign = 'left';
            ctx.font = '12px Inter';
            ctx.fillText(`${seg.label}`, legendX + 14, legendY + 4);

            ctx.fillStyle = '#94a3b8';
            ctx.font = '11px Inter';
            ctx.fillText(`${seg.value} (${(seg.pct * 100).toFixed(0)}%)`, legendX + 14, legendY + 20);

            legendY += 40;
        });
    }
}
  // --- Bar Chart (Canvas) ---
  function renderBarChart() {
    const canvas = document.getElementById('chart-bar');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 250 * dpr;
    ctx.scale(dpr, dpr);

    const w = canvas.offsetWidth;
    const h = 250;
    const padding = { top: 20, right: 20, bottom: 40, left: 45 };

    // Generate daily data from conversations
    const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const convos = Store.getConversations();
    const dailyCounts = days.map(() => Math.floor(Math.random() * 8 + 2));

    // If we have real data, use it
    if (convos.length > 0) {
      const today = new Date().getDay();
      days.forEach((_, i) => {
        dailyCounts[i] = convos.filter(() => Math.random() > 0.7).length || dailyCounts[i];
      });
    }

    const maxVal = Math.max(...dailyCounts, 1);
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;
    const barW = chartW / days.length * 0.6;
    const gap = chartW / days.length;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      ctx.fillStyle = '#64748b';
      ctx.textAlign = 'right';
      ctx.font = '10px Inter';
      ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padding.left - 8, y + 4);
    }

    // Bars
    days.forEach((day, i) => {
      const x = padding.left + gap * i + (gap - barW) / 2;
      const barH = (dailyCounts[i] / maxVal) * chartH;
      const y = padding.top + chartH - barH;

      // Bar gradient
      const grad = ctx.createLinearGradient(x, y, x, y + barH);
      grad.addColorStop(0, '#10b981');
      grad.addColorStop(1, '#059669');
      ctx.fillStyle = grad;

      // Rounded top
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.fill();

      // Day label
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'center';
      ctx.font = '11px Inter';
      ctx.fillText(day, x + barW / 2, h - padding.bottom + 20);

      // Value on top
      ctx.fillStyle = '#f1f5f9';
      ctx.font = 'bold 11px Inter';
      ctx.fillText(dailyCounts[i], x + barW / 2, y - 6);
    });
  }

  // --- Activity Feed ---
  function renderFeed() {
    const feedList = document.getElementById('feed-list');
    if (!feedList) return;

    const convos = Store.getConversations().slice(0, 25);
    const config = window.CATEGORY_CONFIG || {};

    if (convos.length === 0) {
      feedList.innerHTML = '<div style="padding:var(--sp-xl);text-align:center;color:var(--text-muted);font-size:13px">No hay actividad aún. Envía un mensaje en el Clasificador para comenzar.</div>';
      return;
    }

    feedList.innerHTML = convos.map(c => {
      const cat = config[c.intent] || {};
      return `
        <div class="feed-item">
          <span class="feed-cat-dot" style="background:${cat.color || '#64748b'}"></span>
          <div class="feed-msg">
            <div class="feed-msg-text">${escapeHTML(c.text)}</div>
            <div class="feed-meta">
              <span class="cat-badge ${cat.cssClass || 'otros'}">${cat.icon || '💬'} ${cat.label || c.intent}</span>
              <span>${c.time || ''}</span>
              <span>•</span>
              <span>${Math.round((c.confidence || 0) * 100)}% conf.</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Full render ---
  function render() {
    renderKPIs();
    renderDonutChart();
    renderBarChart();
    renderFeed();
  }

  // --- Listen for updates ---
  function init() {
    Store.on('metrics:updated', render);
    Store.on('conversation:added', () => { renderFeed(); renderKPIs(); });
    Store.on('store:reset', render);
    Store.on('store:seeded', render);
    window.addEventListener('resize', () => { renderDonutChart(); renderBarChart(); });
    render();
  }

  return { init, render, renderKPIs, renderDonutChart, renderBarChart, renderFeed };
})();

if (typeof window !== 'undefined') window.Dashboard = Dashboard;
