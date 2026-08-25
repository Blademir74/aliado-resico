/* ════════════════════════════════════════════════════════════
ALIADO RESICO 2026 — app.js v7.0 (ROBUSTO)
Arquitectura: IIFE encapsulado, cero dependencias huérfanas.
Cumplimiento: Art. 113-E, 113-F LISR · Art. 17-K, 17-D CFF.
════════════════════════════════════════════════════════════ */
const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents', 'rfc-consult', 'invoicing', 'carpeta'];
  const RESICO_LIMIT = 3500000;
  const ALERT_80 = 2800000;
  const ALERT_90 = 3150000;
  const ALERT_94 = 3290000;
  const MIXTOS_LIMIT = 400000;
  const INTERESES_LIMIT = 100000;
  const BUZON_MULTA = 10260;
  const EFIRMA_YEARS = 4;
  const WIZARD_MAX_STEPS = 4;
  let booted = false;
  let wizardStep = 1;

  // ── Helpers ─────────────────────────────────────────────────
  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }
  function money(value) { return `$${Number(value || 0).toLocaleString('es-MX')} MXN`; }
  function getCfg(key, fallback) { return window.RESICO_CONFIG?.[key] ?? fallback; }

  // ── Navegación SPA ──────────────────────────────────────────
  function navigateTo(view) {
    const target = VIEWS.includes(view) ? view : 'dashboard';
    document.querySelectorAll('.tab-view').forEach(el => { el.hidden = true; });
    const targetEl = byId(`${target}-tab`);
    if (targetEl) targetEl.hidden = false;
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === target;
      btn.classList.toggle('active', isActive);
      btn.style.background = isActive ? 'rgba(16,185,129,0.2)' : 'transparent';
      btn.style.color = isActive ? '#e2e8f0' : '#94a3b8';
    });
    window.location.hash = target;
    if (target === 'documents') window.DocumentsManager?.renderDocuments?.();
    if (target === 'rfc-consult') window.RFCConsult?.render?.();
    if (target === 'invoicing') window.Invoicing?.renderProfiles?.();
    if (target === 'carpeta') renderCarpetaFiscal();
  }

  // ── Tema claro/oscuro (usa CLASE light-mode de styles.css) ──
  function applyTheme(mode) {
    document.body.classList.toggle('light-mode', mode === 'light');
    document.body.dataset.theme = mode;
    const cv = byId('webthreads-canvas');
    if (cv) cv.style.opacity = mode === 'light' ? '0.35' : '1';
  }
  function initTheme() {
    const btn = byId('theme-toggle');
    const saved = localStorage.getItem('ar_theme') || 'dark';
    applyTheme(saved);
    if (btn) btn.textContent = saved === 'light' ? '☀️' : '🌙';
    btn?.addEventListener('click', () => {
      const current = localStorage.getItem('ar_theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('ar_theme', next);
      applyTheme(next);
      btn.textContent = next === 'light' ? '☀️' : '🌙';
    });
  }

  function initNavigation() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-tab')));
    });
    const initial = (window.location.hash || '').replace('#', '');
    navigateTo(initial || 'dashboard');
  }

  // ── EFOS Watchlist ──────────────────────────────────────────
  function loadLocalEFOSList() {
    try {
      const local = JSON.parse(localStorage.getItem('ar_efos_watchlist_v1') || '[]');
      return Array.isArray(local) ? local : [];
    } catch { return []; }
  }
  function getEFOSWatchlist() {
    const cfg = Array.isArray(window.RESICO_CONFIG?.EFOS_RFC_LIST) ? window.RESICO_CONFIG.EFOS_RFC_LIST : [];
    const local = loadLocalEFOSList();
    const all = [...cfg, ...local].map(v => String(v || '').trim().toUpperCase()).filter(Boolean);
    return [...new Set(all)];
  }
  function classifyRFCDeep(rfc) {
    const clean = String(rfc || '').trim().toUpperCase();
    if (!clean) return { ok: false, message: 'Ingresa un RFC.' };
    const result = window.ValidatorRFC?.validate?.(clean);
    if (!result) return { ok: false, message: 'Validador de RFC no disponible.' };
    const efosSet = new Set(getEFOSWatchlist());
    const efos = efosSet.has(clean);
    if (!result.valid) return { ok: true, valid: false, message: 'RFC inválido.', detail: result.warning || 'Estructura incorrecta.' };
    const typeLabel = result.type === 'PF' ? 'PERSONA FÍSICA' : result.type === 'PM' ? 'PERSONA MORAL' : result.type === 'extranjero' ? 'GENÉRICO EXTRANJERO' : result.type === 'publico' ? 'GENÉRICO NACIONAL' : 'DESCONOCIDO';
    if (efos) return { ok: true, valid: true, type: typeLabel, efos: true, risk: 'danger', message: `RFC válido con alerta crítica: ${clean}`, detail: 'Coincide con watchlist EFOS. Revisión obligatoria.' };
    if (result.warning) return { ok: true, valid: true, type: typeLabel, efos: false, risk: 'warning', message: `RFC válido: ${clean}`, detail: result.warning };
    return { ok: true, valid: true, type: typeLabel, efos: false, risk: 'safe', message: `RFC válido: ${clean}`, detail: `Estructura ${typeLabel}. Sin coincidencia EFOS.` };
  }
  function renderRFCResult(result) {
    const out = byId('rfc-result');
    if (!out) return;
    if (!result.ok) {
      out.innerHTML = `<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);padding:12px;border-radius:12px;color:#fecaca;">
        <div style="font-weight:700;">${esc(result.message || 'RFC inválido')}</div>
        <div style="font-size:13px;margin-top:4px;">${esc(result.detail || '')}</div></div>`;
      return;
    }
    const tone = result.risk === 'danger'
      ? { bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.35)', tx: '#fecaca' }
      : result.risk === 'warning'
        ? { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.35)', tx: '#fde68a' }
        : { bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.35)', tx: '#d1fae5' };
    out.innerHTML = `<div style="background:${tone.bg};border:1px solid ${tone.bd};padding:12px;border-radius:12px;color:${tone.tx};">
      <div style="font-weight:700;">${esc(result.message)}</div>
      <div style="font-size:13px;margin-top:4px;">${esc(result.type || '')} · ${esc(result.detail || '')}</div>
      <div style="font-size:13px;margin-top:8px;">${result.efos ? 'Alerta EFOS detectada.' : 'Sin coincidencia EFOS.'}</div></div>`;
  }
  function initRFC() {
    const btn = byId('rfc-validate-btn');
    const inp = byId('rfc-input');
    if (!btn || !inp) return;
    const validate = () => renderRFCResult(classifyRFCDeep(inp.value));
    btn.addEventListener('click', validate);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); validate(); } });
  }

  // ── KPIs y Monitor ──────────────────────────────────────────
  function renderKPIs() {
    const metrics = window.Store?.getMetrics?.() || {};
    const setT = (id, v) => { const el = byId(id); if (el) el.textContent = v; };
    setT('kpi-total', Number(metrics.totalProcessed || 0));
    setT('kpi-confidence', `${Number(metrics.avgConfidence || 0)}%`);
    setT('kpi-auto-rate', `${Number(metrics.autoResolutionRate || 92)}%`);
    setT('kpi-response-time', `${Number(metrics.avgResponseTime || 2.3)}s`);
  }

  function calcRiskLevelWizard(income) {
    const v = Number(income || 0);
    if (v >= ALERT_94) return 'EXPULSION';
    if (v >= ALERT_90) return 'RIESGO_ALTO';
    if (v >= ALERT_80) return 'PREVENTIVO';
    return 'SEGURO';
  }

  function renderIncomeWithCssClasses() {
    const st = window.Store?.getState?.();
    if (!st) return;
    const current = Number(st.incomeYTD || 0);
    const limit = Number(st.fiscalMetrics?.annualLimit || getCfg('INCOME_LIMIT', RESICO_LIMIT));
    const risk = st.fiscalMetrics?.riskLevel || 'SEGURO';
    const ratio = limit > 0 ? Math.min(100, Math.max(0, (current / limit) * 100)) : 0;
    const fillEl = byId('income-progress-fill');
    const badgeEl = byId('income-alert-badge');
    const currentEl = byId('income-current');
    const limitEl = byId('income-limit');
    const remainingEl = byId('income-remaining');
    const projectionEl = byId('projection-val');
    const msgEl = byId('income-alert-message');
    if (currentEl) currentEl.textContent = money(current);
    if (limitEl) limitEl.textContent = money(limit);
    if (remainingEl) remainingEl.textContent = money(Math.max(0, limit - current));
    if (projectionEl) projectionEl.textContent = `${ratio.toFixed(1)}% del límite`;
    if (fillEl) {
      fillEl.style.width = `${ratio}%`;
      fillEl.classList.remove('risk-safe', 'risk-preventivo', 'risk-alto', 'risk-expulsion');
      const map = { SEGURO: 'risk-safe', PREVENTIVO: 'risk-preventivo', RIESGO_ALTO: 'risk-alto', EXPULSION: 'risk-expulsion' };
      fillEl.classList.add(map[risk] || 'risk-safe');
    }
    if (badgeEl) {
      badgeEl.textContent = risk.replace('_', ' ');
      badgeEl.classList.remove('badge-safe', 'badge-warning', 'badge-danger', 'badge-critical');
      if (risk === 'EXPULSION') badgeEl.classList.add('badge-critical');
      else if (risk === 'RIESGO_ALTO') badgeEl.classList.add('badge-danger');
      else if (risk === 'PREVENTIVO') badgeEl.classList.add('badge-warning');
      else badgeEl.classList.add('badge-safe');
    }
    if (msgEl) {
      const msgs = {
        EXPULSION: '<span style="color:#fecaca;">Riesgo crítico: estás en zona de expulsión.</span>',
        RIESGO_ALTO: '<span style="color:#fdba74;">Riesgo alto: revisa ingresos cobrados.</span>',
        PREVENTIVO: '<span style="color:#fde68a;">Alerta preventiva: superaste el 80%.</span>',
        SEGURO: '<span style="color:#86efac;">Sin riesgo actual.</span>'
      };
      msgEl.innerHTML = msgs[risk] || msgs.SEGURO;
    }
  }

  function computeDaysRemaining(dateStr) {
    if (!dateStr || dateStr === 'pendiente') return null;
    const today = new Date(); const target = new Date(dateStr);
    today.setHours(0,0,0,0); target.setHours(0,0,0,0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000*60*60*24));
  }

  function renderHealth() {
    const salud = window.Store?.getSaludFiscal?.() || {};
    const carpeta = window.Store?.getCarpetaFiscal?.() || {};
    const buzonStatus = byId('buzon-status');
    const efirmaStatus = byId('efirma-status');
    const efirmaDays = byId('efirma-days');
    const opinionStatus = byId('opinion-status');
    const healthAlert = byId('health-alert');
    const hasEFirmaDoc = (carpeta.summary?.efirma || 0) > 0;
    const hasOpinionDoc = carpeta.opinionStatus === 'cargada';
    const hasConstanciaDoc = carpeta.constanciaStatus === 'actualizada';
    const expiry = salud.eFirmaExpiry || carpeta.efirmaExpiry;
    const days = computeDaysRemaining(expiry);
    if (buzonStatus) {
      let t = 'Verificando...', c = '#f59e0b';
      if (salud.buzonTributarioActivo === true) { t = 'Activo'; c = '#10b981'; }
      else if (salud.buzonTributarioActivo === false) { t = 'Inactivo — Riesgo multa Art. 17-K CFF'; c = '#ef4444'; }
      else if (hasConstanciaDoc || hasOpinionDoc) { t = 'Con documentos fiscales cargados'; c = '#38bdf8'; }
      buzonStatus.textContent = t; buzonStatus.style.color = c;
    }
    if (efirmaStatus) {
      let t = 'Verificando...', c = '#f59e0b';
      if (salud.eFirmaVigente === true || (hasEFirmaDoc && days !== null && days > 0)) { t = 'VIGENTE'; c = '#10b981'; }
      else if (salud.eFirmaVigente === false || (days !== null && days <= 0)) { t = 'VENCIDA — Tramitar renovación SAT'; c = '#ef4444'; }
      else if (hasEFirmaDoc && days === null) { t = 'Cargada — Verificar fecha'; c = '#f59e0b'; }
      efirmaStatus.textContent = t; efirmaStatus.style.color = c;
    }
    if (efirmaDays) {
      if (typeof days === 'number' && hasEFirmaDoc) {
        efirmaDays.textContent = days > 0 ? `${days} día(s) restantes (Art. 17-D CFF)` : 'VENCIDA — Renueva en portal SAT';
        efirmaDays.style.color = days > 30 ? '#10b981' : days > 0 ? '#f59e0b' : '#ef4444';
      } else if (hasEFirmaDoc) { efirmaDays.textContent = 'Archivo cargado — fecha no detectada'; efirmaDays.style.color = '#f59e0b'; }
      else { efirmaDays.textContent = '-- días restantes'; efirmaDays.style.color = '#94a3b8'; }
    }
    if (opinionStatus) {
      const loaded = hasOpinionDoc;
      opinionStatus.textContent = loaded ? 'Cargada' : salud.alertLevel === 'danger' ? 'Revisar urgente' : 'No consultada';
      opinionStatus.style.color = loaded ? '#10b981' : salud.alertLevel === 'danger' ? '#ef4444' : '#94a3b8';
    }
    if (healthAlert) {
      const messages = [];
      if (salud.buzonTributarioActivo === false) messages.push(`Buzón Tributario inactivo: riesgo de multa de $${BUZON_MULTA.toLocaleString('es-MX')} MXN (Art. 17-K CFF).`);
      if (salud.eFirmaVigente === false || (days !== null && days <= 0)) messages.push('Tu e.firma está vencida. Renueva en el portal SAT (Art. 17-D CFF).');
      else if (typeof days === 'number' && days > 0 && days <= 30) messages.push(`Tu e.firma vence en ${days} día(s).`);
      healthAlert.hidden = messages.length === 0;
      if (messages.length) healthAlert.textContent = messages.join(' ');
    }
  }

  function addYears(date, years) {
    const next = new Date(date); next.setFullYear(next.getFullYear() + years); return next;
  }

  function computeEFirmaExpiryAlert(issuedDateStr) {
    if (!issuedDateStr) return { hasData: false, level: 'unknown', message: null, diasRestantes: null, expiryDate: null };
    const issued = new Date(issuedDateStr);
    if (Number.isNaN(issued.getTime())) return { hasData: false, level: 'unknown', message: null, diasRestantes: null, expiryDate: null };
    const expiryDate = addYears(issued, EFIRMA_YEARS);
    const today = new Date(); today.setHours(0,0,0,0); expiryDate.setHours(0,0,0,0);
    const diasRestantes = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000*60*60*24));
    let level = 'safe', message = null;
    if (diasRestantes <= 0) { level = 'expired'; message = `Tu e.firma venció hace ${Math.abs(diasRestantes)} días. Debes renovarla de inmediato (Art. 17-D CFF).`; }
    else if (diasRestantes <= 30) { level = 'critical'; message = `⚠️ ¡CRÍTICO! Su e.firma vence en menos de 30 días (${diasRestantes} días).`; }
    else if (diasRestantes <= 90) { level = 'warning'; message = `Su e.firma vence en 3 meses. Programe su cita en el SAT.`; }
    else { message = `e.firma vigente hasta ${expiryDate.toLocaleDateString('es-MX')} (${diasRestantes} días).`; }
    return { hasData: true, level, message, diasRestantes, expiryDate: expiryDate.toISOString().split('T')[0], issuedDate: issued.toISOString().split('T')[0] };
  }

  function renderEFirmaAlertBanner(alertData) {
    const container = byId('efirma-alert-banner') || (() => {
      const healthCard = byId('efirma-days')?.closest('.health-item')?.parentElement?.parentElement;
      if (!healthCard) return null;
      const div = document.createElement('div'); div.id = 'efirma-alert-banner'; div.hidden = true;
      healthCard.appendChild(div); return div;
    })();
    if (!container) return;
    if (!alertData.hasData) { container.hidden = true; return; }
    const styles = {
      safe: { bg: 'rgba(16,185,129,0.12)', border: '#10b981', color: '#d1fae5' },
      warning: { bg: 'rgba(245,158,11,0.14)', border: '#f59e0b', color: '#fde68a' },
      critical: { bg: 'rgba(239,68,68,0.16)', border: '#ef4444', color: '#fecaca' },
      expired: { bg: 'rgba(220,38,38,0.20)', border: '#dc2626', color: '#fecaca' }
    };
    const s = styles[alertData.level] || styles.safe;
    container.hidden = alertData.level === 'safe';
    container.style.background = s.bg; container.style.border = `1px solid ${s.border}`;
    container.style.color = s.color; container.style.padding = '12px 16px';
    container.style.borderRadius = '10px'; container.style.marginTop = '10px';
    container.style.fontWeight = alertData.level === 'critical' || alertData.level === 'expired' ? '700' : '500';
    container.textContent = alertData.message;
  }

  function renderBuzonAuditAlert() {
    const salud = window.Store?.getSaludFiscal?.();
    const container = byId('buzon-audit-alert') || (() => {
      const healthCard = byId('buzon-status')?.closest('.health-item')?.parentElement?.parentElement;
      if (!healthCard) return null;
      const div = document.createElement('div'); div.id = 'buzon-audit-alert'; div.hidden = true;
      healthCard.appendChild(div); return div;
    })();
    if (!container) return;
    const isValidado = salud?.buzonTributarioActivo === true;
    if (isValidado) { container.hidden = true; return; }
    container.hidden = false;
    container.style.background = 'rgba(239,68,68,0.16)'; container.style.border = '1px solid #ef4444';
    container.style.color = '#fecaca'; container.style.padding = '12px 16px';
    container.style.borderRadius = '10px'; container.style.marginTop = '10px';
    container.style.fontWeight = '700';
    container.textContent = `🔴 ALERTA PERMANENTE: Buzón Tributario no validado. Multa de hasta ${money(BUZON_MULTA)} conforme a los Art. 17-K y 86-C CFF.`;
  }

  function renderHealthExtended() {
    const carpeta = window.Store?.getCarpetaFiscal?.();
    const expiry = window.Store?.getSaludFiscal?.()?.eFirmaExpiry || carpeta?.efirmaExpiry;
    const efirmaAlert = computeEFirmaExpiryAlert(expiry && expiry !== 'pendiente' ? addYears(new Date(expiry), -EFIRMA_YEARS).toISOString() : null);
    renderEFirmaAlertBanner(efirmaAlert);
    renderBuzonAuditAlert();
  }

  function renderFeed() {
    const feed = byId('feed-list');
    if (!feed) return;
    const st = window.Store?.getState?.();
    if (!st) return;
    const conversations = st.conversations.slice(0, 4).map(item => ({
      at: item.timestamp || Date.now(), title: item.intent || 'OTROS',
      detail: item.message_text || item.text || 'Consulta'
    }));
    const documents = st.documents.slice(0, 4).map(item => ({
      at: new Date(item.created_at || Date.now()).getTime(),
      title: item.document_type || item.doc_type || 'OTRO',
      detail: item.file_name || 'Documento'
    }));
    const items = [...conversations, ...documents].sort((a, b) => b.at - a.at).slice(0, 6);
    if (!items.length) { feed.innerHTML = `<p class="feed-empty" style="color:#94a3b8;">Sin actividad.</p>`; return; }
    feed.innerHTML = items.map(item => `
      <div style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <strong style="color:#e2e8f0;">${esc(item.title)}</strong>
          <span style="color:#94a3b8;font-size:12px;">${new Date(item.at).toLocaleString('es-MX')}</span>
        </div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px;">${esc(String(item.detail).slice(0, 160))}</div>
      </div>`).join('');
  }

  const CATEGORY_LABELS = {
    ingresos: { label: '💰 Ingresos', color: '#10b981' },
    gastos_iva: { label: '🧾 Gastos (IVA)', color: '#3b82f6' },
    efirma: { label: '🔐 e.firma SAT', color: '#8b5cf6' },
    constancia: { label: '📄 Constancia Fiscal', color: '#f59e0b' },
    opinion: { label: '✅ Opinión de Cumplimiento', color: '#06b6d4' }
  };

  function renderCarpetaFiscal() {
    const container = byId('carpeta-fiscal-content');
    if (!container) return;
    const carpeta = window.Store?.getCarpetaFiscal?.();
    if (!carpeta) return;
    const currentMonthIdx = new Date().getMonth();
    const monthTabs = carpeta.monthlyFolders.map((folder, idx) => {
      const isActive = idx === (window.__carpetaActiveMonth ?? currentMonthIdx);
      return `<button class="carpeta-month-tab" data-month-idx="${idx}" style="padding:8px 14px;border-radius:6px;border:1px solid ${isActive ? '#10b981' : '#334155'}; background:${isActive ? 'rgba(16,185,129,0.15)' : 'transparent'}; color:${isActive ? '#10b981' : '#94a3b8'};cursor:pointer;font-size:13px; white-space:nowrap;">
        ${folder.monthName} ${folder.total > 0 ? `<span style="opacity:.7;">(${folder.total})</span>` : ''}
      </button>`;
    }).join('');
    const activeIdx = window.__carpetaActiveMonth ?? currentMonthIdx;
    const activeFolder = carpeta.monthlyFolders[activeIdx];
    const categoryBlocks = Object.entries(CATEGORY_LABELS).map(([key, meta]) => {
      const docs = activeFolder?.categories?.[key] || [];
      const items = docs.length
        ? docs.map(d => `<div style="display:flex;justify-content:space-between;align-items:center; padding:8px 10px;border-bottom:1px solid #1e293b;font-size:13px;">
            <span>${esc(d.file_name)}</span>
            <span style="color:${d.needs_review ? '#f59e0b' : '#10b981'};font-size:11px;">${d.needs_review ? '⚠️ Revisar' : '✅ OK'}</span>
          </div>`).join('')
        : `<p style="color:#64748b;font-size:12px;padding:8px 10px;">Sin documentos este mes.</p>`;
      return `<div style="border:1px solid #1e293b;border-radius:8px;margin-bottom:10px;overflow:hidden;">
        <div style="padding:8px 12px;background:rgba(255,255,255,0.03);border-left:3px solid ${meta.color};font-weight:600;font-size:13px;">
          ${meta.label} <span style="opacity:.6;">(${docs.length})</span>
        </div>${items}</div>`;
    }).join('');
    container.innerHTML = `<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:14px;">${monthTabs}</div>
      <h4 style="margin:0 0 10px;color:#e2e8f0;">${activeFolder?.monthName || ''} ${carpeta.year} — ${activeFolder?.total || 0} documentos</h4>
      ${categoryBlocks}`;
    container.querySelectorAll('.carpeta-month-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        window.__carpetaActiveMonth = Number(btn.getAttribute('data-month-idx'));
        renderCarpetaFiscal();
      });
    });
  }

  // ── Clasificador/Chat ──────────────────────────────────────
  function normalizeAssistantReply(reply) {
    if (!reply) return 'Sin respuesta.';
    if (typeof reply === 'string') return reply;
    if (typeof reply === 'object') {
      const main = reply.respuestaFiscal || reply.reply || reply.message || '';
      const legal = reply.fundamentoLegal ? ` Fundamento: ${reply.fundamentoLegal}.` : '';
      const diff = reply.diferenciacionIsrIva ? ` ISR vs IVA: ${reply.diferenciacionIsrIva}.` : '';
      return `${main}${legal}${diff}`.trim() || 'Sin respuesta.';
    }
    return 'Sin respuesta.';
  }
  function showAnalysis(result) {
    const empty = byId('classification-empty');
    const content = byId('classification-content');
    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    const setT = (id, v) => { const el = byId(id); if (el) el.textContent = v; };
    setT('result-intent', result.intent || 'OTROS');
    setT('result-confidence-val', Math.round(Number(result.confidence || 0) * 100));
    setT('result-keywords', Array.isArray(result.keywordsMatched) ? result.keywordsMatched.join(', ') : '');
    setT('result-source', result.source || 'classifier');
  }
  function appendChatMessage(text, role = 'bot') {
    const box = byId('chat-messages');
    if (!box) return;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.style.cssText = `background:${role === 'user' ? 'rgba(255,255,255,0.08)' : 'rgba(16,185,129,0.15)'};padding:12px;border-radius:12px;color:#e2e8f0;margin-bottom:8px;`;
    bubble.textContent = text;
    box.appendChild(bubble);
    box.scrollTop = box.scrollHeight;
  }
  async function handleClassifierSubmit(text) {
    const input = byId('classifier-input');
    const submit = byId('classifier-submit');
    if (!text) return;
    appendChatMessage(text, 'user');
    if (input) input.value = '';
    if (submit) { submit.disabled = true; submit.textContent = 'Procesando...'; }
    try {
      const result = await window.IntentClassifier?.process?.(text);
      if (!result) { appendChatMessage('No pude procesar la consulta en este momento.', 'bot'); return; }
      const assistantText = normalizeAssistantReply(result.assistantReply || result.reply || result.response);
      appendChatMessage(assistantText, 'bot');
      showAnalysis(result);
      window.Store?.addConversation?.({ text, message_text: text, intent: result.intent || 'OTROS', confidence: Number(result.confidence || 0), source: result.source || 'classifier' });
    } catch (error) {
      appendChatMessage(`Error al procesar: ${error?.message || 'desconocido'}`, 'bot');
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = 'Enviar'; }
      syncAndRender();
    }
  }
  function initClassifier() {
    const form = byId('classifier-form');
    const input = byId('classifier-input');
    form?.addEventListener('submit', e => { e.preventDefault(); handleClassifierSubmit(String(input?.value || '').trim()); });
    document.querySelectorAll('.quick-ask[data-prompt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        if (input) input.value = prompt;
        handleClassifierSubmit(prompt);
      });
    });
  }

  // ── Wizard Fiscal (Art. 113-F LISR) ─────────────────────────
  function showWizardMessage(text, tone = 'error') {
    const msg = byId('wizard-msg');
    if (!msg) return;
    msg.style.display = 'block';
    msg.style.background = tone === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
    msg.style.color = tone === 'success' ? '#d1fae5' : '#fecaca';
    msg.textContent = text;
  }
  function hideWizardMessage() {
    const msg = byId('wizard-msg');
    if (!msg) return;
    msg.style.display = 'none'; msg.textContent = '';
  }
  function setWizardStep(step) {
    wizardStep = Math.max(1, Math.min(WIZARD_MAX_STEPS, Number(step || 1)));
    document.querySelectorAll('.wizard-step').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.step) === wizardStep);
    });
  }
  function validateStep(step) {
    const income = Number(byId('wiz-income')?.value || 0);
    const salarios = Number(byId('wiz-salarios')?.value || 0);
    const intereses = Number(byId('wiz-intereses')?.value || 0);
    if (step === 1) {
      if (Number.isNaN(income) || income < 0) { showWizardMessage('Ingresa un monto válido para ingresos estimados.'); return false; }
      if (income > RESICO_LIMIT) { showWizardMessage(`El monto supera el límite RESICO de ${money(RESICO_LIMIT)}.`); return false; }
    }
    if (step === 3) {
      if (Number.isNaN(salarios) || salarios < 0) { showWizardMessage('El monto de salarios no es válido.'); return false; }
      if (Number.isNaN(intereses) || intereses < 0) { showWizardMessage('El monto de intereses no es válido.'); return false; }
    }
    hideWizardMessage();
    return true;
  }
  function readYesNo(id) {
    const el = byId(id);
    if (!el) return false;
    if (el.type === 'checkbox') return !!el.checked;
    return String(el.value || '').toLowerCase() === 'si';
  }
  function computeWizardDiagnosis(inputs) {
    const income = Number(inputs.income || 0);
    const salarios = Number(inputs.salarios || 0);
    const intereses = Number(inputs.intereses || 0);
    const superaSalarios = salarios > MIXTOS_LIMIT;
    const superaIntereses = intereses > INTERESES_LIMIT;
    const ingresosMixtos = !!inputs.socioPM || !!inputs.mixtos;
    const anualObligatoria = superaSalarios || superaIntereses || ingresosMixtos;
    const riesgoBuzon = inputs.buzonActivo === false || inputs.buzonActivo === 'false';
    const riskLevel = calcRiskLevelWizard(income);
    const riesgoMulta = riskLevel === 'EXPULSION' || riskLevel === 'RIESGO_ALTO';
    const recomendaciones = [];
    if (anualObligatoria) {
      recomendaciones.push(`📋 DECLARACIÓN ANUAL OBLIGATORIA (Art. 113-F LISR): La combinación de ingresos mixtos en RESICO obliga a presentar la declaración anual. ${superaSalarios ? `Tus salarios ($${salarios.toLocaleString('es-MX')} MXN) superan $400,000.` : ''}${superaIntereses ? ` Tus intereses ($${intereses.toLocaleString('es-MX')} MXN) superan $100,000.` : ''}`);
    } else {
      recomendaciones.push('✅ Sin obligación de declaración anual bajo Art. 113-F LISR por el momento.');
    }
    if (riesgoBuzon) recomendaciones.push(`⚠️ ALERTA BUZÓN TRIBUTARIO (Art. 17-K CFF): Riesgo de multa de $${BUZON_MULTA.toLocaleString('es-MX')} MXN.`);
    if (riesgoMulta) recomendaciones.push(`🚨 ALERTA LÍMITE RESICO (Art. 113-E LISR): Tus ingresos de $${income.toLocaleString('es-MX')} MXN superan el ${riskLevel === 'EXPULSION' ? '94%' : '90%'} del límite.`);
    return { income, salarios, intereses, mixtos: !!inputs.mixtos, socioPM: !!inputs.socioPM, cfdiGlobal: !!inputs.cfdiGlobal, buzonActivo: !riesgoBuzon, anualObligatoria, riesgoMulta, riesgoBuzon, riskLevel, recomendacion: recomendaciones.join('\n\n'), completedAt: new Date().toISOString() };
  }
  function renderWizardResult(diagnosis) {
    const out = byId('wiz-result') || byId('wizard-result');
    if (!out) return;
    const color = { SEGURO: '#10b981', PREVENTIVO: '#f59e0b', RIESGO_ALTO: '#ef4444', EXPULSION: '#dc2626' }[diagnosis.riskLevel] || '#10b981';
    const anualBadge = diagnosis.anualObligatoria
      ? `<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">DECLARACIÓN ANUAL OBLIGATORIA — Art. 113-F LISR</span>`
      : `<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">Sin obligación de anual</span>`;
    const buzonBadge = diagnosis.riesgoBuzon
      ? `<span style="background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px;font-size:12px;">⚠️ Multa Buzón: $${BUZON_MULTA.toLocaleString('es-MX')} MXN — Art. 17-K CFF</span>`
      : '';
    out.innerHTML = `<div style="border:1px solid ${color};border-radius:8px;padding:16px;margin-top:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${anualBadge}${buzonBadge}</div>
      <p style="color:${color};font-weight:bold;margin:0 0 8px;">Riesgo RESICO: ${diagnosis.riskLevel}</p>
      <pre style="white-space:pre-wrap;font-size:13px;color:#e2e8f0;line-height:1.6;">${esc(diagnosis.recomendacion)}</pre></div>`;
  }
  function completeWizard() {
    const income = Number((byId('wiz-income') || {}).value || 0);
    const salarios = Number((byId('wiz-salarios') || {}).value || 0);
    const intereses = Number((byId('wiz-intereses') || {}).value || 0);
    const diagnosis = computeWizardDiagnosis({
      income, salarios, intereses,
      socioPM: readYesNo('wiz-socio'),
      mixtos: readYesNo('wiz-mixtos'),
      cfdiGlobal: readYesNo('wiz-cfdi'),
      buzonActivo: String(byId('wiz-buzon')?.value || 'si').toLowerCase() !== 'no'
    });
    window.Store?.updateDiagnostic?.(diagnosis);
    renderWizardResult(diagnosis);
    const setF = (id, val) => { const el = byId(id); if (el) el.textContent = val; };
    const fmtM = n => `$${Number(n || 0).toLocaleString('es-MX')} MXN`;
    setF('res-income', fmtM(diagnosis.income));
    setF('res-salarios', fmtM(diagnosis.salarios));
    setF('res-intereses', fmtM(diagnosis.intereses));
    setF('res-anual', diagnosis.anualObligatoria ? '⚠️ OBLIGATORIA (Art. 113-F LISR)' : '✅ No obligatoria');
    setF('res-multa', diagnosis.riesgoMulta ? '🔴 Riesgo de multa CFDI' : '✅ CFDI al corriente');
    setF('res-buzon', diagnosis.riesgoBuzon ? '🔴 Inactivo — multa $10,260 MXN (Art. 17-K CFF)' : '✅ Activo');
    setF('res-risk', `${diagnosis.riskLevel} — ${diagnosis.income > 0 ? ((diagnosis.income / 3500000) * 100).toFixed(1) : '0.0'}% del límite`);
    setF('res-pedagogia', '📚 ISR RESICO: sobre ingresos brutos sin deducciones (1%–2.5%). IVA: acreditable solo con CFDI válido y gasto indispensable.');
    setF('res-recomendacion', diagnosis.recomendacion);
    byId('res-income')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function wizardNext() {
    if (!validateStep(wizardStep)) return;
    if (wizardStep >= WIZARD_MAX_STEPS) { completeWizard(); return; }
    setWizardStep(wizardStep + 1);
  }
  function resetWizard() {
    wizardStep = 1; setWizardStep(1);
    const defaults = { 'wiz-income': '', 'wiz-mixtos': 'no', 'wiz-socio': 'no', 'wiz-salarios': '0', 'wiz-intereses': '0', 'wiz-cfdi': 'si', 'wiz-buzon': 'si' };
    Object.entries(defaults).forEach(([id, value]) => { const el = byId(id); if (el) el.value = value; });
    ['res-income','res-salarios','res-intereses','res-anual','res-multa','res-buzon','res-risk','res-pedagogia','res-notas','res-recomendacion'].forEach(id => { const el = byId(id); if (el) el.textContent = '--'; });
    hideWizardMessage();
  }
  function saveDiagnostic() {
    const d = window.Store?.getState?.()?.diagnostic;
    if (!d || !d.completedAt) { showWizardMessage('Primero pulsa "Calcular diagnóstico".', 'error'); return; }
    window.Store?.updateIncome?.(Number(d.income || 0));
    window.Store?.updateSaludFiscal?.({ buzonTributarioActivo: !!d.buzonActivo, alertLevel: d.riesgoBuzon ? 'danger' : 'safe', lastAuditDate: new Date().toISOString() });
    syncAndRender();
    showWizardMessage('Diagnóstico guardado correctamente.', 'success');
  }

  // ── Carpeta Fiscal uploads ─────────────────────────────────
  function setUploadStatus(id, text, color = '#94a3b8') {
    const el = byId(id); if (!el) return; el.textContent = text; el.style.color = color;
  }
  function setCarpetaMessage(text, tone = 'success') {
    const msg = byId('carpeta-fiscal-msg'); if (!msg) return;
    msg.style.display = 'block';
    msg.style.background = tone === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)';
    msg.style.color = tone === 'error' ? '#fecaca' : '#d1fae5';
    msg.textContent = text;
  }
  function fileExt(name) {
    const parts = String(name || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  }
  function docTypeFromCategory(category) {
    if (category === 'efirma') return 'EFIRMA';
    if (category === 'constancia') return 'CONSTANCIA';
    if (category === 'opinion') return 'OPINION';
    return 'OTRO';
  }
  async function handleCarpetaUpload(file, category) {
    if (!file) return;
    try {
      const now = new Date();
      const extracted = { folder_category: category, fecha: now.toISOString(), original_extension: fileExt(file.name) };
      if (category === 'efirma') extracted.fecha_vencimiento = addYears(now, EFIRMA_YEARS).toISOString();
      await window.Store?.saveDocument?.({ file_name: file.name, document_type: docTypeFromCategory(category), extracted_data: extracted, source: 'carpeta_upload', confidence: 0.99, validation_status: 'cargado' });
      if (category === 'efirma') {
        const days = computeDaysRemaining(extracted.fecha_vencimiento);
        window.Store?.updateSaludFiscal?.({ eFirmaVigente: true, eFirmaExpiry: extracted.fecha_vencimiento, lastAuditDate: new Date().toISOString(), alertLevel: days <= 30 ? 'warning' : 'safe' });
        setUploadStatus('efirma-upload-status', `VIGENTE · ${days} día(s) restantes`, '#10b981');
      }
      if (category === 'constancia') setUploadStatus('constancia-upload-status', `Archivo cargado: ${file.name}`, '#10b981');
      if (category === 'opinion') setUploadStatus('opinion-upload-status', `Archivo cargado: ${file.name}`, '#10b981');
      setCarpetaMessage(`Documento cargado correctamente: ${file.name}`);
      syncAndRender();
    } catch (e) { setCarpetaMessage(`Error al cargar documento: ${e?.message || 'desconocido'}`, 'error'); }
  }
  function bindCarpetaUpload(inputId, category) {
    const input = byId(inputId); if (!input) return;
    input.addEventListener('change', async e => { const file = e.target.files?.[0]; await handleCarpetaUpload(file, category); });
  }
  function bindDropzone(dropId, inputId) {
    const zone = byId(dropId); const input = byId(inputId);
    if (!zone || !input) return;
    zone.addEventListener('click', () => input.click());
    ['dragenter','dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.style.borderColor = '#10b981'; zone.style.background = 'rgba(16,185,129,0.08)'; }));
    ['dragleave','drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.style.borderColor = 'rgba(255,255,255,0.18)'; zone.style.background = 'rgba(255,255,255,0.03)'; }));
    zone.addEventListener('drop', async e => {
      const file = e.dataTransfer?.files?.[0]; if (!file) return;
      const dt = new DataTransfer(); dt.items.add(file);
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function initCarpetaFiscalUploads() {
    bindCarpetaUpload('carpeta-efirma-cer', 'efirma');
    bindCarpetaUpload('carpeta-efirma-key', 'efirma');
    bindCarpetaUpload('carpeta-constancia-file', 'constancia');
    bindCarpetaUpload('carpeta-opinion-file', 'opinion');
    bindDropzone('drop-efirma-cer', 'carpeta-efirma-cer');
    bindDropzone('drop-efirma-key', 'carpeta-efirma-key');
    bindDropzone('drop-constancia', 'carpeta-constancia-file');
    bindDropzone('drop-opinion', 'carpeta-opinion-file');
  }

  function syncAndRender() {
    renderKPIs(); renderIncomeWithCssClasses(); renderHealth();
    renderHealthExtended(); renderFeed(); renderCarpetaFiscal();
    window.DocumentsManager?.renderDocuments?.();
  }

  function initRiskAlertListener() {
    window.Store?.on?.('riskThresholdCrossed', (payload) => {
      console.info('[App] Umbral cruzado — payload listo para n8n:', payload);
      window.__lastWhatsAppAlertPayload = payload;
    });
  }

  async function initCore() {
    await window.AppConfig?.loadServerConfig?.();
    await window.Store?.initSupabase?.();
  }

  function hideAuthOverlay() {
    const overlay = byId('auth-overlay');
    if (!overlay) return;
    overlay.style.display = 'none'; overlay.style.opacity = '';
    overlay.setAttribute('aria-hidden', 'true');
    const appRoot = byId('app');
    if (appRoot) appRoot.style.display = 'block';
  }
  function showAuthOverlay() {
    const overlay = byId('auth-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex'; overlay.removeAttribute('aria-hidden');
  }

  async function init() {
    if (booted) return;
    booted = true;
    initTheme(); initNavigation(); initRFC(); initClassifier(); initCarpetaFiscalUploads();
    setWizardStep(1); resetWizard();
    window.DocumentsManager?.init?.();
    window.DocumentProcessor?.init?.();
    window.Invoicing?.init?.();
    try { await initCore(); } catch (err) { console.error('[App] ⚠️ initCore() falló:', err?.message || err); }
    window.Store?.on?.('storeUpdated', syncAndRender);
    window.Store?.on?.('documentAdded', syncAndRender);
    window.Store?.on?.('conversationAdded', syncAndRender);
    window.Store?.on?.('carpetaUpdated', renderCarpetaFiscal);
    syncAndRender();
    initRiskAlertListener();
    try { window.AuthManager?.init?.(); } catch (err) { console.error('[App] ⚠️ AuthManager.init() falló:', err?.message || err); }
  }

  return { init, navigateTo, syncAndRender, wizardNext, resetWizard, saveDiagnostic, renderCarpetaFiscal, hideAuthOverlay, showAuthOverlay };
})();

window.App = App;
window.wizardNext = typeof App.wizardNext === 'function' ? App.wizardNext : function () { console.warn('[App] wizardNext no disponible todavía.'); };
window.resetWizard = App.resetWizard;
window.saveDiagnostic = App.saveDiagnostic;
window.Dashboard = App.syncAndRender;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}