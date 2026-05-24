/* ============================================
   ALIADO RESICO — App Core v5.0
   Fix: process is not defined → eliminado
   Fix: RFC validator inline (sin dependencia)
   Fix: Chat wired a Chat.init()
   Fix: OCR funciona sin DocumentProcessor
   ============================================ */
const App = (() => {
  const VIEWS = ['dashboard', 'classifier', 'documents', 'settings'];

  // ------------------------------------------
  // ENTORNO — solo window.location, cero Node
  // ------------------------------------------
  const IS_DEV = ['localhost','127.0.0.1'].includes(window.location.hostname)
    || window.location.hostname.startsWith('192.168.');

  // ------------------------------------------
  // ROUTER
  // ------------------------------------------
  function navigateTo(view) {
    if (!VIEWS.includes(view)) return;
    VIEWS.forEach(v => {
      const el = document.getElementById(`${v}-tab`);
      if (el) { el.classList.remove('active'); el.hidden = true; }
    });
    const target = document.getElementById(`${view}-tab`);
    if (target) { target.classList.add('active'); target.hidden = false; }
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
      const match = btn.getAttribute('data-tab') === view;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', String(match));
    });
    if (view === 'dashboard') setTimeout(() => Dashboard?.syncAndRender?.(), 60);
    window.location.hash = view;
  }

  function initNavigation() {
    document.querySelectorAll('.nav-btn[data-tab]').forEach(btn =>
      btn.addEventListener('click', () => navigateTo(btn.getAttribute('data-tab')))
    );
    const hash = window.location.hash.replace('#', '');
    navigateTo(VIEWS.includes(hash) ? hash : 'dashboard');
    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (VIEWS.includes(h)) navigateTo(h);
    });
  }

  // ------------------------------------------
  // THEME
  // ------------------------------------------
  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const apply = (mode) => {
      document.body.classList.toggle('light-mode', mode === 'light');
      btn.textContent = mode === 'light' ? '☀️' : '🌙';
    };
    apply(localStorage.getItem('theme') || 'dark');
    btn.addEventListener('click', () => {
      const next = document.body.classList.contains('light-mode') ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      apply(next);
    });
  }

  // ------------------------------------------
  // RFC VALIDATOR — standalone, sin dependencias
  // ------------------------------------------
  const RFC_PF = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
  const RFC_PM = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
  const RFC_GENERIC = ['XAXX010101000', 'XEXX010101000'];

  function validateRFC(raw) {
    if (!raw) return { valid: false, error: 'Ingresa un RFC.' };
    const rfc = raw.trim().toUpperCase();
    if (RFC_GENERIC.includes(rfc)) return { valid: true, type: 'RFC Genérico SAT', date: 'N/A', rfc };
    const isPF = RFC_PF.test(rfc);
    const isPM = RFC_PM.test(rfc);
    if (!isPF && !isPM) return { valid: false, error: `Formato inválido. Longitud ${rfc.length} (esperado 12 PM / 13 PF).`, rfc };
    const datePart = rfc.slice(isPF ? 4 : 3, isPF ? 10 : 9);
    const yr = parseInt(datePart.slice(0,2), 10);
    const yr4 = yr <= 24 ? 2000 + yr : 1900 + yr;
    const fecha = `${yr4}-${datePart.slice(2,4)}-${datePart.slice(4,6)}`;
    return { valid: true, type: isPF ? 'Persona Física' : 'Persona Moral', date: fecha, rfc };
  }

  function initSettings() {
    // Panel dev: solo visible en localhost
    const devPanel = document.getElementById('dev-config');
    if (devPanel) devPanel.hidden = !IS_DEV;

    // RFC
    const rfcBtn    = document.getElementById('rfc-validate-btn');
    const rfcInput  = document.getElementById('rfc-input');
    const rfcResult = document.getElementById('rfc-result');
    if (rfcBtn && rfcInput && rfcResult) {
      const run = () => {
        const r = validateRFC(rfcInput.value);
        rfcResult.innerHTML = r.valid
          ? `<span class="success">✅ ${r.type} — <code>${r.rfc}</code><br><small>Fecha: ${r.date}</small></span>`
          : `<span class="error">❌ ${r.error}</span>`;
      };
      rfcBtn.addEventListener('click', run);
      rfcInput.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    }

    // Quick examples en clasificador
    document.querySelectorAll('.quick-example-btn[data-msg]').forEach(btn =>
      btn.addEventListener('click', () => {
        const inp = document.getElementById('chat-input');
        if (inp) { inp.value = btn.getAttribute('data-msg'); inp.focus(); }
      })
    );

    // Test botones en panel dev
    document.getElementById('gemini-test')?.addEventListener('click', async () => {
      try {
        const r = await fetch('/api/gemini-proxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Di solo OK' }] }] }),
        });
        alert(r.ok ? '✅ Proxy Gemini OK' : `❌ Error ${r.status}`);
      } catch (e) { alert('❌ ' + e.message); }
    });

    document.getElementById('supabase-test')?.addEventListener('click', async () => {
      const client = window.APP_STATE?.supabase;
      if (!client) return alert('❌ Supabase no inicializado');
      try {
        const { error } = await client.from('conversations').select('id').limit(1);
        alert(error ? `❌ ${error.message}` : '✅ Supabase OK');
      } catch (e) { alert('❌ ' + e.message); }
    });

    document.getElementById('refresh-feed')?.addEventListener('click', () =>
      Dashboard?.syncAndRender?.()
    );
  }

  // ------------------------------------------
  // OCR fallback: si DocumentProcessor no cargó
  // ------------------------------------------
  function initDocuments() {
    const zone    = document.getElementById('drop-zone');
    const input   = document.getElementById('file-input');
    const output  = document.getElementById('ocr-output');
    if (!zone) return;

    zone.addEventListener('click', () => input?.click());
    ['dragenter','dragover','dragleave','drop'].forEach(e =>
      zone.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); })
    );
    ['dragenter','dragover'].forEach(e => zone.addEventListener(e, () => zone.classList.add('drag-over')));
    ['dragleave','drop'].forEach(e => zone.addEventListener(e, () => zone.classList.remove('drag-over')));

    const handle = async (file) => {
      if (!file || !output) return;
      output.innerHTML = '<div class="loading">🔄 Procesando documento fiscal...</div>';
      try {
        let res;
        if (window.DocumentProcessor?.processImage) {
          res = await window.DocumentProcessor.processImage(file);
        } else {
          // Fallback: enviar imagen directo al proxy OCR
          res = await ocrFallback(file);
        }
        let html = `<pre class="ocr-json">${JSON.stringify(res.data, null, 2)}</pre>`;
        if (res.needsHumanReview) html += `<div class="alert-warning">⚠️ ${res.humanReviewReason || 'Revisión recomendada'}</div>`;
        if (res.data?._rfc_emisor_valid === false) html += `<div class="alert-error">❌ RFC emisor inválido — CFDI no acreditable</div>`;
        const isFactura = /cfdi|factura|xml/i.test(file.name) || res.data?.document_type === 'CFDI';
        const conf = res.data?.confidence ?? 1;
        if (isFactura && conf < 0.97) html += `<div class="alert-warning">⚠️ Precisión ${(conf*100).toFixed(1)}% &lt; 97% requerido para acreditamiento IVA<br><small>Art. 5 LIVA | Regla 2.7.1.19 RMF 2024</small></div>`;
        output.innerHTML = html;
        if (window.Store) Store.saveDocument({ ...res, fileName: file.name });
      } catch (err) {
        output.innerHTML = `<p class="error">❌ ${err.message}</p>`;
        console.error('[OCR]', err);
      }
    };

    zone.addEventListener('drop', e => handle(e.dataTransfer.files[0]));
    input?.addEventListener('change', e => handle(e.target.files[0]));
  }

  async function ocrFallback(file) {
    const b64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const resp = await fetch('/api/gemini-proxy', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Eres OCR fiscal. Extrae JSON: {document_type,confidence,emisor_rfc,total,iva,fecha}. Solo JSON.' },
          { inline_data: { mime_type: file.type || 'image/jpeg', data: b64 } }
        ]}],
        generationConfig: { temperature: 0.05, maxOutputTokens: 400 },
      }),
    });
    if (!resp.ok) throw new Error(`OCR HTTP ${resp.status}`);
    const d = await resp.json();
    const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = txt.replace(/```json|```/g,'').trim();
    let data = {};
    try { data = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}')+1)); } catch(_){}
    return { data, needsHumanReview: (data.confidence||0) < 0.85, humanReviewReason: 'Confianza baja' };
  }

  // ------------------------------------------
  // BOOT
  // ------------------------------------------
  async function waitFor(globalName, ms = 4000) {
    const t0 = Date.now();
    return new Promise(res => {
      const check = setInterval(() => {
        if (window[globalName] || Date.now()-t0 > ms) { clearInterval(check); res(); }
      }, 80);
    });
  }

  async function init() {
    console.log('%c🧠 Aliado RESICO v5.0', 'color:#10b981;font-weight:bold;font-size:14px');

    // Módulos síncronos
    initTheme();
    initNavigation();
    initSettings();
    initDocuments();

    // Esperar librería Supabase CDN
    await waitFor('supabase', 4000);

    // Inicializar BD
    if (typeof window.initDatabase === 'function') {
      try { await window.initDatabase(); }
      catch (e) { console.warn('[App] BD offline:', e.message); }
    }

    // Módulos en orden
    for (const mod of ['Store', 'IntentClassifier', 'DocumentProcessor', 'Dashboard', 'Chat', 'ConversationManager']) {
      try { if (window[mod]?.init) await window[mod].init(); }
      catch (e) { console.warn(`[App] ${mod}:`, e.message); }
    }

    // Dashboard inicial
    try { await Dashboard?.syncAndRender?.(); }
    catch (e) { console.warn('[App] Dashboard sync:', e.message); }

    console.log('%c✅ Sistema listo', 'color:#10b981');
  }

  return { init, navigateTo, validateRFC, IS_DEV };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
if (typeof window !== 'undefined') window.App = App;