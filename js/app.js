/* ============================================
   ALIADO RESICO — App Core v4.1
   Bug fix: process is not defined → eliminado
   Bug fix: Supabase init secuenciado
   ISR: ingresos brutos | IVA: precisión ≥ 97%
   Art. 113-E LISR | Art. 17-K & 86-C CFF
   ============================================ */

const App = (() => {
  const VIEWS = ['dashboard', 'classifier', 'documents'];

  // =============================================
  // DETECCIÓN DE ENTORNO — SIN process.env
  // Usa window.location, nunca Node.js globals
  // =============================================
  const IS_PROD = !(
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.')
  );

  // =============================================
  // ROUTER SPA
  // =============================================
  function navigateTo(viewName) {
    if (!VIEWS.includes(viewName)) return;

    VIEWS.forEach(v => {
      const el = document.getElementById(`${v}-tab`);
      if (el) { el.classList.remove('active'); el.hidden = true; }
    });

    const target = document.getElementById(`${viewName}-tab`);
    if (target) { target.classList.add('active'); target.hidden = false; }

    document.querySelectorAll('.nav-btn').forEach(btn => {
      const match = btn.getAttribute('data-tab') === viewName;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', String(match));
    });

    if (viewName === 'dashboard') {
      // Pequeño delay para que el tab sea visible antes de renderizar
      setTimeout(() => Dashboard?.syncAndRender?.(), 50);
    }

    window.location.hash = viewName;
  }

  function initNavigation() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-tab')));
    });

    const hash = window.location.hash.replace('#', '');
    navigateTo(VIEWS.includes(hash) ? hash : 'dashboard');

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (VIEWS.includes(h)) navigateTo(h);
    });
  }

  // =============================================
  // THEME — dark/light toggle
  // Bug fix: usa localStorage para preferencia,
  // nunca toca process.env
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
  // PANEL DE CONFIGURACIÓN (solo desarrollo)
  // Bug fix: sin process.env — usa IS_PROD
  // =============================================
  function initSettings() {
    // Ocultar panel dev en producción
    const devConfig = document.getElementById('dev-config');
    if (devConfig && IS_PROD) {
      devConfig.hidden = true;
    }

    // RFC Validator
    const rfcBtn    = document.getElementById('rfc-validate-btn');
    const rfcInput  = document.getElementById('rfc-input');
    const rfcResult = document.getElementById('rfc-result');

    if (rfcBtn && rfcInput && rfcResult) {
      const validateRFC = (rfc) => {
        if (!rfc) return { valid: false, error: 'Ingresa un RFC.' };
        const rfcClean = rfc.trim().toUpperCase();
        // Persona Física: 4 letras + 6 dígitos + 3 alfanuméricos = 13 chars
        // Persona Moral:  3 letras + 6 dígitos + 3 alfanuméricos = 12 chars
        const rgx = /^([A-ZÑ&]{3,4})(\d{6})([A-Z0-9]{3})$/;
        if (!rgx.test(rfcClean)) return { valid: false, error: 'Formato inválido. Usa 12 (PM) o 13 (PF) caracteres.' };
        const tipo = rfcClean.length === 13 ? 'Persona Física' : 'Persona Moral';
        const raw  = rfcClean.slice(-9, -3);
        const yr   = parseInt(raw.slice(0, 2), 10);
        const yr4  = yr > 24 ? 1900 + yr : 2000 + yr;
        const fecha = `${yr4}-${raw.slice(2, 4)}-${raw.slice(4, 6)}`;
        return { valid: true, tipo, fecha };
      };

      rfcBtn.addEventListener('click', () => {
        const res = validateRFC(rfcInput.value);
        rfcResult.innerHTML = res.valid
          ? `<span class="success">✅ RFC válido — ${res.tipo}<br><small>Fecha de nacimiento/constitución: ${res.fecha}</small></span>`
          : `<span class="error">❌ ${res.error}</span>`;
      });
      rfcInput.addEventListener('keydown', e => { if (e.key === 'Enter') rfcBtn.click(); });
    }

    // Botones de ejemplo en el clasificador
    document.querySelectorAll('.example-btn[data-msg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById('classifier-input');
        if (input) { input.value = btn.getAttribute('data-msg'); input.focus(); }
      });
    });

    // WhatsApp
    document.getElementById('whatsapp-btn')?.addEventListener('click', () => {
      window.open('https://wa.me/521XXXXXXXXXX?text=Hola%2C+necesito+ayuda+con+mi+RESICO', '_blank');
    });

    // Refresh feed
    document.getElementById('refresh-feed')?.addEventListener('click', () => {
      Dashboard?.syncAndRender?.();
    });

    // Botones de test en panel dev
    document.getElementById('gemini-test')?.addEventListener('click', async () => {
      const key = document.getElementById('gemini-key')?.value?.trim();
      if (!key) return alert('Ingresa una API Key primero');
      try {
        const r = await fetch('/api/gemini-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo OK' }] }] }),
        });
        alert(r.ok ? '✅ Proxy Gemini responde correctamente' : `❌ Error ${r.status}`);
      } catch (e) {
        alert('❌ ' + e.message);
      }
    });

    document.getElementById('supabase-test')?.addEventListener('click', async () => {
      const client = window.APP_STATE?.supabase;
      if (!client) return alert('❌ Supabase no inicializado. Revisa las credenciales.');
      try {
        const { error } = await client.from('conversations').select('id').limit(1);
        alert(error ? `❌ ${error.message}` : '✅ Supabase conectado correctamente');
      } catch (e) {
        alert('❌ ' + e.message);
      }
    });
  }

  // =============================================
  // DOCUMENTOS / OCR
  // =============================================
  const FISCAL_EDUCATION = {
    ISR: {
      title: '📘 ISR en RESICO',
      body: 'El ISR se calcula sobre tus <strong>ingresos brutos</strong>, sin deducir gastos. '
          + 'La tasa va del 1% al 2.5% mensual según el monto acumulado. '
          + 'No necesitas facturar tus gastos para calcular el ISR.',
      ref:  'Art. 113-E LISR 2024',
      css:  'isr',
    },
    IVA: {
      title: '🟣 IVA — Acreditamiento',
      body: 'Para <strong>acreditar el IVA</strong> necesitas CFDI 4.0 válido, RFC correcto del proveedor '
          + 'y que el gasto sea estrictamente indispensable. '
          + 'El motor OCR requiere <strong>≥ 97% de precisión</strong> para garantizar el acreditamiento '
          + 'sin observaciones del SAT.',
      ref:  'Art. 5 LIVA | Regla 2.7.1.19 RMF 2024',
      css:  'iva',
    },
  };

  function renderFiscalNote(container, type) {
    const note = FISCAL_EDUCATION[type];
    if (!note || !container) return;
    const div = document.createElement('div');
    div.className = `ocr-fiscal-note ${note.css}`;
    div.innerHTML = `<strong>${note.title}</strong>${note.body}
      <span class="alert-ref">${note.ref}</span>`;
    container.appendChild(div);
  }

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

    const handleFile = async (file) => {
      if (!ocrOutput || !file) return;
      ocrOutput.innerHTML = '<div class="loading">Procesando documento fiscal...</div>';

      try {
        const res = window.DocumentProcessor
          ? await window.DocumentProcessor.processImage(file)
          : { data: { nota: 'OCR no disponible en modo demo' }, needsHumanReview: false, confidence: 1 };

        const confidence = res.data?._confidence ?? res.confidence ?? 1;
        const isFactura  = /factura|cfdi|xml/i.test(file.name) || res.data?.tipo_documento === 'CFDI';

        let html = `<pre class="ocr-json">${JSON.stringify(res.data, null, 2)}</pre>`;

        if (isFactura && confidence < 0.97) {
          html += `<div class="alert-warning">
            ⚠️ Precisión ${(confidence * 100).toFixed(1)}% — Se requiere ≥ 97% para garantizar
            acreditamiento de IVA sin observaciones del SAT.
            <span class="alert-ref">Art. 5 LIVA | Regla 2.7.1.19 RMF 2024</span>
          </div>`;
        }
        if (res.needsHumanReview) {
          html += `<div class="alert-warning">⚠️ Revisión humana recomendada: ${res.humanReviewReason}</div>`;
        }
        if (res.data?._rfc_emisor_valid === false) {
          html += `<div class="alert-error">❌ RFC del emisor inválido — CFDI no acreditable para IVA</div>`;
        }

        ocrOutput.innerHTML = html;
        renderFiscalNote(ocrOutput, isFactura ? 'IVA' : 'ISR');

        if (window.Store && res.data) Store.saveDocument({ ...res, fileName: file.name });

      } catch (err) {
        ocrOutput.innerHTML = `<p class="error">❌ Error al procesar: ${err.message}</p>`;
        console.error('[OCR]', err);
      }
    };

    dropZone.addEventListener('drop',       e => handleFile(e.dataTransfer.files[0]));
    fileInput?.addEventListener('change',   e => handleFile(e.target.files[0]));
  }

  // =============================================
  // INICIALIZACIÓN — secuencia correcta con
  // timeouts de seguridad para CDN lento
  // =============================================
  async function init() {
    console.log(
      '%c🧠 Aliado RESICO v4.1',
      'color:#10b981;font-weight:bold;font-size:13px'
    );

    // 1. Módulos síncronos primero
    initTheme();
    initNavigation();
    initSettings();
    initDocuments();

    // 2. Esperar a que el CDN de Supabase esté disponible (máx 3 s)
    await waitForSupabase(3000);

    // 3. Inicializar BD (init-db.js la expone como window.initDatabase)
    if (typeof window.initDatabase === 'function') {
      try {
        await window.initDatabase();
      } catch (err) {
        console.warn('[App] initDatabase falló — modo offline:', err.message);
      }
    } else {
      console.warn('[App] init-db.js no cargado — Supabase deshabilitado');
    }

    // 4. Módulos de negocio
    const mods = ['Store', 'IntentClassifier', 'DocumentProcessor', 'Dashboard'];
    for (const mod of mods) {
      try {
        if (window[mod]?.init) await window[mod].init();
      } catch (err) {
        console.warn(`[App] Módulo ${mod}:`, err.message);
      }
    }

    // 5. Config del servidor (producción: proxy)
    if (window.AppConfig?.loadServerConfig) {
      try { await window.AppConfig.loadServerConfig(); } catch (_) {}
    }

    // 6. Primer render del dashboard
    try {
      await Dashboard?.syncAndRender?.();
    } catch (err) {
      console.warn('[App] Dashboard sync inicial:', err.message);
      // Fallback: render con ceros
      Dashboard?.renderIncomeMonitor?.(0);
      Dashboard?.renderHealthPanel?.(true, true);
    }

    console.log('%c✅ Aliado RESICO listo', 'color:#10b981');
  }

  // Helper: espera a que window.supabase (librería CDN) esté disponible
  function waitForSupabase(timeoutMs) {
    return new Promise(resolve => {
      if (window.supabase?.createClient) { resolve(); return; }
      const t0 = Date.now();
      const check = setInterval(() => {
        if (window.supabase?.createClient || Date.now() - t0 > timeoutMs) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  return { init, navigateTo, IS_PROD, FISCAL_EDUCATION };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
if (typeof window !== 'undefined') window.App = App;