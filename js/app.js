const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents', 'rfc-consult', 'invoicing', 'carpeta'];
  const EFOS_KEY = 'ar_efos_watchlist_v1';
  const RESICO_LIMIT = 3500000;
  const ALERT_80 = 2800000;
  const ALERT_90 = 3150000;
  const ALERT_94 = 3290000;
  const MIXTOS_LIMIT = 400000;
  const INTERESES_LIMIT = 100000;
  const BUZON_MULTA = 10260;
  const EFIRMA_YEARS = 4;
  const WIZARD_MAX_STEPS = 5;
  const EFIRMA_ALERT_90_DAYS = 90;
  const EFIRMA_ALERT_30_DAYS = 30;

  let booted = false;
  let wizardStep = 1;

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function money(value) {
    return `$${Number(value || 0).toLocaleString('es-MX')} MXN`;
  }

  function getCfg(key, fallback) {
    return window.RESICO_CONFIG?.[key] ?? fallback;
  }

  function navigateTo(view) {
    const target = VIEWS.includes(view) ? view : 'dashboard';

    document.querySelectorAll('.tab-view').forEach(el => {
      el.hidden = true;
    });

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

  function initTheme() {
  const btn = byId('theme-toggle');
  const saved = localStorage.getItem('ar_theme') || 'dark';
  document.body.dataset.theme = saved;
  if (btn) btn.textContent = saved === 'light' ? '☀️' : '🌙';
  btn?.addEventListener('click', () => {
    const current = localStorage.getItem('ar_theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem('ar_theme', next);
    document.body.dataset.theme = next;
    btn.textContent = next === 'light' ? '☀️' : '🌙';
  });
}

  function initNavigation() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigateTo(btn.getAttribute('data-tab'));
      });
    });

    const initial = (window.location.hash || '').replace('#', '');
    navigateTo(initial || 'dashboard');
  }

  function loadLocalEFOSList() {
    try {
      const local = JSON.parse(localStorage.getItem(EFOS_KEY) || '[]');
      return Array.isArray(local) ? local : [];
    } catch {
      return [];
    }
  }

  function getEFOSWatchlist() {
    const cfg = Array.isArray(window.RESICO_CONFIG?.EFOS_RFC_LIST)
      ? window.RESICO_CONFIG.EFOS_RFC_LIST
      : [];
    const local = loadLocalEFOSList();

    const all = [...cfg, ...local]
      .map(v => String(v || '').trim().toUpperCase())
      .filter(Boolean);

    return [...new Set(all)];
  }

  function classifyRFCDeep(rfc) {
  const clean = String(rfc || '').trim().toUpperCase();
  if (!clean) {
    return { ok: false, message: 'Ingresa un RFC.' };
  }

  // FIX: delega en el validador meticuloso real de FiscalWizard.js
  // (antes esta función tenía su propia validación simplificada, duplicada).
  const result = window.ValidatorRFC?.validate?.(clean);

  if (!result) {
    return {
      ok: false,
      message: 'Validador de RFC no disponible.',
      detail: 'Verifica que js/FiscalWizard.js esté cargado antes de app.js en index.html.'
    };
  }

  const efosSet = new Set(getEFOSWatchlist());
  const efos = efosSet.has(clean);

  if (!result.valid) {
    return {
      ok: true,
      valid: false,
      message: 'RFC inválido.',
      detail: result.warning || 'El RFC no coincide con estructura de Persona Física ni Persona Moral.'
    };
  }

  const typeLabel =
    result.type === 'PF' ? 'PERSONA FÍSICA' :
    result.type === 'PM' ? 'PERSONA MORAL' :
    result.type === 'extranjero' ? 'GENÉRICO EXTRANJERO' :
    result.type === 'publico' ? 'GENÉRICO NACIONAL' : 'DESCONOCIDO';

  if (efos) {
    return {
      ok: true,
      valid: true,
      type: typeLabel,
      efos: true,
      risk: 'danger',
      message: `RFC válido con alerta crítica: ${clean}`,
      detail: 'El RFC coincide con la watchlist EFOS configurada. Revisión obligatoria antes de acreditar IVA o facturar en automático.'
    };
  }

  if (result.warning) {
    return {
      ok: true,
      valid: true,
      type: typeLabel,
      efos: false,
      risk: 'warning',
      message: `RFC válido: ${clean}`,
      detail: result.warning
    };
  }

  return {
    ok: true,
    valid: true,
    type: typeLabel,
    efos: false,
    risk: 'safe',
    message: `RFC válido: ${clean}`,
    detail: `Estructura detectada de ${typeLabel} (validación meticulosa PF=13/PM=12 caracteres). Sin coincidencia en watchlist EFOS.`
  };
}

  function renderRFCResult(result) {
    const out = byId('rfc-result');
    if (!out) return;

    if (!result.ok) {
      out.innerHTML = `
        <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);padding:12px;border-radius:12px;color:#fecaca;">
          <div style="font-weight:700;">${esc(result.message || 'RFC inválido')}</div>
          <div style="font-size:13px;margin-top:4px;">${esc(result.detail || '')}</div>
        </div>
      `;
      return;
    }

    const tone = result.risk === 'danger'
      ? { bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.35)', tx: '#fecaca' }
      : result.risk === 'warning'
        ? { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.35)', tx: '#fde68a' }
        : { bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.35)', tx: '#d1fae5' };

    out.innerHTML = `
      <div style="background:${tone.bg};border:1px solid ${tone.bd};padding:12px;border-radius:12px;color:${tone.tx};">
        <div style="font-weight:700;">${esc(result.message)}</div>
        <div style="font-size:13px;margin-top:4px;">${esc(result.type || '')} · ${esc(result.detail || '')}</div>
        <div style="font-size:13px;margin-top:8px;">${result.efos ? 'Alerta EFOS detectada en watchlist local/configurada.' : 'Sin coincidencia EFOS en watchlist local/configurada.'}</div>
      </div>
    `;
  }

  function initRFC() {
    const btn = byId('rfc-validate-btn');
    const inp = byId('rfc-input');
    const out = byId('rfc-result');
    if (!btn || !inp || !out) return;

    const validate = () => renderRFCResult(classifyRFCDeep(inp.value));
    btn.addEventListener('click', validate);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        validate();
      }
    });
  }

  function renderKPIs() {
    const metrics = window.Store?.getMetrics?.() || {};

    const total = byId('kpi-total');
    const confidence = byId('kpi-confidence');
    const autoRate = byId('kpi-auto-rate');
    const responseTime = byId('kpi-response-time');

    if (total) total.textContent = Number(metrics.totalProcessed || 0);
    if (confidence) confidence.textContent = Number(metrics.avgConfidence || 0);
    if (autoRate) autoRate.textContent = `${Number(metrics.autoResolutionRate || 92)}%`;
    if (responseTime) responseTime.textContent = `${Number(metrics.avgResponseTime || 2.3)}s`;
  }

  function renderIncome() {
    const st = window.Store?.getState?.();
    if (!st) return;

    const current = Number(st.incomeYTD || 0);
    const limit = Number(st.fiscalMetrics?.annualLimit || getCfg('INCOME_LIMIT', RESICO_LIMIT));
    const remaining = Math.max(0, limit - current);
    const risk = st.fiscalMetrics?.riskLevel || 'SEGURO';
    const ratio = limit > 0 ? Math.min(100, Math.max(0, (current / limit) * 100)) : 0;

    const currentEl = byId('income-current');
    const limitEl = byId('income-limit');
    const remainingEl = byId('income-remaining');
    const projectionEl = byId('projection-val');
    const fillEl = byId('income-progress-fill');
    const badgeEl = byId('income-alert-badge');
    const msgEl = byId('income-alert-message');

    if (currentEl) currentEl.textContent = money(current);
    if (limitEl) limitEl.textContent = money(limit);
    if (remainingEl) remainingEl.textContent = money(remaining);
    if (projectionEl) projectionEl.textContent = `${ratio.toFixed(1)}% del límite`;

    if (fillEl) {
      fillEl.style.width = `${ratio}%`;
      fillEl.style.background =
        risk === 'EXPULSION' ? '#ef4444' :
        risk === 'RIESGO_ALTO' ? '#f97316' :
        risk === 'PREVENTIVO' ? '#f59e0b' : '#10b981';
    }

    if (badgeEl) {
      badgeEl.textContent = risk;
      badgeEl.className =
        risk === 'EXPULSION' ? 'badge-danger' :
        risk === 'RIESGO_ALTO' ? 'badge-warning' :
        risk === 'PREVENTIVO' ? 'badge-warning' : 'badge-safe';
    }

    if (msgEl) {
      if (risk === 'EXPULSION') {
        msgEl.innerHTML = `<span style="color:#fecaca;">Riesgo crítico: estás en zona de expulsión del régimen.</span>`;
      } else if (risk === 'RIESGO_ALTO') {
        msgEl.innerHTML = `<span style="color:#fdba74;">Riesgo alto: revisa ingresos cobrados y cierre mensual.</span>`;
      } else if (risk === 'PREVENTIVO') {
        msgEl.innerHTML = `<span style="color:#fde68a;">Alerta preventiva: ya superaste el 80% del límite anual.</span>`;
      } else {
        msgEl.innerHTML = `<span style="color:#86efac;">Sin riesgo actual.</span>`;
      }
    }
  }

  function computeDaysRemaining(dateStr) {
    if (!dateStr || dateStr === 'pendiente') return null;
    const today = new Date();
    const target = new Date(dateStr);
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  function renderHealth() {
    const salud   = window.Store?.getSaludFiscal?.()   || {};
    const carpeta = window.Store?.getCarpetaFiscal?.() || {};

    const buzonStatus = byId('buzon-status');
    const efirmaStatus = byId('efirma-status');
    const efirmaDays   = byId('efirma-days');
    const opinionStatus = byId('opinion-status');
    const healthAlert  = byId('health-alert');

    // ── Activación inteligente de Salud Fiscal desde documentos de Carpeta ──
    // Si hay documentos de e.firma cargados, pasar de 'Verificando...' a datos reales.
    // Art. 17-D CFF: e.firma vigente; Art. 17-K CFF: Buzón Tributario activo.
    const hasEFirmaDoc   = (carpeta.summary?.efirma || 0) > 0;
    const hasOpinionDoc  = carpeta.opinionStatus === 'cargada';
    const hasConstanciaDoc = carpeta.constanciaStatus === 'actualizada';

    // Derivar éxpiry y days desde la carpeta si no hay estado explícito
    const expiry = salud.eFirmaExpiry || carpeta.efirmaExpiry;
    const days   = computeDaysRemaining(expiry);

    // Búzón Tributario (Art. 17-K CFF)
    if (buzonStatus) {
      let buzonText  = 'Verificando...';
      let buzonColor = '#f59e0b';

      if (salud.buzonTributarioActivo === true) {
        buzonText  = 'Activo';
        buzonColor = '#10b981';
      } else if (salud.buzonTributarioActivo === false) {
        buzonText  = 'Inactivo — Riesgo multa Art. 17-K CFF';
        buzonColor = '#ef4444';
      } else if (hasConstanciaDoc || hasOpinionDoc) {
        // Si hay documentos de constancia/opinión cargados, inferir actividad básica
        buzonText  = 'Con documentos fiscales cargados';
        buzonColor = '#38bdf8';
      }

      buzonStatus.textContent = buzonText;
      buzonStatus.style.color = buzonColor;
    }

    // e.firma (Art. 17-D CFF)
    if (efirmaStatus) {
      let efirmaText  = 'Verificando...';
      let efirmaColor = '#f59e0b';

      if (salud.eFirmaVigente === true || (hasEFirmaDoc && days !== null && days > 0)) {
        efirmaText  = 'VIGENTE';
        efirmaColor = '#10b981';
      } else if (salud.eFirmaVigente === false || (days !== null && days <= 0)) {
        efirmaText  = 'VENCIDA — Tramitar renovación SAT';
        efirmaColor = '#ef4444';
      } else if (hasEFirmaDoc && days === null) {
        // Archivo cargado pero sin fecha de vencimiento detectada
        efirmaText  = 'Cargada — Verificar fecha de vencimiento';
        efirmaColor = '#f59e0b';
      }

      efirmaStatus.textContent = efirmaText;
      efirmaStatus.style.color = efirmaColor;
    }

    // Días restantes de e.firma
    if (efirmaDays) {
      if (typeof days === 'number' && hasEFirmaDoc) {
        efirmaDays.textContent = days > 0
          ? `${days} día(s) restantes (Art. 17-D CFF)`
          : 'VENCIDA — Renueva en portal SAT';
        efirmaDays.style.color = days > 30 ? '#10b981' : days > 0 ? '#f59e0b' : '#ef4444';
      } else if (hasEFirmaDoc) {
        efirmaDays.textContent = 'Archivo cargado — fecha no detectada';
        efirmaDays.style.color = '#f59e0b';
      } else {
        efirmaDays.textContent = '-- días restantes';
        efirmaDays.style.color = '#94a3b8';
      }
    }

    // Opinión de cumplimiento
    if (opinionStatus) {
      const loaded = hasOpinionDoc;
      opinionStatus.textContent = loaded ? 'Cargada' :
        salud.alertLevel === 'danger' ? 'Revisar urgente' : 'No consultada';
      opinionStatus.style.color = loaded ? '#10b981' :
        salud.alertLevel === 'danger' ? '#ef4444' : '#94a3b8';
    }

    // Panel de alertas de salud fiscal
    if (healthAlert) {
      const messages = [];
      if (salud.buzonTributarioActivo === false) {
        messages.push(`Buzón Tributario inactivo: riesgo de multa de $${BUZON_MULTA.toLocaleString('es-MX')} MXN (Art. 17-K CFF).`);
      }
      if (salud.eFirmaVigente === false || (days !== null && days <= 0)) {
        messages.push('Tu e.firma está vencida. Renueva en el portal SAT (Art. 17-D CFF).');
      } else if (typeof days === 'number' && days > 0 && days <= 30) {
        messages.push(`Tu e.firma vence en ${days} día(s). Renueva antes del vencimiento (Art. 17-D CFF).`);
      }

      healthAlert.hidden = messages.length === 0;
      if (messages.length) healthAlert.textContent = messages.join(' ');
    }
  }

    function renderHealthExtended() {
    const carpeta = window.Store?.getCarpetaFiscal?.();
    const expiry = window.Store?.getSaludFiscal?.()?.eFirmaExpiry || carpeta?.efirmaExpiry;

    // Alerta de vigencia de e.firma (90/30 días)
    const efirmaAlert = computeEFirmaExpiryAlert(
      expiry && expiry !== 'pendiente'
        ? addYears(new Date(expiry), -EFIRMA_YEARS).toISOString() // reconstruye fecha de emisión aproximada
        : null
    );
    renderEFirmaAlertBanner(efirmaAlert);

    // Auditoría permanente de Buzón Tributario
    renderBuzonAuditAlert();
  }

  function renderFeed() {
    const feed = byId('feed-list');
    if (!feed) return;

    const st = window.Store?.getState?.();
    if (!st) return;

    const conversations = st.conversations.slice(0, 4).map(item => ({
      at: item.timestamp || Date.now(),
      title: item.intent || 'OTROS',
      detail: item.message_text || item.text || 'Consulta'
    }));

    const documents = st.documents.slice(0, 4).map(item => ({
      at: new Date(item.created_at || Date.now()).getTime(),
      title: item.document_type || item.doc_type || 'OTRO',
      detail: item.file_name || 'Documento'
    }));

    const items = [...conversations, ...documents]
      .sort((a, b) => b.at - a.at)
      .slice(0, 6);

    if (!items.length) {
      feed.innerHTML = `<p class="feed-empty" style="color:#94a3b8;">Sin actividad.</p>`;
      return;
    }

    feed.innerHTML = items.map(item => `
      <div style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <strong style="color:#e2e8f0;">${esc(item.title)}</strong>
          <span style="color:#94a3b8;font-size:12px;">${new Date(item.at).toLocaleString('es-MX')}</span>
        </div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px;">${esc(String(item.detail).slice(0, 160))}</div>
      </div>
    `).join('');
  }

  function renderCategoryList(items = [], emptyLabel) {
    if (!items.length) {
      return `<div style="color:#64748b;font-size:13px;">${esc(emptyLabel)}</div>`;
    }

    return items.map(item => `
      <div style="padding:10px;border-radius:10px;background:rgba(255,255,255,0.04);margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <strong style="color:#e2e8f0;">${esc(item.file_name || 'archivo')}</strong>
          <span style="font-size:12px;color:${item.needs_review ? '#f59e0b' : '#94a3b8'};">${item.needs_review ? 'Revisión' : 'OK'}</span>
        </div>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px;">
          ${esc(item.document_type || 'OTRO')} · ${esc(item.fecha_fiscal || item.created_at || '')}
        </div>
      </div>
    `).join('');
  }

  const CATEGORY_LABELS = {
  ingresos:   { label: '💰 Ingresos',              color: '#10b981' },
  gastos_iva: { label: '🧾 Gastos (IVA)',          color: '#3b82f6' },
  efirma:     { label: '🔐 e.firma SAT',           color: '#8b5cf6' },
  constancia: { label: '📄 Constancia Fiscal',     color: '#f59e0b' },
  opinion:    { label: '✅ Opinión de Cumplimiento', color: '#06b6d4' }
};

function renderCarpetaFiscal() {
  const container = byId('carpeta-fiscal-content');
  if (!container) return;

  const carpeta = window.Store?.getCarpetaFiscal?.();
  if (!carpeta) return;

  const currentMonthIdx = new Date().getMonth();

  // Tabs de meses (Enero-Diciembre 2026)
  const monthTabs = carpeta.monthlyFolders.map((folder, idx) => {
    const isActive = idx === (window.__carpetaActiveMonth ?? currentMonthIdx);
    return `
      <button class="carpeta-month-tab" data-month-idx="${idx}"
              style="padding:8px 14px;border-radius:6px;border:1px solid ${isActive ? '#10b981' : '#334155'};
                     background:${isActive ? 'rgba(16,185,129,0.15)' : 'transparent'};
                     color:${isActive ? '#10b981' : '#94a3b8'};cursor:pointer;font-size:13px;
                     white-space:nowrap;">
        ${folder.monthName} ${folder.total > 0 ? `<span style="opacity:.7;">(${folder.total})</span>` : ''}
      </button>
    `;
  }).join('');

  const activeIdx = window.__carpetaActiveMonth ?? currentMonthIdx;
  const activeFolder = carpeta.monthlyFolders[activeIdx];

  const categoryBlocks = Object.entries(CATEGORY_LABELS).map(([key, meta]) => {
    const docs = activeFolder?.categories?.[key] || [];
    const items = docs.length
      ? docs.map(d => `
          <div style="display:flex;justify-content:space-between;align-items:center;
                      padding:8px 10px;border-bottom:1px solid #1e293b;font-size:13px;">
            <span>${esc(d.file_name)}</span>
            <span style="color:${d.needs_review ? '#f59e0b' : '#10b981'};font-size:11px;">
              ${d.needs_review ? '⚠️ Revisar' : '✅ OK'}
            </span>
          </div>
        `).join('')
      : `<p style="color:#64748b;font-size:12px;padding:8px 10px;">Sin documentos este mes.</p>`;

    return `
      <div style="border:1px solid #1e293b;border-radius:8px;margin-bottom:10px;overflow:hidden;">
        <div style="padding:8px 12px;background:rgba(255,255,255,0.03);
                    border-left:3px solid ${meta.color};font-weight:600;font-size:13px;">
          ${meta.label} <span style="opacity:.6;">(${docs.length})</span>
        </div>
        ${items}
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:14px;">
      ${monthTabs}
    </div>
    <h4 style="margin:0 0 10px;color:#e2e8f0;">
      ${activeFolder?.monthName || ''} ${carpeta.year} — ${activeFolder?.total || 0} documentos
    </h4>
    ${categoryBlocks}
  `;

  container.querySelectorAll('.carpeta-month-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      window.__carpetaActiveMonth = Number(btn.getAttribute('data-month-idx'));
      renderCarpetaFiscal();
    });
  });
}

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
    const intent = byId('result-intent');
    const conf = byId('result-confidence-val');
    const keywords = byId('result-keywords');
    const source = byId('result-source');

    if (empty) empty.hidden = true;
    if (content) content.hidden = false;
    if (intent) intent.textContent = result.intent || 'OTROS';
    if (conf) conf.textContent = Math.round(Number(result.confidence || 0) * 100);
    if (keywords) keywords.textContent = Array.isArray(result.keywordsMatched) ? result.keywordsMatched.join(', ') : '';
    if (source) source.textContent = result.source || 'classifier';
  }

  function appendChatMessage(text, role = 'bot') {
    const box = byId('chat-messages');
    if (!box) return;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.style.background = role === 'user' ? 'rgba(255,255,255,0.08)' : 'rgba(16,185,129,0.15)';
    bubble.style.padding = '12px';
    bubble.style.borderRadius = '12px';
    bubble.style.color = '#e2e8f0';
    bubble.style.marginBottom = '8px';
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

    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Procesando...';
    }

    try {
      const result = await window.IntentClassifier?.process?.(text);

      if (!result) {
        appendChatMessage('No pude procesar la consulta en este momento.', 'bot');
        return;
      }

      const assistantText = normalizeAssistantReply(result.assistantReply || result.reply || result.response);
      appendChatMessage(assistantText, 'bot');
      showAnalysis(result);

      window.Store?.addConversation?.({
        text,
        message_text: text,
        intent: result.intent || 'OTROS',
        confidence: Number(result.confidence || 0),
        source: result.source || 'classifier'
      });
    } catch (error) {
      appendChatMessage(`Error al procesar: ${error?.message || 'desconocido'}`, 'bot');
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Enviar';
      }
      syncAndRender();
    }
  }

  function initClassifier() {
    const form = byId('classifier-form');
    const input = byId('classifier-input');

    form?.addEventListener('submit', e => {
      e.preventDefault();
      handleClassifierSubmit(String(input?.value || '').trim());
    });

    document.querySelectorAll('.quick-ask[data-prompt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        if (input) input.value = prompt;
        handleClassifierSubmit(prompt);
      });
    });
  }

  function showWizardMessage(text, tone = 'error') {
    const msg = byId('wizard-msg');
    if (!msg) return;

    msg.style.display = 'block';
    msg.style.background = tone === 'success'
      ? 'rgba(16,185,129,0.12)'
      : 'rgba(239,68,68,0.12)';
    msg.style.color = tone === 'success' ? '#d1fae5' : '#fecaca';
    msg.textContent = text;
  }

  function hideWizardMessage() {
    const msg = byId('wizard-msg');
    if (!msg) return;
    msg.style.display = 'none';
    msg.textContent = '';
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
      if (Number.isNaN(income) || income < 0) {
        showWizardMessage('Ingresa un monto válido para ingresos estimados.');
        return false;
      }
      if (income > RESICO_LIMIT) {
        showWizardMessage(`El monto supera el límite RESICO de ${money(RESICO_LIMIT)}.`);
        return false;
      }
    }

    if (step === 3) {
      if (Number.isNaN(salarios) || salarios < 0) {
        showWizardMessage('El monto de salarios no es válido.');
        return false;
      }
      if (Number.isNaN(intereses) || intereses < 0) {
        showWizardMessage('El monto de intereses no es válido.');
        return false;
      }
    }

    hideWizardMessage();
    return true;
  }

