/* ============================================
   ALIADO RESICO — App Core v4.0
   SPA Router + Fiscal Intelligence + OCR
   Art. 113-E LISR | Art. 17-K & 86-C CFF
   ✅ Cero exposición de API keys en frontend
   ============================================ */

const App = (() => {
  const views = ['dashboard', 'classifier', 'documents', 'settings'];

  // =============================================
  // ROUTER SPA
  // =============================================
  function navigateTo(viewName) {
    if (!views.includes(viewName)) return;

    views.forEach(v => {
      const el = document.getElementById(`${v}-tab`);
      if (el) { el.classList.remove('active'); el.hidden = true; }
    });

    const target = document.getElementById(`${viewName}-tab`);
    if (target) { target.classList.add('active'); target.hidden = false; }

    document.querySelectorAll('.nav-btn').forEach(btn => {
      const isActive = btn.getAttribute('data-tab') === viewName;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive);
    });

    if (viewName === 'dashboard') syncDashboard();
    window.location.hash = viewName;
  }

  function initNavigation() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-tab')));
    });
    const hash = window.location.hash.replace('#', '');
    navigateTo(views.includes(hash) ? hash : 'dashboard');
    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (views.includes(h)) navigateTo(h);
    });
  }

  // =============================================
  // MONITOR DE INGRESOS — Art. 113-E LISR
  // Alertas escalonadas: 80% / 90% / 94% / 100%
  // =============================================
  const RESICO = {
    LIMIT:    3_500_000,
    ALERT_80: 2_800_000,
    ALERT_90: 3_150_000,
    ALERT_94: 3_300_000,
  };

  function getAlertLevel(income) {
    const pct = (income / RESICO.LIMIT) * 100;
    if (income >= RESICO.LIMIT) return {
      level: 'expelled', pct: 100,
      badge: '❌ EXPULSADO',
      msg: `<strong>LÍMITE REBASADO — $${income.toLocaleString('es-MX')} MXN.</strong>
        Expulsión automática al Régimen General. Tus ingresos a partir de hoy
        tributan hasta 35% sin las ventajas de RESICO.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    if (income >= RESICO.ALERT_94) return {
      level: 'critical', pct,
      badge: `🔴 CRÍTICO ${pct.toFixed(1)}%`,
      msg: `<strong>ALERTA ROJA — $${income.toLocaleString('es-MX')} MXN (${pct.toFixed(1)}% del límite).</strong>
        Riesgo inminente de expulsión al Régimen General.
        Detén operaciones facturadas hasta el cierre del ejercicio fiscal.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    if (income >= RESICO.ALERT_90) return {
      level: 'high', pct,
      badge: `🟠 RIESGO ${pct.toFixed(1)}%`,
      msg: `<strong>ALERTA NARANJA — $${income.toLocaleString('es-MX')} MXN (${pct.toFixed(1)}% del límite).</strong>
        Margen restante: $${(RESICO.LIMIT - income).toLocaleString('es-MX')} MXN.
        Revisa tu proyección de ingresos con un contador certificado.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    if (income >= RESICO.ALERT_80) return {
      level: 'warning', pct,
      badge: `⚠️ ALERTA ${pct.toFixed(1)}%`,
      msg: `<strong>ALERTA AMARILLA — $${income.toLocaleString('es-MX')} MXN (${pct.toFixed(1)}% del límite).</strong>
        Quedan $${(RESICO.LIMIT - income).toLocaleString('es-MX')} MXN de margen anual.
        Monitorea tu proyección mensual.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
    return {
      level: 'safe', pct,
      badge: '✅ SEGURO',
      msg: `Ingresos dentro del límite RESICO. Margen disponible:
        <strong>$${(RESICO.LIMIT - income).toLocaleString('es-MX')} MXN</strong>.`,
      ref: 'Art. 113-E, fracción III, LISR 2024',
    };
  }

  function updateIncomeMonitor(income = 0) {
    const fill   = document.getElementById('income-progress-fill');
    const badge  = document.getElementById('income-alert-badge');
    const msg    = document.getElementById('income-alert-message');
    const curr   = document.getElementById('income-current');
    const rem    = document.getElementById('income-remaining');
    if (!fill) return;

    const a = getAlertLevel(income);
    const pct = Math.min(a.pct, 100);

    fill.style.width = pct + '%';
    fill.className   = `progress-fill ${a.level}`;

    if (badge) { badge.className = `alert-badge ${a.level}`; badge.textContent = a.badge; }
    if (curr)  curr.textContent = '$' + income.toLocaleString('es-MX') + ' MXN';
    if (rem)   rem.textContent  = '$' + Math.max(0, RESICO.LIMIT - income).toLocaleString('es-MX') + ' MXN';
    if (msg) {
      msg.className   = `alert-message ${a.level}`;
      msg.innerHTML   = a.msg + `<span class="alert-ref">${a.ref}</span>`;
    }
  }
  window.updateIncomeMonitor = updateIncomeMonitor;

  // =============================================
  // SALUD FISCAL — Art. 17-K y 86-C CFF
  // Multa: $10,260 MXN | Reincidencia: $20,520 MXN
  // =============================================
  function updateHealthPanel(buzonActive, efirmaActive) {
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
      efirmaStatus.textContent = efirmaActive ? '✅ Vigente' : '⚠️ Por vencer';
      efirmaStatus.className   = 'status ' + (efirmaActive ? 'ok' : 'warning');
    }

    if (!buzonActive && alertBox && alertMsg && alertRef) {
      alertBox.classList.remove('hidden');
      alertMsg.textContent = 'Buzón tributario inactivo. Multa inmediata: $10,260 MXN. '
        + 'Por reincidencia la multa asciende a $20,520 MXN.';
      alertRef.textContent = 'Art. 17-K CFF (obligación de medios electrónicos) | Art. 86-C CFF (reincidencia)';
    } else if (alertBox) {
      alertBox.classList.add('hidden');
    }
  }
  window.updateHealthPanel = updateHealthPanel;

  // =============================================
  // DIFERENCIACIÓN FISCAL ISR / IVA
  // ISR: sobre ingresos brutos (sin deducciones)
  // IVA: requiere precisión ≥ 97% en gastos para acreditamiento
  // =============================================
  const FISCAL_EDUCATION = {
    ISR: {
      title: '📘 ISR en RESICO',
      body: 'El ISR se calcula sobre tus <strong>ingresos brutos</strong>, sin deducir gastos. '
          + 'La tasa va del 1% al 2.5% mensual dependiendo del monto acumulado. '
          + 'No necesitas facturar tus gastos para calcular el ISR.',
      ref: 'Art. 113-E LISR 2024',
      type: 'isr',
    },
    IVA: {
      title: '🟣 IVA — Acreditamiento',
      body: 'Para <strong>acreditar el IVA</strong> de tus gastos debes contar con CFDI 4.0 válido, '
          + 'RFC correcto del proveedor, y que el gasto sea <em>estrictamente indispensable</em>. '
          + 'El sistema requiere <span class="precision-badge">≥ 97% precisión</span> en la extracción '
          + 'de datos para garantizar el acreditamiento sin observaciones del SAT.',
      ref: 'Art. 5 LIVA | Regla 2.7.1.19 RMF 2024',
      type: 'iva',
    },
  };

  function renderFiscalNote(container, type) {
    if (!container) return;
    const note = FISCAL_EDUCATION[type];
    if (!note) return;
    const div = document.createElement('div');
    div.className = `ocr-fiscal-note ${note.type}`;
    div.innerHTML = `<strong>${note.title}</strong>${note.body}<br>
      <span class="alert-ref">${note.ref}</span>`;
    container.appendChild(div);
  }

  // =============================================
  // MÓDULO OCR — Documentos con Inteligencia Fiscal
  // =============================================
  function initDocuments() {
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const ocrOutput = document.getElementById('ocr-output');
    if (!dropZone) return;

    dropZone.addEventListener('click', () => fileInput?.click());

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt =>
      dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); })
    );
    ['dragenter', 'dragover'].forEach(evt =>
      dropZone.addEventListener(evt, () => dropZone.classList.add('drag-over'))
    );
    ['dragleave', 'drop'].forEach(evt =>
      dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'))
    );

    dropZone.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (file) handleOCRFile(file);
    });
    fileInput?.addEventListener('change', e => {
      if (e.target.files[0]) handleOCRFile(e.target.files[0]);
    });

    async function handleOCRFile(file) {
      if (!ocrOutput) return;
      ocrOutput.innerHTML = '<div class="loading">Procesando documento fiscal...</div>';

      try {
        const res = window.DocumentProcessor
          ? await window.DocumentProcessor.processImage(file)
          : { data: { nota: 'DocumentProcessor no cargado' }, needsHumanReview: false };

        const confidence = res.data?._confidence || 0;
        const isIVA = file.name?.toLowerCase().includes('factura')
          || res.data?.tipo_documento === 'CFDI';

        let html = `<pre class="ocr-json">${JSON.stringify(res.data, null, 2)}</pre>`;

        // Alerta de precisión para IVA
        if (isIVA && confidence < 0.97) {
          html += `<div class="alert-warning">
            ⚠️ Precisión ${(confidence * 100).toFixed(1)}% — Se requiere ≥ 97% para garantizar
            acreditamiento de IVA sin observaciones del SAT.
            <span class="alert-ref">Art. 5 LIVA | Regla 2.7.1.19 RMF 2024</span>
          </div>`;
        }
        if (res.needsHumanReview) {
          html += `<div class="alert-warning">⚠️ ${res.humanReviewReason}</div>`;
        }
        if (res.data._rfc_emisor_valid === false) {
          html += `<div class="alert-error">❌ RFC del emisor no válido — CFDI no acreditable</div>`;
        }

        ocrOutput.innerHTML = html;

        // Notas educativas ISR/IVA
        renderFiscalNote(ocrOutput, isIVA ? 'IVA' : 'ISR');

      } catch (err) {
        ocrOutput.innerHTML = `<p class="error">❌ ${err.message}</p>`;
        console.error('[OCR] Error:', err);
      }
    }
  }

  // =============================================
  // RFC VALIDATOR
  // =============================================
  function initSettings() {
    const devConfig = document.getElementById('dev-config');
    if (devConfig && window.AppConfig?.IS_PRODUCTION) {
      devConfig.hidden = true;
    }

    const rfcBtn    = document.getElementById('rfc-validate-btn');
    const rfcInput  = document.getElementById('rfc-input');
    const rfcResult = document.getElementById('rfc-result');

    if (rfcBtn && rfcInput && rfcResult) {
      rfcBtn.addEventListener('click', () => {
        const rfc = rfcInput.value.trim().toUpperCase();
        const valid = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc);
        rfcResult.innerHTML = valid
          ? `<span class="success">✅ RFC válido — ${rfc.length === 13 ? 'Persona Física' : 'Persona Moral'}</span>`
          : `<span class="error">❌ Formato inválido. RFC debe tener 12 (PM) o 13 (PF) caracteres alfanuméricos.</span>`;
      });
      rfcInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') rfcBtn.click();
      });
    }

    // Ejemplos rápidos en el clasificador
    document.querySelectorAll('.example-btn[data-msg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('classifier-input');
        if (input) {
          input.value = btn.getAttribute('data-msg');
          input.focus();
        }
      });
    });

    // WhatsApp
    const waBtn = document.getElementById('whatsapp-btn');
    if (waBtn) {
      waBtn.addEventListener('click', () => {
        window.open('https://wa.me/521XXXXXXXXXX?text=Hola%2C+necesito+ayuda+con+mi+RESICO', '_blank');
      });
    }
  }

  // =============================================
  // DASHBOARD SYNC — Supabase RLS
  // =============================================
  async function syncDashboard() {
    if (!window.Dashboard?.syncAndRender) {
      // Fallback: modo demo con datos estáticos
      updateIncomeMonitor(0);
      updateHealthPanel(true, true);
      return;
    }
    try {
      await window.Dashboard.syncAndRender();
    } catch (err) {
      console.warn('[App] Dashboard sync failed:', err.message);
      updateIncomeMonitor(0);
    }
  }

  // =============================================
  // THEME
  // =============================================
  function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    const saved = localStorage.getItem('theme') || 'dark';
    document.body.classList.toggle('light-mode', saved === 'light');
    toggle.textContent = saved === 'light' ? '☀️' : '🌙';
    toggle.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('light-mode');
      localStorage.setItem('theme', isLight ? 'light' : 'dark');
      toggle.textContent = isLight ? '☀️' : '🌙';
    });
  }

  // =============================================
  // BOOT
  // =============================================
  async function init() {
    console.log(
      '%c🧠 Aliado RESICO v4.0 — Blindaje Fiscal Activo\n' +
      '%cISR: ingresos brutos | IVA: precisión ≥ 97%',
      'color:#10b981;font-weight:bold;font-size:13px',
      'color:#9ca3af;font-size:11px'
    );

    // Módulos en orden de dependencia
    const modules = ['Store', 'IntentClassifier', 'DocumentProcessor', 'Dashboard'];
    for (const mod of modules) {
      try {
        if (window[mod]?.init) await window[mod].init();
      } catch (err) {
        console.warn(`[App] Módulo ${mod} no disponible:`, err.message);
      }
    }

    // Cargar config del servidor (producción: vía proxy)
    if (window.AppConfig?.loadServerConfig) {
      await window.AppConfig.loadServerConfig();
    }

    initNavigation();
    initDocuments();
    initSettings();
    initTheme();

    // Estado inicial del monitor
    updateIncomeMonitor(0);
    updateHealthPanel(false, false);

    // Refresh del feed
    document.getElementById('refresh-feed')?.addEventListener('click', syncDashboard);

    console.log('%c✅ Sistema listo — Rutas relativas activas, API keys en servidor', 'color:#10b981');
  }

  return { init, navigateTo, updateIncomeMonitor, updateHealthPanel, RESICO, FISCAL_EDUCATION };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
if (typeof window !== 'undefined') window.App = App;