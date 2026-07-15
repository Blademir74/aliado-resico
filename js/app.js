const App = (() => {
  const VIEWS = ['dashboard', 'wizard', 'classifier', 'documents', 'invoicing', 'carpeta'];
  const EFOS_KEY = 'ar_efos_watchlist_v1';
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
    const cfg = Array.isArray(window.RESICO_CONFIG?.EFOS_RFC_LIST) ? window.RESICO_CONFIG.EFOS_RFC_LIST : [];
    const local = loadLocalEFOSList();
    const all = [...cfg, ...local]
      .map(v => String(v || '').trim().toUpperCase())
      .filter(Boolean);
    return [...new Set(all)];
  }

  function classifyRFCDeep(rfc) {
    const clean = String(rfc || '').trim().toUpperCase();
    const genericNational = 'XAXX010101000';
    const genericForeign = 'XEXX010101000';
    const efosSet = new Set(getEFOSWatchlist());

    if (!clean) {
      return { ok: false, message: 'Ingresa un RFC.' };
    }

    if (clean === genericNational) {
      return {
        ok: true,
        valid: true,
        type: 'GENÉRICO NACIONAL',
        risk: 'warning',
        efos: false,
        message: `RFC válido: ${clean}`,
        detail: 'Uso general en operaciones con público en general.'
      };
    }

    if (clean === genericForeign) {
      return {
        ok: true,
        valid: true,
        type: 'GENÉRICO EXTRANJERO',
        risk: 'warning',
        efos: false,
        message: `RFC válido: ${clean}`,
        detail: 'Uso para operaciones con residentes en el extranjero.'
      };
    }

    const pf = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;
    const pm = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;

    if (!pf.test(clean) && !pm.test(clean)) {
      return {
        ok: false,
        valid: false,
        message: 'Formato inválido.',
        detail: 'El RFC no coincide con estructura de Persona Física ni Persona Moral.'
      };
    }

    const type = pf.test(clean) ? 'PERSONA FÍSICA' : 'PERSONA MORAL';
    const efos = efosSet.has(clean);

    if (efos) {
      return {
        ok: true,
        valid: true,
        type,
        efos: true,
        risk: 'danger',
        message: `RFC válido con alerta crítica: ${clean}`,
        detail: 'El RFC coincide con la watchlist EFOS configurada. Revisión obligatoria antes de acreditar IVA o facturar en automático.'
      };
    }

    return {
      ok: true,
      valid: true,
      type,
      efos: false,
      risk: 'safe',
      message: `RFC válido: ${clean}`,
      detail: `Estructura detectada de ${type}. Sin coincidencia en watchlist EFOS.`
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
        <div style="font-size:13px;margin-top:8px;">
          ${result.efos ? 'Alerta EFOS en watchlist local/configurada.' : 'Sin coincidencia EFOS en watchlist local/configurada.'}
        </div>
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
    if (confidence) confidence.textContent = `${Number(metrics.avgConfidence || 0)}%`;
    if (autoRate) autoRate.textContent = `${Number(metrics.autoResolutionRate || 92)}%`;
    if (responseTime) responseTime.textContent = `${Number(metrics.avgResponseTime || 2.3)}s`;
  }

  function renderIncome() {
    const st = window.Store?.getState?.();
    if (!st) return;

    const current = Number(st.incomeYTD || 0);
    const limit = Number(st.fiscalMetrics?.annualLimit || getCfg('INCOME_LIMIT', 3500000));
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
      fillEl.style.background = risk === 'EXPULSION'
        ? '#ef4444'
        : risk === 'RIESGO_ALTO'
          ? '#f97316'
          : risk === 'PREVENTIVO'
            ? '#f59e0b'
            : '#10b981';
    }

    if (badgeEl) {
      badgeEl.textContent = risk;
      badgeEl.className = risk === 'EXPULSION'
        ? 'badge-danger'
        : risk === 'RIESGO_ALTO' || risk === 'PREVENTIVO'
          ? 'badge-warning'
          : 'badge-safe';
    }

    if (msgEl) {
      if (risk === 'EXPULSION') msgEl.innerHTML = '<span style="color:#fecaca;">Riesgo crítico: zona de expulsión del régimen.</span>';
      else if (risk === 'RIESGO_ALTO') msgEl.innerHTML = '<span style="color:#fdba74;">Riesgo alto: revisa ingresos cobrados y cierre mensual.</span>';
      else if (risk === 'PREVENTIVO') msgEl.innerHTML = '<span style="color:#fde68a;">Alerta preventiva: ya superaste el 80% del límite anual.</span>';
      else msgEl.innerHTML = '<span style="color:#86efac;">Sin riesgo actual.</span>';
    }
  }

  function renderHealth() {
    const salud = window.Store?.getSaludFiscal?.() || {};
    const buzonStatus = byId('buzon-status');
    const efirmaStatus = byId('efirma-status');
    const efirmaDays = byId('efirma-days');
    const opinionStatus = byId('opinion-status');
    const healthAlert = byId('health-alert');

    if (buzonStatus) {
      buzonStatus.textContent = salud.buzonTributarioActivo === true
        ? 'Activo'
        : salud.buzonTributarioActivo === false ? 'Inactivo' : 'Verificando...';
      buzonStatus.style.color = salud.buzonTributarioActivo === false ? '#f59e0b' : '#10b981';
    }

    if (efirmaStatus) {
      efirmaStatus.textContent = salud.eFirmaVigente === true
        ? 'Vigente'
        : salud.eFirmaVigente === false ? 'Vencida' : 'Verificando...';
      efirmaStatus.style.color = salud.eFirmaVigente === false ? '#ef4444' : '#10b981';
    }

    if (efirmaDays) efirmaDays.textContent = salud.eFirmaExpiry || '-- días restantes';

    if (opinionStatus) {
      opinionStatus.textContent = salud.alertLevel === 'danger'
        ? 'Revisar urgente'
        : salud.alertLevel === 'warning' ? 'Pendiente' : 'No consultada';
      opinionStatus.style.color = salud.alertLevel === 'danger'
        ? '#ef4444'
        : salud.alertLevel === 'warning' ? '#f59e0b' : '#94a3b8';
    }

    if (healthAlert) {
      const needsAlert = salud.buzonTributarioActivo === false || salud.eFirmaVigente === false;
      healthAlert.hidden = !needsAlert;
      if (needsAlert) {
        healthAlert.textContent = 'Atención: regulariza Buzón Tributario y e.firma para evitar multas y pérdida de plazos.';
      }
    }
  }

  function renderFeed() {
    const feed = byId('feed-list');
    if (!feed) return;

    const st = window.Store?.getState?.();
    if (!st) return;

    const conversations = (st.conversations || []).slice(0, 4).map(item => ({
      at: item.timestamp || Date.now(),
      title: item.intent || 'OTROS',
      detail: item.message_text || item.text || 'Consulta'
    }));

    const documents = (st.documents || []).slice(0, 4).map(item => ({
      at: new Date(item.created_at || Date.now()).getTime(),
      title: item.document_type || item.doc_type || 'OTRO',
      detail: item.file_name || 'Documento'
    }));

    const items = [...conversations, ...documents]
      .sort((a, b) => b.at - a.at)
      .slice(0, 6);

    if (!items.length) {
      feed.innerHTML = '<p class="feed-empty" style="color:#94a3b8;">Sin actividad.</p>';
      return;
    }

    feed.innerHTML = items.map(item => `
      <div style="padding:12px;border-radius:12px;background:rgba(255,255,255,0.04);margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <strong style="color:#e2e8f0;">${esc(item.title)}</strong>
          <span style="color:#94a3b8;font-size:12px;">${new Date(item.at).toLocaleString('es-MX')}</span>
        </div>
        <div style="color:#94a3b8;font-size:13px;margin-top:4px;">${esc(item.detail).slice(0, 160)}</div>
      </div>
    `).join('');
  }

  function renderCategoryList(items = [], emptyLabel) {
    if (!items.length) return `<div style="color:#64748b;font-size:13px;">${esc(emptyLabel)}</div>`;
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

  function renderCarpetaFiscal() {
    const carpeta = window.Store?.getCarpetaFiscal?.() || {};
    const summaryEl = byId('carpeta-summary');
    const monthsEl = byId('carpeta-months');
    if (!summaryEl || !monthsEl) return;

    const totals = carpeta.summary || { total: 0, ingresos: 0, gastos_iva: 0, efirma: 0, constancia: 0, opinion: 0 };

    summaryEl.innerHTML = `
      <div class="health-grid">
        <div class="health-item"><div style="font-size:12px;color:#94a3b8;">Total documentos</div><div style="font-size:22px;color:#e2e8f0;font-weight:700;">${Number(totals.total || 0)}</div></div>
        <div class="health-item"><div style="font-size:12px;color:#94a3b8;">Ingresos</div><div style="font-size:22px;color:#e2e8f0;font-weight:700;">${Number(totals.ingresos || 0)}</div></div>
        <div class="health-item"><div style="font-size:12px;color:#94a3b8;">Gastos IVA</div><div style="font-size:22px;color:#e2e8f0;font-weight:700;">${Number(totals.gastos_iva || 0)}</div></div>
        <div class="health-item"><div style="font-size:12px;color:#94a3b8;">e.firma</div><div style="font-size:22px;color:#e2e8f0;font-weight:700;">${Number(totals.efirma || 0)}</div></div>
        <div class="health-item"><div style="font-size:12px;color:#94a3b8;">Constancia</div><div style="font-size:22px;color:#e2e8f0;font-weight:700;">${Number(totals.constancia || 0)}</div></div>
        <div class="health-item"><div style="font-size:12px;color:#94a3b8;">Opinión</div><div style="font-size:22px;color:#e2e8f0;font-weight:700;">${Number(totals.opinion || 0)}</div></div>
      </div>
      <div style="margin-top:16px;color:#94a3b8;font-size:13px;">
        Última actualización: ${esc(carpeta.lastUpdated || '—')}
      </div>
    `;

    const folders = Array.isArray(carpeta.monthlyFolders) ? carpeta.monthlyFolders : [];
    monthsEl.innerHTML = folders.map(folder => `
      <details style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px;margin-bottom:12px;" ${folder.monthNumber === new Date().getMonth() + 1 ? 'open' : ''}>
        <summary style="cursor:pointer;color:#e2e8f0;font-weight:700;">
          ${esc(folder.monthName)} ${esc(folder.year)} · ${folder.total} documento(s)
        </summary>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:14px;">
          <div><div style="color:#10b981;font-weight:700;margin-bottom:8px;">Ingresos (${folder.categories.ingresos.length})</div>${renderCategoryList(folder.categories.ingresos, 'Sin documentos de ingreso.')}</div>
          <div><div style="color:#38bdf8;font-weight:700;margin-bottom:8px;">Gastos IVA acreditable (${folder.categories.gastos_iva.length})</div>${renderCategoryList(folder.categories.gastos_iva, 'Sin gastos acreditables.')}</div>
          <div><div style="color:#f59e0b;font-weight:700;margin-bottom:8px;">e.firma (${folder.categories.efirma.length})</div>${renderCategoryList(folder.categories.efirma, 'Sin archivos de e.firma.')}</div>
          <div><div style="color:#a78bfa;font-weight:700;margin-bottom:8px;">Constancia (${folder.categories.constancia.length})</div>${renderCategoryList(folder.categories.constancia, 'Sin constancia cargada.')}</div>
          <div><div style="color:#f472b6;font-weight:700;margin-bottom:8px;">Opinión (${folder.categories.opinion.length})</div>${renderCategoryList(folder.categories.opinion, 'Sin opinión cargada.')}</div>
        </div>
      </details>
    `).join('');
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
    if (conf) conf.textContent = `${Math.round(Number(result.confidence || 0) * 100)}%`;
    if (keywords) keywords.textContent = (result.keywordsMatched || []).join(', ') || '—';
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

      appendChatMessage(result.assistantReply || 'Sin respuesta.', 'bot');
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
        const prompt = btn.getAttribute('data-prompt') || '';
        if (input) input.value = prompt;
        handleClassifierSubmit(prompt);
      });
    });
  }

  function setWizardStep(step) {
    wizardStep = Math.max(1, Math.min(4, Number(step || 1)));
    document.querySelectorAll('.wizard-step').forEach(el => {
      el.classList.toggle('active', Number(el.dataset.step) === wizardStep);
    });
  }

  function evaluateDiagnostic() {
    const income = Number(byId('wiz-income')?.value || 0);
    const mixtos = (byId('wiz-mixtos')?.value || 'no') === 'si';
    const socioPM = (byId('wiz-socio')?.value || 'no') === 'si';
    const cfdiGlobal = (byId('wiz-cfdi')?.value || 'si') === 'si';

    const anualObligatoria = mixtos;
    const riesgoMulta = !cfdiGlobal;

    let recomendacion = 'Mantén monitoreo mensual de ingresos y Buzón Tributario.';
    if (income >= Number(getCfg('ALERT94', 3290000))) recomendacion = 'Riesgo de expulsión: revisa estrategia de cierre y flujo cobrado.';
    else if (income >= Number(getCfg('ALERT90', 3150000))) recomendacion = 'Riesgo alto: valida ingresos cobrados y anticipa salida de RESICO.';
    else if (income >= Number(getCfg('ALERT80', 2800000))) recomendacion = 'Alerta preventiva: ya estás en 80% del límite anual.';
    if (socioPM) recomendacion += ' Revisa compatibilidad societaria de tu régimen.';
    if (riesgoMulta) recomendacion += ' Emite CFDI faltantes para reducir riesgo de multa.';

    return { income, mixtos, socioPM, cfdiGlobal, anualObligatoria, riesgoMulta, recomendacion };
  }

  function renderDiagnostic(result) {
    const resIncome = byId('res-income');
    const resAnual = byId('res-anual');
    const resMulta = byId('res-multa');
    const resRecomendacion = byId('res-recomendacion');

    if (resIncome) resIncome.textContent = money(result.income || 0);
    if (resAnual) {
      resAnual.textContent = result.anualObligatoria ? 'Revisar obligación por ingresos mixtos' : 'No obligatoria por regla base';
      resAnual.style.color = result.anualObligatoria ? '#f59e0b' : '#10b981';
    }
    if (resMulta) {
      resMulta.textContent = result.riesgoMulta ? 'Riesgo por CFDI faltante' : 'Sin riesgo';
      resMulta.style.color = result.riesgoMulta ? '#ef4444' : '#10b981';
    }
    if (resRecomendacion) resRecomendacion.textContent = result.recomendacion || '--';
  }

  function wizardNext() {
    if (wizardStep < 4) {
      wizardStep += 1;
      setWizardStep(wizardStep);
      if (wizardStep === 4) renderDiagnostic(evaluateDiagnostic());
    }
  }

  function resetWizard() {
    wizardStep = 1;
    setWizardStep(1);
    ['wiz-income', 'wiz-mixtos', 'wiz-socio', 'wiz-cfdi'].forEach(id => {
      const el = byId(id);
      if (!el) return;
      if (el.tagName === 'INPUT') el.value = '';
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
    });

    renderDiagnostic({ income: 0, anualObligatoria: false, riesgoMulta: false, recomendacion: '--' });
  }

  function saveDiagnostic() {
    const result = evaluateDiagnostic();
    window.Store?.updateDiagnostic?.({
      income: result.income,
      mixtos: result.mixtos,
      socioPM: result.socioPM,
      cfdiGlobal: result.cfdiGlobal,
      anualObligatoria: result.anualObligatoria,
      riesgoMulta: result.riesgoMulta,
      recomendacion: result.recomendacion,
      completedAt: new Date().toISOString()
    });
    window.Store?.updateIncome?.(result.income);
    syncAndRender();
    navigateTo('dashboard');
  }

  function syncAndRender() {
    renderKPIs();
    renderIncome();
    renderHealth();
    renderFeed();
    renderCarpetaFiscal();
    window.DocumentsManager?.renderDocuments?.();
  }

  async function initCore() {
    await window.AppConfig?.loadServerConfig?.();
    await window.Store?.initSupabase?.();
  }

  async function init() {
    if (booted) return;
    booted = true;

    initTheme();
    initNavigation();
    initRFC();
    initClassifier();
    setWizardStep(1);

    window.DocumentsManager?.init?.();
    window.DocumentProcessor?.init?.();
    window.Invoicing?.init?.();

    await initCore();

    window.Store?.on?.('storeUpdated', syncAndRender);
    window.Store?.on?.('documentAdded', syncAndRender);
    window.Store?.on?.('conversationAdded', syncAndRender);
    window.Store?.on?.('carpetaUpdated', renderCarpetaFiscal);

    syncAndRender();
    window.AuthManager?.init?.();
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
window.Dashboard = { syncAndRender: () => App.syncAndRender() };
window.wizardNext = () => App.wizardNext();
window.resetWizard = () => App.resetWizard();
window.saveDiagnostic = () => App.saveDiagnostic();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}