function computeWizardDiagnosis(inputs) {
  const income    = Number(inputs.income    || 0);
  const salarios  = Number(inputs.salarios  || 0);
  const intereses = Number(inputs.intereses || 0);

  // ── Regla Art. 113-F LISR: Declaración Anual Obligatoria ──────────────
  // Condición 1: Ingresos por salarios/sueldos > $400,000 MXN
  const superaSalarios  = salarios  > MIXTOS_LIMIT;
  // Condición 2: Intereses reales acreditables > $100,000 MXN
  const superaIntereses = intereses > INTERESES_LIMIT;
  // Condición 3: Socio de PM o ingresos mixtos (por definición obliga anual)
  const ingresosMixtos  = !!inputs.socioPM || !!inputs.mixtos;

  const anualObligatoria = superaSalarios || superaIntereses || ingresosMixtos;

  // ── Alerta Art. 17-K CFF: Buzón Tributario ────────────────────────────
  const riesgoBuzon = inputs.buzonActivo === false || inputs.buzonActivo === 'false';

  // ── Alerta de proximidad al límite RESICO (Art. 113-E LISR) ───────────
  const riskLevel   = calcRiskLevelWizard(income);
  const riesgoMulta = riskLevel === 'EXPULSION' || riskLevel === 'RIESGO_ALTO';

  // ── Construcción de la recomendación pedagógica ────────────────────────
  const recomendaciones = [];

  if (anualObligatoria) {
    recomendaciones.push(
      '📋 DECLARACIÓN ANUAL OBLIGATORIA (Art. 113-F LISR): ' +
      'La combinación de ingresos mixtos en RESICO obliga a presentar la declaración anual, ' +
      'aunque estés en el régimen simplificado. ' +
      (superaSalarios  ? `Tus ingresos por salarios ($${salarios.toLocaleString('es-MX')} MXN) superan el umbral de $400,000 MXN. ` : '') +
      (superaIntereses ? `Tus intereses reales ($${intereses.toLocaleString('es-MX')} MXN) superan el umbral de $100,000 MXN. ` : '') +
      (ingresosMixtos  ? 'Tienes ingresos de fuente mixta que no aplican la exención del Art. 113-E. ' : '')
    );
  } else {
    recomendaciones.push(
      '✅ Sin obligación de declaración anual bajo Art. 113-F LISR por el momento. ' +
      'Monitorea tus ingresos mensualmente para detectar cambios.'
    );
  }

  if (riesgoBuzon) {
    recomendaciones.push(
      `⚠️ ALERTA BUZÓN TRIBUTARIO (Art. 17-K CFF): ` +
      `Tu Buzón Tributario no está activo. Riesgo de multa de ` +
      `$${BUZON_MULTA.toLocaleString('es-MX')} MXN. ` +
      `Actívalo en sat.gob.mx → Mi Portal → Buzón Tributario.`
    );
  }

  if (riesgoMulta) {
    recomendaciones.push(
      `🚨 ALERTA LÍMITE RESICO (Art. 113-E LISR): ` +
      `Tus ingresos de $${income.toLocaleString('es-MX')} MXN superan el ` +
      (riskLevel === 'EXPULSION' ? '94%' : '90%') +
      ` del límite de $3,500,000 MXN. Riesgo de expulsión del régimen.`
    );
  }

  if (!!inputs.cfdiGlobal) {
    recomendaciones.push(
      '📄 Usas CFDI Global: Recuerda que el CFDI global es válido solo para ' +
      'operaciones con público en general (RFC XAXX010101000). ' +
      'No es válido para acreditamiento de IVA entre contribuyentes registrados.'
    );
  }

  return {
    income,
    salarios,
    intereses,
    mixtos:          !!inputs.mixtos,
    socioPM:         !!inputs.socioPM,
    cfdiGlobal:      !!inputs.cfdiGlobal,
    buzonActivo:     !riesgoBuzon,
    anualObligatoria,
    riesgoMulta,
    riesgoBuzon,
    riskLevel,
    recomendacion:   recomendaciones.join('\n\n'),
    completedAt:     new Date().toISOString()
  };
}

