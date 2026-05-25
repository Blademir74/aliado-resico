/* ============================================
   ALIADO RESICO — App Core v5.2
   Fix: process.env eliminado — usa window.location
   Fix: RFC validator sin dependencia externa
   Fix: Chat wired correctamente (form → listener)
   Fix: OCR funciona sin DocumentProcessor (fallback)
   Fix: Boot secuenciado espera CDN Supabase
   ============================================ */
const App = (() => {
  const VIEWS = ['dashboard', 'classifier', 'documents', 'settings'];

  // ─── ENTORNO — solo browser APIs, cero Node.js ───
  const IS_DEV = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.')
  );

  // ─── ROUTER ──────────────────────────────────────
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

  // ─── THEME ───────────────────────────────────────
  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const apply = mode => {
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

  // ─── RFC VALIDATOR — standalone, sin dependencias ──
  const RFC_PF = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
  const RFC_PM = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
  const RFC_GEN = ['XAXX010101000', 'XEXX010101000'];

  function validateRFC(raw) {
    if (!raw?.trim()) return { valid: false, error: 'Ingresa un RFC.' };
    const rfc = raw.trim().toUpperCase().replace(/\s/g, '');
    if (RFC_GEN.includes(rfc)) return { valid: true, type: 'RFC Genérico SAT', date: 'N/A', rfc };
    const isPF = RFC_PF.test(rfc);
    const isPM = RFC_PM.test(rfc);
    if (!isPF && !isPM) return {
      valid: false,
      error: `Formato inválido (${rfc.length} chars). RFC Persona Física: 13 caracteres. Persona Moral: 12.`,
    };
    const start = isPF ? 4 : 3;
    const dp = rfc.slice(start, start + 6);
    const yr = parseInt(dp.slice(0,2), 10);
    const yr4 = yr <= 24 ? 2000+yr : 1900+yr;
    const fecha = `${yr4}-${dp.slice(2,4)}-${dp.slice(4,6)}`;
    return { valid: true, type: isPF ? 'Persona Física' : 'Persona Moral', date: fecha, rfc };
  }

  // ─── SETTINGS ────────────────────────────────────
  function initSettings() {
    // Panel dev: oculto en producción (sin process.env)
    const devPanel = document.getElementById('dev-config');
    if (devPanel) devPanel.hidden = !IS_DEV;

    // ── RFC Validator ──
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

    // ── Quick examples en clasificador ──
    document.querySelectorAll('.example-btn[data-msg]').forEach(btn =>
      btn.addEventListener('click', () => {
        const inp = document.getElementById('classifier-input') || document.getElementById('chat-input');
        if (inp) { inp.value = btn.getAttribute('data-msg'); inp.focus(); }
      })
    );

    // ── Refresh feed ──
    document.getElementById('refresh-feed')?.addEventListener('click', () =>
      Dashboard?.syncAndRender?.()
    );

    // ── Test botones en dev panel ──
    document.getElementById('gemini-test')?.addEventListener('click', async () => {
      try {
        const r = await fetch('/api/gemini-proxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Di solo OK' }] }] }),
        });
        alert(r.ok ? '✅ Proxy Gemini OK' : `❌ Error ${r.status}`);
      } catch(e) { alert('❌ ' + e.message); }
    });

    document.getElementById('supabase-test')?.addEventListener('click', async () => {
      const client = window.APP_STATE?.supabase;
      if (!client) return alert('❌ Supabase no inicializado');
      try {
        const { error } = await client.from('conversations').select('id').limit(1);
        alert(error ? `❌ ${error.message}` : '✅ Supabase OK');
      } catch(e) { alert('❌ ' + e.message); }
    });
  }

  // ─── CHAT — wire el form #classifier-form ────────
  // El HTML usa <form id="classifier-form"> con
  // <input id="classifier-input"> y btn type="submit"
  // Fix: preventDefault() evita el page reload
  function initChat() {
    const form  = document.getElementById('classifier-form');
    const input = document.getElementById('classifier-input');

    if (form && input) {
      form.addEventListener('submit', e => {
        e.preventDefault(); // CRÍTICO: evita recarga de página
        const text = input.value.trim();
        if (!text) return;
        if (window.Chat?.sendMessage) {
          window.Chat.sendMessage(text);
        } else {
          _fallbackSend(text, input);
        }
      });
    }

    // Enter key en el input (compatibilidad)
    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form?.dispatchEvent(new Event('submit'));
      }
    });

    // Quick examples
    document.querySelectorAll('.example-btn[data-msg]').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!input) return;
        input.value = btn.getAttribute('data-msg');
        form?.dispatchEvent(new Event('submit'));
      })
    );
  }

  // Fallback si Chat.js no cargó — usa clasificador local
  async function _fallbackSend(text, input) {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl) return;

    // Burbuja de usuario
    const userBubble = document.createElement('div');
    userBubble.className = 'chat-bubble user';
    userBubble.innerHTML = `<p>${text.replace(/</g,'&lt;')}</p><span class="bubble-time">${new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span>`;
    chatEl.appendChild(userBubble);
    chatEl.scrollTop = chatEl.scrollHeight;
    if (input) input.value = '';

    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    chatEl.appendChild(typing);
    chatEl.scrollTop = chatEl.scrollHeight;

    try {
      let result;
      if (window.IntentClassifier?.classify) {
        const cls = await IntentClassifier.classify(text);
        result = cls;
      } else {
        result = { intent: 'OTROS', confidence: 0.5, explanation: 'Clasificador no disponible' };
      }

      // Respuesta del bot
      const responses = {
        CONSULTA_FISCAL:    '📘 Para tus consultas fiscales RESICO, el ISR se calcula sobre ingresos brutos sin deducir gastos. La tasa va del 1% al 2.5% mensual.',
        SOLICITUD_FACTURA:  '📑 Para timbrar tu CFDI necesitas RFC del receptor válido, descripción del servicio, y forma de pago. ¿Te ayudo con los datos?',
        REGISTRO_GASTO:     '🧾 Registré tu gasto. Para acreditar IVA necesitas el CFDI 4.0 con RFC correcto. ¿Tienes la factura del proveedor?',
        REPORTE_PAGO:       '💳 Recibí tu reporte de pago. ¿Necesitas el comprobante para tu declaración mensual?',
        SALUD_FISCAL:       '🏥 Revisando tu salud fiscal. Verifica que tu Buzón Tributario esté activo para evitar multas de $10,260 MXN (Art. 17-K CFF).',
        OTROS:              '🤖 Entendido. ¿En qué más puedo ayudarte con tu contabilidad RESICO?',
      };

      typing.remove();
      const botBubble = document.createElement('div');
      botBubble.className = 'chat-bubble bot';
      botBubble.innerHTML = `<p>${responses[result.intent] || responses.OTROS}</p><span class="bubble-time">${new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span>`;
      chatEl.appendChild(botBubble);
      chatEl.scrollTop = chatEl.scrollHeight;

      // Actualizar panel de resultado si existe
      const confEl = document.getElementById('result-confidence');
      const kwEl   = document.getElementById('result-keywords');
      if (confEl) confEl.textContent = Math.round((result.confidence||0)*100) + '%';
      if (kwEl)   kwEl.textContent   = (result.keywords_matched||[]).join(', ') || '—';

      // Guardar en Store
      if (window.Store) {
        Store.addConversation({
          id: `conv-${Date.now()}`,
          text, sender: 'Usuario',
          time: new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}),
          intent: result.intent, confidence: result.confidence||0,
          keywords: result.keywords_matched||[], explanation: result.explanation||'',
          response: responses[result.intent]||'', source: result.source||'local',
          timestamp: Date.now(),
        });
      }
    } catch(err) {
      typing.remove();
      const errBubble = document.createElement('div');
      errBubble.className = 'chat-bubble bot';
      errBubble.innerHTML = `<p>❌ ${err.message}</p>`;
      chatEl.appendChild(errBubble);
    }
  }

  // ─── OCR ─────────────────────────────────────────
  function initDocuments() {
    const zone   = document.getElementById('drop-zone');
    const input  = document.getElementById('file-input');
    const output = document.getElementById('ocr-output');
    if (!zone) return;

    zone.addEventListener('click', () => input?.click());
    ['dragenter','dragover','dragleave','drop'].forEach(e =>
      zone.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); })
    );
    ['dragenter','dragover'].forEach(e => zone.addEventListener(e, () => zone.classList.add('drag-over')));
    ['dragleave','drop'].forEach(e => zone.addEventListener(e, () => zone.classList.remove('drag-over')));

    const handle = async file => {
      if (!file || !output) return;
      output.innerHTML = '<div class="loading">🔄 Procesando documento fiscal...</div>';
      try {
        let res;
        if (window.DocumentProcessor?.processImage) {
          res = await DocumentProcessor.processImage(file);
        } else {
          res = await _ocrFallback(file);
        }
        let html = `<pre class="ocr-json">${JSON.stringify(res.data, null, 2)}</pre>`;
        if (res.needsHumanReview) html += `<div class="alert-warning">⚠️ ${res.humanReviewReason||'Revisión recomendada'}</div>`;
        if (res.data?._rfc_emisor_valid === false) html += `<div class="alert-error">❌ RFC emisor inválido — CFDI no acreditable</div>`;
        const isFactura = /cfdi|factura|xml/i.test(file.name);
        const conf = res.data?.confidence ?? 1;
        if (isFactura && conf < 0.97) html += `<div class="alert-warning">⚠️ Precisión ${(conf*100).toFixed(1)}% &lt; 97% para acreditamiento IVA<br><small>Art. 5 LIVA | Regla 2.7.1.19 RMF 2024</small></div>`;
        output.innerHTML = html;
        if (window.Store) Store.saveDocument({ ...res, fileName: file.name });
      } catch(err) {
        output.innerHTML = `<p class="error">❌ ${err.message}</p>`;
      }
    };

    zone.addEventListener('drop', e => handle(e.dataTransfer.files[0]));
    input?.addEventListener('change', e => handle(e.target.files[0]));
  }

  async function _ocrFallback(file) {
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
          { text: 'Eres OCR fiscal mexicano. Extrae JSON: {document_type,confidence,emisor_rfc,total,iva,fecha,folio}. SOLO JSON, sin texto extra.' },
          { inline_data: { mime_type: file.type||'image/jpeg', data: b64 } },
        ]}],
        generationConfig: { temperature: 0.05, maxOutputTokens: 400 },
      }),
    });
    if (!resp.ok) throw new Error(`OCR HTTP ${resp.status} — verifica GEMINI_API_KEY en Vercel`);
    const d = await resp.json();
    const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = txt.replace(/```json|```/g,'').trim();
    let data = {};
    try { data = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}')+1)); } catch(_){}
    return { data, needsHumanReview: (data.confidence||0) < 0.85, humanReviewReason: 'Confianza baja — revisa imagen' };
  }

  // ─── BOOT ────────────────────────────────────────
  function _waitForCDN(global, ms = 4000) {
    return new Promise(res => {
      if (window[global]) return res();
      const t0 = Date.now();
      const id = setInterval(() => {
        if (window[global] || Date.now()-t0 > ms) { clearInterval(id); res(); }
      }, 80);
    });
  }

  async function init() {
    console.log('%c🧠 Aliado RESICO v5.2', 'color:#10b981;font-weight:bold;font-size:14px');

    // 1. Módulos síncronos primero
    initTheme();
    initNavigation();
    initSettings();
    initChat();
    initDocuments();

    // 2. Esperar CDN Supabase (máx 4 s)
    await _waitForCDN('supabase', 4000);

    // 3. Inicializar BD — APP_STATE.supabase queda listo aquí
    if (typeof initDatabase === 'function') {
      try { await initDatabase(); }
      catch(e) { console.warn('[App] BD offline:', e.message); }
    }

    // 4. Módulos de negocio en orden
    for (const mod of ['Store', 'IntentClassifier', 'DocumentProcessor', 'Dashboard', 'Chat', 'ConversationManager']) {
      try { if (window[mod]?.init) await window[mod].init(); }
      catch(e) { console.warn(`[App] ${mod}:`, e.message); }
    }

    // 5. Dashboard inicial
    try { await Dashboard?.syncAndRender?.(); }
    catch(e) { console.warn('[App] Dashboard sync:', e.message); }

    console.log('%c✅ Aliado RESICO listo', 'color:#10b981;font-weight:bold');
  }

  return { init, navigateTo, validateRFC, IS_DEV };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
if (typeof window !== 'undefined') window.App = App;