/* ============================================
ALIADO RESICO — App Core v3.1 (RESTAURADO)
SPA Router + Init + Seguridad Server-Side
✅ Cero exposición de API keys en frontend
============================================ */
const App = (() => {
  const views = ['dashboard', 'classifier', 'documents', 'settings'];
  const titles = { 
    dashboard: 'Dashboard', 
    classifier: 'Clasificador de Intención', 
    documents: 'Documentos', 
    settings: 'Configuración' 
  };

  function navigateTo(viewName) {
    if (!views.includes(viewName)) return;
    
    views.forEach(v => {
      const el = document.getElementById(`${v}-tab`);
      if (el) { el.classList.remove('active'); el.hidden = true; }
    });

    const target = document.getElementById(`${viewName}-tab`);
    if (target) { target.classList.add('active'); target.hidden = false; }

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === viewName);
      btn.setAttribute('aria-selected', btn.getAttribute('data-tab') === viewName);
    });

    if (viewName === 'dashboard' && window.Dashboard?.render) {
      setTimeout(() => Dashboard.render(), 50);
    }
    window.location.hash = viewName;
  }

  function initNavigation() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-tab')));
    });
    
    const hash = window.location.hash.replace('#', '');
    if (views.includes(hash)) navigateTo(hash);
    
    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (views.includes(h)) navigateTo(h);
    });
  }

  // =============================================
  // DOCUMENTS MODULE (OCR + Human Review)
  // =============================================
  function initDocuments() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const ocrOutput = document.getElementById('ocr-output');
    
    if (!dropZone || !window.DocumentProcessor) return;
    
    dropZone.addEventListener('click', () => fileInput?.click());
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); });
    });
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, () => dropZone.classList.add('drag-over'));
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'));
    });
    
    dropZone.addEventListener('drop', e => {
      const file = e.dataTransfer.files[0];
      if (file) handleOCRFile(file);
    });
    
    fileInput?.addEventListener('change', e => {
      if (e.target.files[0]) handleOCRFile(e.target.files[0]);
    });
    
    async function handleOCRFile(file) {
      if (!ocrOutput) return;
      ocrOutput.innerHTML = '<div class="loading">🔄 Procesando documento...</div>';
      
      try {
        const res = await window.DocumentProcessor.processImage(file);
        let html = `<pre class="ocr-json">${JSON.stringify(res.data, null, 2)}</pre>`;
        
        if (res.needsHumanReview) {
          html += `<div class="alert-warning">⚠️ ${res.humanReviewReason}</div>`;
        }
        if (res.data._rfc_emisor_valid === false) {
          html += `<div class="alert-error">❌ RFC del emisor inválido</div>`;
        }
        ocrOutput.innerHTML = html;
      } catch (err) {
        ocrOutput.innerHTML = `<p class="error">❌ ${err.message}</p>`;
        console.error('[OCR] Error:', err);
      }
    }
  }

  // =============================================
  // SETTINGS — SIN EXPOSICIÓN DE KEYS
  // =============================================
  function initSettings() {
    // Config panel SOLO para desarrollo — oculto en producción
    const devConfig = document.getElementById('dev-config');
    if (devConfig && process.env?.NODE_ENV === 'production') {
      devConfig.hidden = true;
    }
    
    // RFC Validator
    const rfcBtn = document.getElementById('rfc-validate-btn');
    const rfcInput = document.getElementById('rfc-input');
    const rfcResult = document.getElementById('rfc-result');
    
    if (rfcBtn && rfcInput && rfcResult && window.DocumentProcessor?.validateRFC) {
      rfcBtn.addEventListener('click', () => {
        const rfc = rfcInput.value.trim().toUpperCase();
        const res = window.DocumentProcessor.validateRFC(rfc);
        rfcResult.innerHTML = res.valid 
          ? `<span class="success">✅ ${res.type}</span><br><small>Fecha: ${res.date}</small>`
          : `<span class="error">❌ ${res.error}</span>`;
      });
    }
  }

  // =============================================
  // BOOT — Inicialización Segura
  // =============================================
  async function init() {
    console.log('%c🧠 Aliado RESICO v3.1 — Blindaje Fiscal Activo', 'color:#10b981;font-weight:bold');
    
    // Inicializar módulos en orden seguro
    const modules = ['Store', 'IntentClassifier', 'DocumentProcessor', 'Dashboard'];
    for (const mod of modules) {
      if (window[mod]?.init) await window[mod].init();
    }
    
    initNavigation();
    initDocuments();
    initSettings();
    
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      const saved = localStorage.getItem('theme') || 'dark';
      document.body.classList.toggle('light-mode', saved === 'light');
      themeToggle.textContent = saved === 'light' ? '☀️' : '🌙';
      themeToggle.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('light-mode');
        localStorage.setItem('theme', isDark ? 'light' : 'dark');
        themeToggle.textContent = isDark ? '☀️' : '🌙';
      });
    }
    
    console.log('✅ Sistema restaurado + Blindaje de seguridad aplicado');
  }

  return { init, navigateTo };
})();

// Inicialización al cargar DOM
document.addEventListener('DOMContentLoaded', () => App.init());
if (typeof window !== 'undefined') window.App = App;