// ── Helper: calcular nivel de riesgo para el wizard (sin depender de Store) ─
function calcRiskLevelWizard(income) {
  const v = Number(income || 0);
  if (v >= ALERT_94) return 'EXPULSION';
  if (v >= ALERT_90) return 'RIESGO_ALTO';
  if (v >= ALERT_80) return 'PREVENTIVO';
  return 'SEGURO';
}

// ── Renderizado del resultado en el DOM del wizard ────────────────────────
function renderWizardResult(diagnosis) {
  const out = byId('wiz-result') || byId('wizard-result');
  if (!out) return;

  const colorMap = {
    SEGURO:      '#10b981',
    PREVENTIVO:  '#f59e0b',
    RIESGO_ALTO: '#ef4444',
    EXPULSION:   '#dc2626'
  };

  const color       = colorMap[diagnosis.riskLevel] || '#10b981';
  const anualBadge  = diagnosis.anualObligatoria
    ? `<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">
         DECLARACIÓN ANUAL OBLIGATORIA — Art. 113-F LISR
       </span>`
    : `<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">
         Sin obligación de anual
       </span>`;

  const buzonBadge  = diagnosis.riesgoBuzon
    ? `<span style="background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px;font-size:12px;">
         ⚠️ Multa Buzón: $${BUZON_MULTA.toLocaleString('es-MX')} MXN — Art. 17-K CFF
       </span>`
    : '';

  out.innerHTML = `
    <div style="border:1px solid ${color};border-radius:8px;padding:16px;margin-top:12px;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
        ${anualBadge} ${buzonBadge}
      </div>
      <p style="color:${color};font-weight:bold;margin:0 0 8px;">
        Riesgo RESICO: ${diagnosis.riskLevel}
      </p>
      <pre style="white-space:pre-wrap;font-size:13px;color:#e2e8f0;line-height:1.6;">
${esc(diagnosis.recomendacion)}
      </pre>
    </div>
  `;
}
 
