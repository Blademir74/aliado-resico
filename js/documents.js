const DocumentsManager = (() => {
  const ONBOARDING_KEY = 'ar_onboarding_v1';
  const DOCUMENTS_KEY = 'ar_documents_v1';

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function getOnboarding() {
    return loadJson(ONBOARDING_KEY, {
      completed: false,
      currentStep: 1,
      profile: {
        fullName: '',
        rfc: '',
        regime: 'RESICO'
      },
      income: {
        ytd: 0
      },
      files: {
        efirmaCer: false,
        efirmaKey: false,
        constancia: false,
        opinion: false
      }
    });
  }

  function setOnboarding(next) {
    saveJson(ONBOARDING_KEY, next);
  }

  function getDocuments() {
    return loadJson(DOCUMENTS_KEY, []);
  }

  function setDocuments(next) {
    saveJson(DOCUMENTS_KEY, next);
  }

  function money(value) {
    return `$${Number(value || 0).toLocaleString('es-MX')} MXN`;
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',') : result;[7]
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function isValidRFC(rfc) {
    return /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i.test(String(rfc || '').trim());
  }

  function updateFolderFromOnboarding(data) {
    const files = data.files || {};
    window.Store?.updateCarpetaFiscal?.({
      efirmaExpiry: files.efirmaCer && files.efirmaKey ? 'Cargada' : null,
      constanciaStatus: files.constancia ? 'actualizada' : 'pendiente',
      opinionStatus: files.opinion ? 'positiva' : 'pendiente'
    });

    window.Store?.updateSaludFiscal?.({
      eFirmaVigente: !!(files.efirmaCer && files.efirmaKey),
      alertLevel: files.opinion ? 'safe' : 'warning'
    });
  }

  function renderOnboarding() {
    const state = getOnboarding();
    const summary = document.getElementById('onboarding-status');
    const badge = document.getElementById('onboarding-badge');
    const stepViews = document.querySelectorAll('[data-onb-step]');
    const progress = document.getElementById('onboarding-progress');

    stepViews.forEach(el => {
      el.hidden = Number(el.dataset.onbStep) !== Number(state.currentStep);
    });

    if (progress) {
      progress.style.width = `${(state.completed ? 3 : state.currentStep) / 3 * 100}%`;
    }

    if (summary) {
      summary.textContent = state.completed
        ? `Onboarding completo · RFC ${state.profile.rfc || 'sin RFC'} · Ingreso inicial ${money(state.income.ytd)}`
        : `Paso ${state.currentStep} de 3 · Completa tu perfil fiscal inicial`;
    }

    if (badge) {
      badge.textContent = state.completed ? 'Completo' : `Paso ${state.currentStep}/3`;
    }

    const fullName = document.getElementById('onb-fullname');
    const rfc = document.getElementById('onb-rfc');
    const regime = document.getElementById('onb-regime');
    const income = document.getElementById('onb-income');

    if (fullName) fullName.value = state.profile.fullName || '';
    if (rfc) rfc.value = state.profile.rfc || '';
    if (regime) regime.value = state.profile.regime || 'RESICO';
    if (income) income.value = state.income.ytd || 0;
  }

  function nextStep(step) {
    const state = getOnboarding();
    state.currentStep = Math.min(3, step);
    setOnboarding(state);
    renderOnboarding();
  }

  function submitStep1() {
    const fullName = document.getElementById('onb-fullname')?.value?.trim() || '';
    const rfc = document.getElementById('onb-rfc')?.value?.trim().toUpperCase() || '';
    const regime = document.getElementById('onb-regime')?.value || 'RESICO';
    const msg = document.getElementById('onboarding-msg');

    if (!fullName || !isValidRFC(rfc)) {
      if (msg) {
        msg.hidden = false;
        msg.className = 'auth-msg error';
        msg.textContent = 'Captura nombre y RFC válido antes de continuar.';
      }
      return;
    }

    const state = getOnboarding();
    state.profile = { fullName, rfc, regime };
    state.currentStep = 2;
    setOnboarding(state);

    if (msg) msg.hidden = true;
    renderOnboarding();
  }

  function submitStep2() {
    const income = Number(document.getElementById('onb-income')?.value || 0);
    const msg = document.getElementById('onboarding-msg');

    if (!Number.isFinite(income) || income < 0) {
      if (msg) {
        msg.hidden = false;
        msg.className = 'auth-msg error';
        msg.textContent = 'El historial de ingresos debe ser un monto válido.';
      }
      return;
    }

    const state = getOnboarding();
    state.income.ytd = income;
    state.currentStep = 3;
    setOnboarding(state);

    window.Store?.updateIncome?.(income);

    if (msg) msg.hidden = true;
    renderOnboarding();
    window.Dashboard?.syncAndRender?.();
  }

  function submitStep3() {
    const files = {
      efirmaCer: !!document.getElementById('onb-efirma-cer')?.files?.,
      efirmaKey: !!document.getElementById('onb-efirma-key')?.files?.,
      constancia: !!document.getElementById('onb-constancia')?.files?.,
      opinion: !!document.getElementById('onb-opinion')?.files?.
    };

    const state = getOnboarding();
    state.files = files;
    state.completed = true;
    state.currentStep = 3;
    setOnboarding(state);

    updateFolderFromOnboarding(state);

    const msg = document.getElementById('onboarding-msg');
    if (msg) {
      msg.hidden = false;
      msg.className = 'auth-msg success';
      msg.textContent = 'Onboarding completo. Tu Carpeta Fiscal quedó inicializada.';
    }

    renderOnboarding();
    window.Dashboard?.syncAndRender?.();
  }

  function renderDocuments() {
    const list = document.getElementById('documents-list');
    const docs = getDocuments();

    if (!list) return;

    if (!docs.length) {
      list.innerHTML = '<li class="activity-item muted">Sin documentos procesados todavía.</li>';
      return;
    }

    list.innerHTML = docs.map(doc => `
      <li class="activity-item">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
          <strong>${escapeHtml(doc.file_name)}</strong>
          <span class="status-pill ${doc.safety_flag ? 'pill-danger' : 'pill-ok'}">
            ${doc.safety_flag ? 'Verificación Humana' : 'Procesado'}
          </span>
        </div>
        <div class="muted" style="margin-top:8px">
          ${escapeHtml(doc.document_type || 'OTRO')} · Confianza ${Math.round(Number(doc.confidence || 0) * 100)}%
        </div>
        <div class="muted" style="margin-top:8px">
          RFC emisor: ${escapeHtml(doc.extracted_data?.rfc_emisor || '—')} · IVA: ${escapeHtml(String(doc.extracted_data?.iva ?? '—'))}
        </div>
      </li>
    `).join('');
  }

  function escapeHtml(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  async function processDocument() {
    const fileInput = document.getElementById('doc-file');
    const resultEl = document.getElementById('doc-result');
    const btn = document.getElementById('doc-process-btn');
    const file = fileInput?.files?.;

    if (!file) {
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.className = 'auth-msg error';
        resultEl.textContent = 'Selecciona primero un archivo PDF, JPG o PNG.';
      }
      return;
    }

    btn && (btn.disabled = true);

    try {
      const base64Data = await readFileAsBase64(file);

      const response = await fetch('/api/document-ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data
        })
      });

      const data = await response.json();

      if (!data?.ok) {
        throw new Error(data?.error || 'No se pudo procesar el documento');
      }

      const docs = getDocuments();
      const doc = {
        id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
        created_at: new Date().toISOString(),
        ...data.document
      };

      docs.unshift(doc);
      setDocuments(docs);

      if (resultEl) {
        resultEl.hidden = false;
        resultEl.className = data.needsHumanReview ? 'auth-msg error' : 'auth-msg success';
        resultEl.textContent = data.needsHumanReview
          ? `Documento procesado con confianza ${Math.round(doc.confidence * 100)}%. Se activó Verificación Humana. ${doc.pedagogical_note}`
          : `Documento procesado correctamente. ${doc.pedagogical_note}`;
      }

      renderDocuments();
      window.Dashboard?.syncAndRender?.();
    } catch (error) {
      if (resultEl) {
        resultEl.hidden = false;
        resultEl.className = 'auth-msg error';
        resultEl.textContent = error?.message || 'Error al procesar documento.';
      }
    } finally {
      btn && (btn.disabled = false);
    }
  }

  function wireOnboarding() {
    document.getElementById('onb-next-1')?.addEventListener('click', submitStep1);
    document.getElementById('onb-next-2')?.addEventListener('click', submitStep2);
    document.getElementById('onb-finish')?.addEventListener('click', submitStep3);
    document.getElementById('onb-back-2')?.addEventListener('click', () => nextStep(1));
    document.getElementById('onb-back-3')?.addEventListener('click', () => nextStep(2));
  }

  function wireDocuments() {
    document.getElementById('doc-process-btn')?.addEventListener('click', processDocument);
  }

  function init() {
    wireOnboarding();
    wireDocuments();
    renderOnboarding();
    renderDocuments();

    const onboarding = getOnboarding();
    if (onboarding.completed) {
      updateFolderFromOnboarding(onboarding);
    }
  }

  return { init };
})();

window.DocumentsManager = DocumentsManager;