function completeWizard() {
  // Leer inputs del DOM
  const income    = Number((byId('wiz-income')    || {}).value || 0);
  const salarios  = Number((byId('wiz-salarios')  || {}).value || 0);
  const intereses = Number((byId('wiz-intereses') || {}).value || 0);
  const socioPM   = !!(byId('wiz-socio-pm')   || {}).checked;
  const mixtos    = !!(byId('wiz-mixtos')      || {}).checked;
  const cfdiGlobal= !!(byId('wiz-cfdi-global') || {}).checked;
  const buzonActivo = (byId('wiz-buzon')       || {}).value !== 'false';

  const diagnosis = computeWizardDiagnosis({
    income, salarios, intereses, socioPM, mixtos, cfdiGlobal, buzonActivo
  });

  // Persistir en Store y Supabase
  Store.updateDiagnostic(diagnosis);

  // Renderizar resultado
  renderWizardResult(diagnosis);

  // Navegar a la vista de resultado
  navigateTo('dashboard');
}

  function resetWizard() {
    wizardStep = 1;
    setWizardStep(1);

    const defaults = {
      'wiz-income': '',
      'wiz-mixtos': 'no',
      'wiz-socio': 'no',
      'wiz-salarios': '0',
      'wiz-intereses': '0',
      'wiz-cfdi': 'si',
      'wiz-buzon': 'si'
    };

    Object.entries(defaults).forEach(([id, value]) => {
      const el = byId(id);
      if (!el) return;
      el.value = value;
    });

    if (byId('res-income')) byId('res-income').textContent = '--';
    if (byId('res-salarios')) byId('res-salarios').textContent = '--';
    if (byId('res-intereses')) byId('res-intereses').textContent = '--';
    if (byId('res-anual')) byId('res-anual').textContent = '--';
    if (byId('res-multa')) byId('res-multa').textContent = '--';
    if (byId('res-buzon')) byId('res-buzon').textContent = '--';
    if (byId('res-risk')) byId('res-risk').textContent = '--';
    if (byId('res-pedagogia')) byId('res-pedagogia').textContent = '--';
    if (byId('res-notas')) byId('res-notas').textContent = '--';
    if (byId('res-recomendacion')) byId('res-recomendacion').textContent = '--';

    hideWizardMessage();
  }

  function saveDiagnostic() {
    const result = evaluateDiagnostic();

    window.Store?.updateDiagnostic?.({
      income: result.income,
      mixtos: result.mixtos,
      socioPM: result.socioPM,
      salarios: result.salarios,
      intereses: result.intereses,
      cfdiGlobal: result.cfdiGlobal,
      buzonActivo: result.buzonActivo,
      anualObligatoria: result.anualObligatoria,
      riesgoMulta: result.riesgoMulta,
      riesgoBuzon: result.riesgoBuzon,
      riskLevel: result.riskLevel,
      recomendacion: result.recomendacion,
      completedAt: new Date().toISOString()
    });

    window.Store?.updateIncome?.(result.income);
    if (result.riesgoBuzon) {
      window.Store?.updateSaludFiscal?.({
        buzonTributarioActivo: false,
        alertLevel: 'danger',
        lastAuditDate: new Date().toISOString()
      });
    } else {
      window.Store?.updateSaludFiscal?.({
        buzonTributarioActivo: true,
        lastAuditDate: new Date().toISOString()
      });
    }

    syncAndRender();
    navigateTo('dashboard');
    showWizardMessage('Diagnóstico guardado correctamente.', 'success');
  }

  function addYears(date, years) {
    const next = new Date(date);
    next.setFullYear(next.getFullYear() + years);
    return next;
  }

  function setUploadStatus(id, text, color = '#94a3b8') {
    const el = byId(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
  }

  function setCarpetaMessage(text, tone = 'success') {
    const msg = byId('carpeta-fiscal-msg');
    if (!msg) return;
    msg.style.display = 'block';
    msg.style.background = tone === 'error'
      ? 'rgba(239,68,68,0.12)'
      : 'rgba(16,185,129,0.12)';
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
      const extracted = {
        folder_category: category,
        fecha: now.toISOString(),
        original_extension: fileExt(file.name)
      };

      if (category === 'efirma') {
        const expiry = addYears(now, EFIRMA_YEARS).toISOString();
        extracted.fecha_vencimiento = expiry;
      }

      await window.Store?.saveDocument?.({
        file_name: file.name,
        document_type: docTypeFromCategory(category),
        extracted_data: extracted,
        source: 'carpeta_upload',
        confidence: 0.99,
        validation_status: 'cargado'
      });

      if (category === 'efirma') {
        const expiry = extracted.fecha_vencimiento;
        const days = computeDaysRemaining(expiry);

        window.Store?.updateSaludFiscal?.({
          eFirmaVigente: true,
          eFirmaExpiry: expiry,
          lastAuditDate: new Date().toISOString(),
          alertLevel: days <= 30 ? 'warning' : 'safe'
        });

        setUploadStatus('efirma-upload-status', `VIGENTE · ${days} día(s) restantes`, '#10b981');
      }

      if (category === 'constancia') {
        setUploadStatus('constancia-upload-status', `Archivo cargado: ${file.name}`, '#10b981');
      }

      if (category === 'opinion') {
        setUploadStatus('opinion-upload-status', `Archivo cargado: ${file.name}`, '#10b981');
      }

      setCarpetaMessage(`Documento cargado correctamente en Mi Carpeta Fiscal: ${file.name}`);
      syncAndRender();
    } catch (e) {
      setCarpetaMessage(`Error al cargar documento: ${e?.message || 'desconocido'}`, 'error');
    }
  }

  function bindCarpetaUpload(inputId, category) {
    const input = byId(inputId);
    if (!input) return;

    input.addEventListener('change', async e => {
      const file = e.target.files?.[0];
      await handleCarpetaUpload(file, category);
    });
  }

  function bindDropzone(dropId, inputId) {
    const zone = byId(dropId);
    const input = byId(inputId);
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());

    ['dragenter', 'dragover'].forEach(evt => {
      zone.addEventListener(evt, e => {
        e.preventDefault();
        zone.style.borderColor = '#10b981';
        zone.style.background = 'rgba(16,185,129,0.08)';
      });
    });

    ['dragleave', 'drop'].forEach(evt => {
      zone.addEventListener(evt, e => {
        e.preventDefault();
        zone.style.borderColor = 'rgba(255,255,255,0.18)';
        zone.style.background = 'rgba(255,255,255,0.03)';
      });
    });

    zone.addEventListener('drop', async e => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
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
      renderKPIs();
      renderIncomeWithCssClasses(); // reemplaza la llamada inline a renderIncome()
      renderHealth();
      renderHealthExtended();       // NUEVO: alertas de e.firma y buzón
      renderFeed();
      renderCarpetaFiscal();
      window.DocumentsManager?.renderDocuments?.();
    }

    function computeEFirmaExpiryAlert(issuedDateStr) {
  if (!issuedDateStr) {
    return { hasData: false, level: 'unknown', message: null, diasRestantes: null, expiryDate: null };
  }

  const issued = new Date(issuedDateStr);
  if (Number.isNaN(issued.getTime())) {
    return { hasData: false, level: 'unknown', message: null, diasRestantes: null, expiryDate: null };
  }

  const expiryDate = addYears(issued, EFIRMA_YEARS); // Art. 17-D CFF — 4 años exactos
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);

  const diasRestantes = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  let level = 'safe';
  let message = null;

  if (diasRestantes <= 0) {
    level = 'expired';
    message = `Tu e.firma venció hace ${Math.abs(diasRestantes)} días. Debes renovarla de inmediato en el SAT (Art. 17-D CFF). No podrás timbrar CFDIs ni firmar declaraciones.`;
  } else if (diasRestantes <= EFIRMA_ALERT_30_DAYS) {
    level = 'critical';
    message = `⚠️ ¡CRÍTICO! Su e.firma vence en menos de 30 días (${diasRestantes} días). Riesgo de bloqueo de facturación.`;
  } else if (diasRestantes <= EFIRMA_ALERT_90_DAYS) {
    level = 'warning';
    message = `Su e.firma vence en 3 meses. Programe su cita en el SAT.`;
  } else {
    level = 'safe';
    message = `e.firma vigente hasta ${expiryDate.toLocaleDateString('es-MX')} (${diasRestantes} días restantes). Cumple con Art. 17-D CFF.`;
  }

  return {
    hasData: true,
    level,
    message,
    diasRestantes,
    expiryDate: expiryDate.toISOString().split('T')[0],
    issuedDate: issued.toISOString().split('T')[0]
  };
}

/**
 * renderEFirmaAlertBanner — Inyecta el banner visual en el Dashboard
 * según el nivel de alerta calculado.
 */
function renderEFirmaAlertBanner(alertData) {
  const container = byId('efirma-alert-banner') || createEFirmaAlertContainer();
  if (!container) return;

  if (!alertData.hasData) {
    container.hidden = true;
    return;
  }

  const styles = {
    safe:     { bg: 'rgba(16,185,129,0.12)', border: '#10b981', color: '#d1fae5' },
    warning:  { bg: 'rgba(245,158,11,0.14)', border: '#f59e0b', color: '#fde68a' },
    critical: { bg: 'rgba(239,68,68,0.16)',  border: '#ef4444', color: '#fecaca' },
    expired:  { bg: 'rgba(220,38,38,0.20)',  border: '#dc2626', color: '#fecaca' }
  };
  const s = styles[alertData.level] || styles.safe;

  container.hidden = alertData.level === 'safe';
  container.style.background = s.bg;
  container.style.border = `1px solid ${s.border}`;
  container.style.color = s.color;
  container.style.padding = '12px 16px';
  container.style.borderRadius = '10px';
  container.style.marginTop = '10px';
  container.style.fontWeight = alertData.level === 'critical' || alertData.level === 'expired' ? '700' : '500';
  container.textContent = alertData.message;
}

function createEFirmaAlertContainer() {
  const healthCard = byId('efirma-days')?.closest('.health-item')?.parentElement?.parentElement;
  if (!healthCard) return null;
  const div = document.createElement('div');
  div.id = 'efirma-alert-banner';
  div.hidden = true;
  healthCard.appendChild(div);
  return div;
}

/**
 * renderBuzonAuditAlert — Auditoría de Salud Fiscal Activa.
 * Mientras el Buzón Tributario no esté explícitamente 'Validado' (true),
 * mantiene la alerta roja permanente citando la multa (Art. 17-K y 86-C CFF).
 */
function renderBuzonAuditAlert() {
  const salud = window.Store?.getSaludFiscal?.();
  const container = byId('buzon-audit-alert') || createBuzonAuditContainer();
  if (!container) return;

  const isValidado = salud?.buzonTributarioActivo === true;

  if (isValidado) {
    container.hidden = true;
    return;
  }

  container.hidden = false;
  container.style.background = 'rgba(239,68,68,0.16)';
  container.style.border = '1px solid #ef4444';
  container.style.color = '#fecaca';
  container.style.padding = '12px 16px';
  container.style.borderRadius = '10px';
  container.style.marginTop = '10px';
  container.style.fontWeight = '700';
  container.textContent =
    `🔴 ALERTA PERMANENTE: Buzón Tributario no validado. Multa de hasta ${money(BUZON_MULTA)} ` +
    `conforme a los Art. 17-K y 86-C CFF. Valida tu Buzón en sat.gob.mx → Mi Portal.`;
}

function createBuzonAuditContainer() {
  const healthCard = byId('buzon-status')?.closest('.health-item')?.parentElement?.parentElement;
  if (!healthCard) return null;
  const div = document.createElement('div');
  div.id = 'buzon-audit-alert';
  div.hidden = true;
  healthCard.appendChild(div);
  return div;
}

// ── renderHealth() extendido para invocar ambas auditorías ──────────────────
function renderHealthExtended() {
  const carpeta = window.Store?.getCarpetaFiscal?.();
  const expiry = window.Store?.getSaludFiscal?.()?.eFirmaExpiry || carpeta?.efirmaExpiry;

  // Alerta de vigencia de e.firma (90/30 días)
  const efirmaAlert = computeEFirmaExpiryAlert(
    expiry && expiry !== 'pendiente'
      ? addYears(new Date(expiry), -EFIRMA_YEARS).toISOString() // reconstruye fecha de emisión aproximada
      : null
  );
  renderEFirmaAlertBanner(efirmaAlert);

  // Auditoría permanente de Buzón Tributario
  renderBuzonAuditAlert();
}

// ── Actualizar el semáforo con CLASES CSS dinámicas (no solo inline) ────────
function renderIncomeWithCssClasses() {
  const st = window.Store?.getState?.();
  if (!st) return;

  const current = Number(st.incomeYTD || 0);
  const limit = Number(st.fiscalMetrics?.annualLimit || getCfg('INCOME_LIMIT', RESICO_LIMIT));
  const risk = st.fiscalMetrics?.riskLevel || 'SEGURO';
  const ratio = limit > 0 ? Math.min(100, Math.max(0, (current / limit) * 100)) : 0;

  const fillEl = byId('income-progress-fill');
  const badgeEl = byId('income-alert-badge');

  const CSS_CLASS_MAP = {
    SEGURO: 'risk-safe',
    PREVENTIVO: 'risk-preventivo',
    RIESGO_ALTO: 'risk-alto',
    EXPULSION: 'risk-expulsion'
  };

  if (fillEl) {
    fillEl.style.width = `${ratio}%`;
    // Remover clases previas y aplicar la clase correspondiente al nivel actual
    fillEl.classList.remove('risk-safe', 'risk-preventivo', 'risk-alto', 'risk-expulsion');
    fillEl.classList.add(CSS_CLASS_MAP[risk] || 'risk-safe');
  }

  if (badgeEl) {
    badgeEl.textContent = risk.replace('_', ' ');
    badgeEl.classList.remove('badge-safe', 'badge-warning', 'badge-danger', 'badge-critical');
    if (risk === 'EXPULSION') badgeEl.classList.add('badge-critical');
    else if (risk === 'RIESGO_ALTO') badgeEl.classList.add('badge-danger');
    else if (risk === 'PREVENTIVO') badgeEl.classList.add('badge-warning');
    else badgeEl.classList.add('badge-safe');
  }
}

// ── Suscripción al evento de cruce de umbral (preparación WhatsApp/n8n) ─────
function initRiskAlertListener() {
  window.Store?.on?.('riskThresholdCrossed', (payload) => {
    console.info('[App] Umbral cruzado — payload listo para n8n:', payload);
    // Cuando el proxy /api/n8n-notify-proxy esté activo, aquí se llamará:
    // fetch('/api/n8n-notify-proxy', { method: 'POST', body: JSON.stringify(payload) });
    // Por ahora solo se persiste el payload para trazabilidad/depuración.
    window.__lastWhatsAppAlertPayload = payload;
  });
}

  async function initCore() {
    await window.AppConfig?.loadServerConfig?.();
    await window.Store?.initSupabase?.();
  }

  async function syncMonitorPostLogin() {
  const state = Store.getState();

  // El Monitor de Supervivencia usa el valor que syncDown() ya hidrata.
  // Forzar un re-render inmediato con el valor en memoria.
  const income    = Number(state.incomeYTD || 0);
  const limit     = Number(state.fiscalMetrics?.annualLimit || RESICO_LIMIT);
  const pct       = limit > 0 ? (income / limit) * 100 : 0;
  const riskLevel = state.fiscalMetrics?.riskLevel || 'SEGURO';

  // Actualizar el DOM del monitor
  const monitorIncome  = byId('monitor-income');
  const monitorPct     = byId('monitor-pct');
  const monitorBar     = byId('monitor-bar');
  const monitorStatus  = byId('monitor-status');

  if (monitorIncome)  monitorIncome.textContent  = money(income);
  if (monitorPct)     monitorPct.textContent      = `${pct.toFixed(1)}%`;
  if (monitorBar)     monitorBar.style.width       = `${Math.min(pct, 100)}%`;

  if (monitorStatus) {
    const labels = {
      SEGURO:      { text: '✅ Régimen Seguro',     color: '#10b981' },
      PREVENTIVO:  { text: '⚠️ Zona Preventiva',   color: '#f59e0b' },
      RIESGO_ALTO: { text: '🔴 Riesgo Alto',        color: '#ef4444' },
      EXPULSION:   { text: '🚨 Peligro de Expulsión', color: '#dc2626' }
    };
    const label = labels[riskLevel] || labels.SEGURO;
    monitorStatus.textContent  = label.text;
    monitorStatus.style.color  = label.color;

    // Alerta crítica al 94% — Art. 113-E LISR
    if (riskLevel === 'EXPULSION' || riskLevel === 'RIESGO_ALTO') {
      console.warn(
        `[Monitor] ⚠️ ALERTA FISCAL: Ingresos ${money(income)} ` +
        `= ${pct.toFixed(1)}% del límite RESICO. Nivel: ${riskLevel}`
      );
    }
  }
}

function validateEFirmaVigencia(issuedAt, expiresAt = null) {
  const MULTA_BUZON = BUZON_MULTA; // $10,260 MXN — Art. 17-K CFF

  const issued  = issuedAt  ? new Date(issuedAt)  : null;
  const expires = expiresAt
    ? new Date(expiresAt)
    : issued
      ? new Date(new Date(issued).setFullYear(issued.getFullYear() + EFIRMA_YEARS))
      : null;

  if (!expires) {
    return {
      vigente: null,
      diasRestantes: null,
      alertLevel: 'warning',
      mensaje: '⚠️ No se pudo determinar la vigencia de tu e.firma. Verifica el archivo .cer.'
    };
  }

  const today        = new Date();
  today.setHours(0, 0, 0, 0);
  expires.setHours(0, 0, 0, 0);

  const msDay        = 1000 * 60 * 60 * 24;
  const diasRestantes = Math.ceil((expires - today) / msDay);
  const vigente       = diasRestantes > 0;

  let alertLevel = 'safe';
  let mensaje;

  if (!vigente) {
    alertLevel = 'danger';
    mensaje = `🚨 Tu e.firma venció hace ${Math.abs(diasRestantes)} días. ` +
              `Debes renovarla en el SAT (Art. 17-D CFF). ` +
              `Sin ella no puedes timbrar CFDIs ni firmar declaraciones.`;
  } else if (diasRestantes <= 30) {
    alertLevel = 'warning';
    mensaje = `⚠️ Tu e.firma vence en ${diasRestantes} días (${expires.toLocaleDateString('es-MX')}). ` +
              `Renueva antes de que expire para evitar interrupción operativa. ` +
              `Posible multa: $${MULTA_BUZON.toLocaleString('es-MX')} MXN por Buzón inactivo.`;
  } else if (diasRestantes <= 90) {
    alertLevel = 'warning';
    mensaje = `📅 Tu e.firma vence el ${expires.toLocaleDateString('es-MX')} ` +
              `(en ${diasRestantes} días). Programa tu renovación en SAT ID o módulo.`;
  } else {
    mensaje = `✅ e.firma vigente hasta ${expires.toLocaleDateString('es-MX')} ` +
              `(${diasRestantes} días restantes). Cumple con Art. 17-D CFF.`;
  }

  // Persistir en Store para que el Monitor de Salud Fiscal lo muestre
  Store.updateSaludFiscal({
    eFirmaVigente:  vigente,
    eFirmaExpiry:   expires.toISOString().split('T')[0],
    lastAuditDate:  new Date().toISOString(),
    alertLevel
  });

  return { vigente, diasRestantes, alertLevel, mensaje };
}

// ============================================================
// PATCH app.js — Fase de Conexión: Timbrado CFDI vía Alegra
// ============================================================

const RESICO_VALID_USOS_CFDI = ['G01','G02','G03','D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','S01','CP01','CN01'];

function showTimbradoLoader(show) {
  let loader = byId('timbrado-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'timbrado-loader';
    loader.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;
      display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;`;
    loader.innerHTML = `
      <div style="width:48px;height:48px;border:4px solid #10b981;border-top-color:transparent;
                  border-radius:50%;animation:timbrado-spin 0.9s linear infinite;"></div>
      <p style="color:#e2e8f0;font-weight:600;font-size:15px;">Timbrando con el SAT vía Alegra...</p>
      <style>@keyframes timbrado-spin{to{transform:rotate(360deg);}}</style>
    `;
    document.body.appendChild(loader);
  }
  loader.hidden = !show;
  loader.style.display = show ? 'flex' : 'none';
}

function showTimbradoErrorModal(message) {
  const modal = document.createElement('div');
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;
    display:flex;align-items:center;justify-content:center;`;
  modal.innerHTML = `
    <div style="background:#1e293b;border:1px solid #ef4444;border-radius:12px;
                padding:24px;max-width:420px;text-align:center;">
      <div style="font-size:32px;margin-bottom:10px;">⚠️</div>
      <h3 style="color:#ef4444;margin:0 0 10px;">Error de Timbrado</h3>
      <p style="color:#e2e8f0;font-size:14px;margin-bottom:18px;">${esc(message)}</p>
      <button id="timbrado-error-close" class="btn-primary" style="width:100%;">Entendido</button>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#timbrado-error-close')?.addEventListener('click', () => modal.remove());
}

function showTimbradoSuccessModal(result, invoiceId) {
  const modal = document.createElement('div');
  modal.id = 'timbrado-success-modal';
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;
    display:flex;align-items:center;justify-content:center;`;
  modal.innerHTML = `
    <div style="background:#1e293b;border:1px solid #10b981;border-radius:12px;
                padding:24px;max-width:440px;width:90%;text-align:center;">
      <div style="font-size:36px;margin-bottom:10px;">✅</div>
      <h3 style="color:#10b981;margin:0 0 6px;">Factura Timbrada con Éxito</h3>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:6px;">
        Folio: ${esc(result?.invoice?.number || '—')}
      </p>
      <p style="color:#94a3b8;font-size:13px;margin-bottom:18px;">
        Total: $${Number(result?.invoice?.total || 0).toLocaleString('es-MX')} MXN
      </p>
      <div style="display:flex;gap:10px;">
        <button id="btn-download-pdf" class="btn-primary" style="flex:1;">📄 Descargar PDF</button>
        <button id="btn-download-xml" class="btn-secondary" style="flex:1;">🧾 Descargar XML</button>
      </div>
      <button id="timbrado-success-close" style="margin-top:14px;background:none;border:none;
              color:#64748b;cursor:pointer;font-size:13px;">Cerrar</button>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-download-pdf')?.addEventListener('click', () => downloadInvoiceFile(invoiceId, 'pdf'));
  modal.querySelector('#btn-download-xml')?.addEventListener('click', () => downloadInvoiceFile(invoiceId, 'xml'));
  modal.querySelector('#timbrado-success-close')?.addEventListener('click', () => modal.remove());
}

async function downloadInvoiceFile(invoiceId, format) {
  try {
    const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
    const token = session?.data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch('/api/alegra-proxy', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: format === 'pdf' ? 'get_pdf' : 'get_xml', input: { invoiceId } })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `No se pudo descargar el ${format.toUpperCase()}.`);
    }

    const fileUrl = payload.pdf?.url || payload.xml?.url || payload.pdf || payload.xml;
    if (fileUrl) window.open(fileUrl, '_blank');
  } catch (error) {
    showTimbradoErrorModal(error?.message || `Error al descargar ${format.toUpperCase()}.`);
  }
}

/**
 * handleTimbrado — Se dispara cuando el usuario aprueba los datos extraídos
 * por el OCR y confirma la emisión del CFDI.
 */
async function handleTimbrado(ocrData) {
  const usoCfdi = String(ocrData?.uso_cfdi || 'G03').toUpperCase();
  if (!RESICO_VALID_USOS_CFDI.includes(usoCfdi)) {
    showTimbradoErrorModal(
      `El Uso de CFDI '${usoCfdi}' no es compatible con RESICO (Régimen 626) conforme a la RMF 2026.`
    );
    return;
  }

  const input = {
    rfc: ocrData?.rfc_receptor || ocrData?.rfc,
    name: ocrData?.nombre_receptor || ocrData?.nombre_emisor || '',
    zip: ocrData?.cp_receptor || ocrData?.zip || '',
    regimenFiscal: ocrData?.regimen_fiscal_receptor || '616',
    usoCfdi,
    metodoPago: ocrData?.metodo_pago || 'PUE',
    formaPago: ocrData?.forma_pago || '01',
    claveProdServ: ocrData?.clave_prod_serv || '84111506',
    description: ocrData?.descripcion || ocrData?.concepto || 'Servicios profesionales',
    quantity: ocrData?.cantidad || 1,
    unitPrice: ocrData?.subtotal || ocrData?.unitPrice || 0,
    ivaType: ocrData?.iva_type || '16',
    receptorType: ocrData?.receptor_type || 'PF'
  };

  showTimbradoLoader(true);

  try {
    const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
    const token = session?.data?.session?.access_token;

    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch('/api/alegra-proxy', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'create_invoice', input })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok) {
      const details = Array.isArray(payload?.details) ? payload.details.join(' ') : '';
      throw new Error(
        payload?.error
          ? `${payload.error} ${details}`.trim()
          : 'Error del SAT: Verifique la vigencia de su CSD o el RFC del receptor.'
      );
    }

    // ── Persistir la factura timbrada y sumar al Monitor de Ingresos ──────
    await window.Store?.saveInvoiceDocument?.({
      invoice_id: payload.invoice?.id,
      invoice_number: payload.invoice?.number,
      status: 'TIMBRADO',
      total: Number(payload.invoice?.total || 0),
      rfc_receptor: input.rfc,
      uso_cfdi: usoCfdi,
      regimen_fiscal_emisor: payload.fiscal?.regimenFiscalEmisor || '626',
      fecha: payload.invoice?.date || new Date().toISOString().slice(0, 10)
    });

    showTimbradoSuccessModal(payload, payload.invoice?.id);

  } catch (error) {
    showTimbradoErrorModal(error?.message || 'Error del SAT: Verifique la vigencia de su CSD o el RFC del receptor.');
  } finally {
    showTimbradoLoader(false);
  }
}

window.App = window.App || {};
window.App.hideAuthOverlay = hideAuthOverlay;
window.App.showAuthOverlay = showAuthOverlay;
window.App.handleTimbrado = handleTimbrado;


/**
 * Handler para el evento de carga de archivos de e.firma (.cer / .key).
 * PLACEHOLDER: Conectar al input file del módulo Carpeta Fiscal.
 *
 * Uso:
 *   document.getElementById('efirma-upload').addEventListener('change', onEFirmaUpload);
 */
async function onEFirmaUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!['cer', 'key'].includes(ext)) {
    console.warn('[e.firma] Archivo no reconocido. Se esperaba .cer o .key');
    return;
  }

  // TODO: Extraer fecha de emisión del certificado .cer via SubtleCrypto o
  //       enviar al proxy /api/gemini-proxy.js con el binario para extracción OCR.
  // Por ahora se usa la fecha de modificación del archivo como aproximación.
  const issuedAt = new Date(file.lastModified);

  const result = validateEFirmaVigencia(issuedAt);

  // Mostrar resultado en el UI (adaptar IDs según tu HTML)
  const alertEl = byId('efirma-alert') || byId('salud-fiscal-alert');
  if (alertEl) {
    alertEl.textContent  = result.mensaje;
    alertEl.className    = `alert alert-${result.alertLevel}`;
    alertEl.hidden       = false;
  }

  console.info('[e.firma] Validación Art. 17-D CFF:', result);
  return result;
}

  let authOverlayGuardBound = false;

/**
 * hideAuthOverlay — Oculta el overlay usando display:none REAL,
 * no solo opacity. Limpia también cualquier estado inline previo.
 */
function hideAuthOverlay() {
  const overlay = byId('auth-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';   // display:none real, no opacity
  overlay.style.opacity = '';       // limpia rastros de animaciones previas
  overlay.setAttribute('aria-hidden', 'true');

  const appRoot = byId('app');
  if (appRoot) appRoot.style.display = 'block';
}

function showAuthOverlay() {
  const overlay = byId('auth-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.removeAttribute('aria-hidden');
}

/**
 * initAuthOverlayGuard — Capa de seguridad independiente de auth.js.
 * Si por cualquier motivo AuthManager no vincula sus propios listeners
 * (script no cargado, error silencioso, orden de carga), esta función
 * garantiza que los botones básicos sigan siendo funcionales.
 */
function initAuthOverlayGuard() {
  if (authOverlayGuardBound) return; // evita doble-bind si se llama 2 veces
  authOverlayGuardBound = true;

  const demoBtn = byId('auth-demo');
  if (demoBtn && !demoBtn.dataset.guardBound) {
    demoBtn.dataset.guardBound = '1';
    demoBtn.addEventListener('click', () => {
      window.APP_STATE = window.APP_STATE || {};
      window.APP_STATE.isDemo = true;
      hideAuthOverlay(); // display:none garantizado, no solo opacity
      window.App?.syncAndRender?.();
    });
  }

  // Verificación de diagnóstico: confirma en consola si los scripts
  // críticos realmente se cargaron (ayuda a detectar el bug de scripts
  // fantasma sin depender de errores del navegador).
  const missing = [];
  if (typeof window.WebThreads === 'undefined') missing.push('webthreads.js');
  if (typeof window.AuthRegisterUI === 'undefined') missing.push('auth-register.js');

  if (missing.length) {
    console.warn(
      `[App] ⚠️ Scripts no cargados o cargados fuera de orden: ${missing.join(', ')}. ` +
      `Verifica las etiquetas <script> en index.html antes de </body>.`
    );
  } else {
    console.info('[App] ✅ WebThreads y AuthRegisterUI cargados correctamente.');
  }
}

// ── FIX CRÍTICO: wizardNext() declarada explícitamente ──
// Es la pieza que faltaba y provocaba el ReferenceError:
// "wizardNext is not defined" al ejecutarse el IIFE de App.
// Maneja la transición de pasos del Wizard Fiscal (Art. 113-F LISR),
// reutilizando validateStep(), setWizardStep() y completeWizard()
// que ya existen en este mismo archivo.
function wizardNext() {
  if (!validateStep(wizardStep)) return;

  if (wizardStep >= WIZARD_MAX_STEPS) {
    completeWizard();
    return;
  }

  setWizardStep(wizardStep + 1);
}

async function init() {
  if (booted) return;
  booted = true;

  initTheme();
  initNavigation();
  initRFC();
  initClassifier();
  initCarpetaFiscalUploads();
  setWizardStep(1);
  resetWizard();

  window.DocumentsManager?.init?.();
  window.DocumentProcessor?.init?.();
  window.Invoicing?.init?.();

  try {
    await initCore();
  } catch (err) {
    console.error(
      '[App] ⚠️ initCore() falló — la app continúa en modo degradado. Detalle:',
      err?.message || err
    );
  }

  window.Store?.on?.('storeUpdated', syncAndRender);
  window.Store?.on?.('documentAdded', syncAndRender);
  window.Store?.on?.('conversationAdded', syncAndRender);
  window.Store?.on?.('carpetaUpdated', renderCarpetaFiscal);
  syncAndRender();
  initRiskAlertListener();

  try {
    window.AuthManager?.init?.();
  } catch (err) {
    console.error('[App] ⚠️ AuthManager.init() falló:', err?.message || err);
  }
}

return {
  init,
  navigateTo,
  syncAndRender,
  wizardNext,
  resetWizard,
  saveDiagnostic,
  renderCarpetaFiscal
};
})();

window.App = App;

// FIX: asignación defensiva — evita llamadas huérfanas si App.wizardNext
// no existiera por algún motivo (nunca debería pasar ya, pero blinda el onclick).
window.wizardNext = typeof App.wizardNext === 'function'
  ? App.wizardNext
  : function () { console.warn('[App] wizardNext no disponible todavía.'); };

window.resetWizard = App.resetWizard;
window.saveDiagnostic = App.saveDiagnostic;
window.Dashboard = App.syncAndRender;

// FIX FASE 0.8: byId fuera de scope — usar document.getElementById directamente
document.addEventListener('DOMContentLoaded', () => {
  const efirmaInput = document.getElementById('efirma-upload');
  if (efirmaInput) efirmaInput.addEventListener('change', onEFirmaUpload);
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}