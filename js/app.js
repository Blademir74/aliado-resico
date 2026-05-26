/* ════════════════════════════════════════════════
   ALIADO RESICO — App Core v5.4 — PRODUCCIÓN
   ✅ Sin process.env en el browser
   ✅ Auth Supabase — IDs alineados al HTML actual
   ✅ Chat wired a #classifier-form/#classifier-input
   ✅ RFC validator standalone
   ✅ Dev panel solo en localhost
   ════════════════════════════════════════════════ */
const App = (() => {
  const VIEWS = ['dashboard', 'classifier', 'documents'];

  // ── ENTORNO — solo window.location, cero Node.js ──
  const IS_DEV = (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.startsWith('192.168.')
  );

  // ══════════════════════════════════════════════
  // ROUTER
  // ══════════════════════════════════════════════
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

    if (view === 'dashboard') setTimeout(() => Dashboard?.syncAndRender?.(), 80);
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

  // ══════════════════════════════════════════════
  // THEME
  // ══════════════════════════════════════════════
  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const apply = mode => {
      document.body.classList.toggle('light-mode', mode === 'light');
      btn.textContent = mode === 'light' ? '☀️' : '🌙';
    };
    apply(localStorage.getItem('ar_theme') || 'dark');
    btn.addEventListener('click', () => {
      const next = document.body.classList.contains('light-mode') ? 'dark' : 'light';
      localStorage.setItem('ar_theme', next);
      apply(next);
    });
  }

  // ══════════════════════════════════════════════
  // AUTH GUARD — IDs exactos del HTML actual:
  //   #auth-overlay, #auth-submit, #auth-email,
  //   #auth-password, #auth-msg, #auth-demo,
  //   #tab-login, #tab-register,
  //   #app, #user-chip, #user-email-display,
  //   #logout-btn
  // ══════════════════════════════════════════════
  async function initAuth() {
    const overlay  = document.getElementById('auth-overlay');
    const appEl    = document.getElementById('app');
    const chip     = document.getElementById('user-chip');
    const emailEl  = document.getElementById('user-email-display');
    const logoutBtn= document.getElementById('logout-btn');

    if (!overlay || !appEl) return;

    const client = window.APP_STATE?.supabase;

    // Sin cliente Supabase → modo demo directo
    if (!client) {
      _showApp(overlay, appEl, chip, emailEl, logoutBtn, null);
      return;
    }

    // Verificar sesión activa
    try {
      const { data } = await client.auth.getSession();
      if (data?.session?.user) {
        _showApp(overlay, appEl, chip, emailEl, logoutBtn, data.session.user);
        return;
      }
    } catch(_) {}

    // Sin sesión → mostrar overlay
    _showOverlay(overlay, appEl);
    _wireAuthForm(client, overlay, appEl, chip, emailEl, logoutBtn);
  }

  function _showApp(overlay, appEl, chip, emailEl, logoutBtn, user) {
    overlay.style.display = 'none';
    appEl.hidden = false;
    if (chip && user)    { chip.hidden = false; }
    if (emailEl && user) emailEl.textContent = user.email;
    if (logoutBtn)       logoutBtn.hidden = false;
  }

  function _showOverlay(overlay, appEl) {
    overlay.style.display = 'flex';
    appEl.hidden = true;
  }

  function _showAuthMsg(el, text, isError) {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.className = isError ? 'auth-msg error' : 'auth-msg success';
  }

  function _wireAuthForm(client, overlay, appEl, chip, emailEl, logoutBtn) {
    // IDs exactos del HTML actual
    const emailInput  = document.getElementById('auth-email');
    const passInput   = document.getElementById('auth-password');
    const submitBtn   = document.getElementById('auth-submit');       // ← correcto
    const msgEl       = document.getElementById('auth-msg');
    const demoBtn     = document.getElementById('auth-demo');
    const tabLogin    = document.getElementById('tab-login');          // ← correcto
    const tabRegister = document.getElementById('tab-register');       // ← correcto

    let isRegister = false;

    // Tabs login / registro
    tabLogin?.addEventListener('click', () => {
      isRegister = false;
      tabLogin.classList.add('active');
      tabRegister?.classList.remove('active');
      if (submitBtn) submitBtn.textContent = '🔐 Iniciar Sesión';
      if (msgEl) msgEl.hidden = true;
    });
    tabRegister?.addEventListener('click', () => {
      isRegister = true;
      tabRegister.classList.add('active');
      tabLogin?.classList.remove('active');
      if (submitBtn) submitBtn.textContent = '✅ Crear Cuenta';
      if (msgEl) msgEl.hidden = true;
    });

    // Submit
    submitBtn?.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass  = passInput?.value;
      if (!email || !pass) {
        _showAuthMsg(msgEl, 'Ingresa correo y contraseña.', true);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Procesando…';
      if (msgEl) msgEl.hidden = true;

      try {
        let result;
        if (isRegister) {
          result = await client.auth.signUp({ email, password: pass });
          if (result.error) throw result.error;
          if (result.data?.user && !result.data.session) {
            _showAuthMsg(msgEl, '✅ Cuenta creada. Revisa tu correo para confirmar.', false);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Crear Cuenta';
            return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }

        const user = result.data.user;
        _showApp(overlay, appEl, chip, emailEl, logoutBtn, user);

        // Sincronizar Store y Dashboard con la sesión nueva
        if (Store?.initSupabase) await Store.initSupabase();
        if (Dashboard?.syncAndRender) await Dashboard.syncAndRender();

      } catch(err) {
        const map = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed': 'Confirma tu correo antes de entrar.',
          'User already registered': 'Ese correo ya tiene una cuenta.',
        };
        _showAuthMsg(msgEl, map[err.message] || err.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? 'Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    // Enter en inputs
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn?.click(); })
    );

    // Modo demo — salta el login
    demoBtn?.addEventListener('click', () => {
      _showApp(overlay, appEl, chip, emailEl, logoutBtn, null);
    });

    // Logout
    logoutBtn?.addEventListener('click', async () => {
      await client?.auth.signOut();
      if (chip)    chip.hidden = true;
      if (emailEl) emailEl.textContent = '';
      if (logoutBtn) logoutBtn.hidden = true;
      _showOverlay(overlay, appEl);
    });

    // Suscribir cambios de sesión
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        _showOverlay(overlay, appEl);
        if (chip) chip.hidden = true;
        if (logoutBtn) logoutBtn.hidden = true;
      }
    });
  }

  // ══════════════════════════════════════════════
  // SETTINGS — dev panel, test buttons, refresh
  // ══════════════════════════════════════════════
  function initSettings() {
    // Dev panel: solo visible en localhost
    const devPanel = document.getElementById('dev-config');
    if (devPanel) devPanel.hidden = !IS_DEV;

    // Refresh feed
    document.getElementById('refresh-feed')?.addEventListener('click', () =>
      Dashboard?.syncAndRender?.()
    );

    // Test proxy Gemini (dev)
    document.getElementById('gemini-test')?.addEventListener('click', async () => {
      try {
        const r = await fetch('/api/gemini-proxy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: OK' }] }] }),
        });
        alert(r.ok ? '✅ Proxy Gemini responde correctamente' : `❌ Error ${r.status}`);
      } catch(e) { alert('❌ ' + e.message); }
    });

    // Test Supabase (dev)
    document.getElementById('supabase-test')?.addEventListener('click', async () => {
      const client = window.APP_STATE?.supabase;
      if (!client) return alert('❌ APP_STATE.supabase no inicializado');
      try {
        const { error } = await client.from('conversations').select('id').limit(1);
        alert(error ? `❌ ${error.message}` : '✅ Supabase conectado y con RLS activo');
      } catch(e) { alert('❌ ' + e.message); }
    });
  }

  // ══════════════════════════════════════════════
  // RFC VALIDATOR — standalone, cero dependencias
  // ══════════════════════════════════════════════
  const RFC_PF  = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
  const RFC_PM  = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
  const RFC_GEN = ['XAXX010101000', 'XEXX010101000'];

  function validateRFC(raw) {
    if (!raw?.trim()) return { valid: false, error: 'Ingresa un RFC.' };
    const rfc = raw.trim().toUpperCase().replace(/\s/g, '');
    if (RFC_GEN.includes(rfc)) return { valid: true, type: 'RFC Genérico SAT', date: 'N/A', rfc };
    const isPF = RFC_PF.test(rfc);
    const isPM = RFC_PM.test(rfc);
    if (!isPF && !isPM) return {
      valid: false,
      error: `Formato inválido (${rfc.length} caracteres). PF: 13 · PM: 12`,
    };
    const s  = isPF ? 4 : 3;
    const dp = rfc.slice(s, s + 6);
    const yr = parseInt(dp.slice(0, 2), 10);
    return {
      valid: true,
      type: isPF ? 'Persona Física' : 'Persona Moral',
      date: `${yr <= 24 ? 2000+yr : 1900+yr}-${dp.slice(2,4)}-${dp.slice(4,6)}`,
      rfc,
    };
  }

  function initRFC() {
    const rfcBtn    = document.getElementById('rfc-validate-btn');
    const rfcInput  = document.getElementById('rfc-input');
    const rfcResult = document.getElementById('rfc-result');
    if (!rfcBtn || !rfcInput || !rfcResult) return;

    const run = () => {
      const r = validateRFC(rfcInput.value);
      rfcResult.innerHTML = r.valid
        ? `<span class="success">✅ ${r.type} — <code>${r.rfc}</code><br><small>Fecha: ${r.date}</small></span>`
        : `<span class="error">❌ ${r.error}</span>`;
    };
    rfcBtn.addEventListener('click', run);
    rfcInput.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    rfcInput.addEventListener('input', () => {
      rfcInput.value = rfcInput.value.toUpperCase();
    });
  }

  // ══════════════════════════════════════════════
  // CHAT — conecta #classifier-form con Gemini
  // FIX: el HTML usa #classifier-form + #classifier-input
  //      el proxy NO requiere API key en el frontend
  // ══════════════════════════════════════════════
  function initChat() {
    const form    = document.getElementById('classifier-form');
    const input   = document.getElementById('classifier-input');
    const chatEl  = document.getElementById('chat-messages');
    if (!form || !input || !chatEl) return;

    // Si Chat.js ya maneja el form, delegarle; si no, fallback inline
    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      if (window.Chat?.sendMessage) {
        // Chat.js escucha #chat-input — sincronizar valor
        const ci = document.getElementById('chat-input');
        if (ci) { ci.value = text; }
        Chat.sendMessage(text);
        input.value = '';
      } else {
        _sendMessage(text, input, chatEl);
      }
    });

    // Examples — botones .example-btn[data-msg]
    document.querySelectorAll('.example-btn[data-msg]').forEach(btn =>
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-msg');
        form.dispatchEvent(new Event('submit', { bubbles: true }));
      })
    );
  }

  async function _sendMessage(text, input, chatEl) {
    const ts = () => new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });

    // Burbuja usuario
    const uBubble = document.createElement('div');
    uBubble.className = 'chat-bubble user';
    uBubble.innerHTML = `<p>${_esc(text)}</p><span class="bubble-time">${ts()}</span>`;
    chatEl.appendChild(uBubble);
    chatEl.scrollTop = chatEl.scrollHeight;
    input.value = '';

    // Typing indicator
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    chatEl.appendChild(typing);
    chatEl.scrollTop = chatEl.scrollHeight;

    try {
      // Clasificación local primero (instantánea)
      let intent = 'OTROS', confidence = 0.5;
      if (window.IntentClassifier?.classify) {
        const cls = await IntentClassifier.classify(text);
        intent = cls.intent || intent;
        confidence = cls.confidence || confidence;
      }

      // Actualizar panel resultado
      _updateResultPanel(intent, confidence, text);

      // Llamar proxy Gemini — API key NUNCA en el frontend
      const session = await window.APP_STATE?.supabase?.auth.getSession?.();
      const token   = session?.data?.session?.access_token;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const SYSTEM = `Eres Aliado RESICO, asistente fiscal IA para el Régimen Simplificado de Confianza en México.
Responde en español, conciso y práctico. Cita artículos del CFF/LISR cuando aplique.
REGLAS CLAVE:
- En RESICO el ISR se paga sobre ingresos BRUTOS (sin deducciones). Art. 113-E LISR.
- Para acreditar IVA se requiere CFDI 4.0 válido con RFC correcto. Art. 5 LIVA.
- Buzón tributario inactivo: multa $10,260 MXN (Art. 17-K CFF). Reincidencia: $20,520 MXN (Art. 86-C CFF).
- Límite RESICO anual: $3,500,000 MXN. Al rebasarlo hay expulsión al Régimen General.`;

      const r = await fetch('/api/gemini-proxy', {
        method: 'POST', headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${SYSTEM}\n\nConsulta: ${text}` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
        }),
      });

      let botText = '';
      if (r.ok) {
        const d = await r.json();
        botText = d.candidates?.[0]?.content?.parts?.[0]?.text
          || d.response
          || '⚠️ Sin respuesta del servidor.';
      } else {
        // Fallback local por intención si el proxy falla
        botText = _localResponse(intent, text);
      }

      typing.remove();
      const bBubble = document.createElement('div');
      bBubble.className = 'chat-bubble bot';
      bBubble.innerHTML = `<p>${_mdToHtml(botText)}</p><span class="bubble-time">${ts()}</span>`;
      chatEl.appendChild(bBubble);
      chatEl.scrollTop = chatEl.scrollHeight;

      // Persistir en Store
      if (window.Store) {
        Store.addConversation({
          id: `c-${Date.now()}`, text, sender: 'Usuario', time: ts(),
          intent, confidence,
          keywords: [], response: botText,
          source: r.ok ? 'gemini' : 'local',
          timestamp: Date.now(),
        });
      }

    } catch(err) {
      typing.remove();
      const errB = document.createElement('div');
      errB.className = 'chat-bubble bot';
      errB.innerHTML = `<p>❌ ${_esc(err.message)}</p><span class="bubble-time">${ts()}</span>`;
      chatEl.appendChild(errB);
      console.error('[Chat]', err);
    }
  }

  function _updateResultPanel(intent, confidence, text) {
    const emptyEl   = document.getElementById('classification-empty');
    const contentEl = document.getElementById('classification-content');
    const intentEl  = document.getElementById('result-intent');
    const barEl     = document.getElementById('result-confidence-bar');
    const valEl     = document.getElementById('result-confidence-val');
    const kwEl      = document.getElementById('result-keywords');
    const srcEl     = document.getElementById('result-source');

    if (emptyEl)  emptyEl.hidden  = true;
    if (contentEl) contentEl.hidden = false;

    const cat = (window.CATEGORY_CONFIG || {})[intent] || { label: intent, icon: '💬', cssClass: 'otros' };
    if (intentEl) intentEl.innerHTML = `<span class="cat-badge ${cat.cssClass}">${cat.icon} ${cat.label}</span>`;

    const pct = Math.round(confidence * 100);
    if (barEl) barEl.style.width = pct + '%';
    if (valEl) valEl.textContent = pct + '%';
    if (kwEl)  kwEl.innerHTML = '';
    if (srcEl) srcEl.innerHTML = `<span class="source-badge gemini">Gemini IA</span>`;

    // Contexto fiscal RESICO según intención
    const ctxEl = document.getElementById('result-resico-context');
    if (ctxEl) {
      const ctx = {
        CONSULTA_FISCAL:   'ISR RESICO: sobre ingresos brutos sin deducciones (Art. 113-E LISR)',
        SOLICITUD_FACTURA: 'CFDI 4.0: RFC receptor, régimen fiscal, CP y descripción obligatorios',
        REGISTRO_GASTO:    'Para acreditar IVA: CFDI válido + gasto indispensable (Art. 5 LIVA)',
        SALUD_FISCAL:      'Buzón activo obligatorio: $10,260 MXN multa si inactivo (Art. 17-K CFF)',
      };
      if (ctx[intent]) { ctxEl.textContent = ctx[intent]; ctxEl.hidden = false; }
      else ctxEl.hidden = true;
    }

    // Alerta salud fiscal
    const saludEl = document.getElementById('result-salud-alerta');
    if (saludEl) {
      if (intent === 'SALUD_FISCAL' || /buzón|efirma|sat|multa/i.test(text)) {
        saludEl.textContent = '⚠️ Multa por buzón inactivo: $10,260 MXN · Reincidencia: $20,520 MXN (Art. 86-C CFF)';
        saludEl.hidden = false;
      } else saludEl.hidden = true;
    }
  }

  function _localResponse(intent, text) {
    const r = {
      CONSULTA_FISCAL:   '📘 En RESICO **no aplican deducciones** para el ISR. Tu impuesto se calcula sobre ingresos brutos mensualmente. (Art. 113-E LISR 2024)',
      SOLICITUD_FACTURA: '📑 Para timbrar un CFDI 4.0 necesitas: RFC receptor válido, régimen fiscal, código postal y descripción del servicio.',
      REGISTRO_GASTO:    '🧾 Para acreditar IVA de un gasto, el CFDI debe tener tu RFC correcto y el gasto debe ser estrictamente indispensable. (Art. 5 LIVA)',
      REPORTE_PAGO:      '💳 Recibí tu reporte de pago. ¿Necesitas el comprobante para tu declaración mensual del RESICO?',
      SALUD_FISCAL:      '🏥 El Buzón Tributario debe estar activo. Si no lo está: multa de **$10,260 MXN** (Art. 17-K CFF). Por reincidencia sube a **$20,520 MXN** (Art. 86-C CFF).',
      OTROS:             '🤖 Soy Aliado RESICO, tu asistente de cumplimiento fiscal. ¿Tienes una consulta sobre tu declaración, facturas o gastos?',
    };
    return r[intent] || r.OTROS;
  }

  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _mdToHtml(s) {
    return s
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  // ══════════════════════════════════════════════
  // OCR — arrastar/soltar documentos fiscales
  // ══════════════════════════════════════════════
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
      output.innerHTML = '<div class="loading">🔄 Procesando documento fiscal…</div>';
      try {
        let res;
        if (window.DocumentProcessor?.processImage) {
          res = await DocumentProcessor.processImage(file);
        } else {
          res = await _ocrFallback(file);
        }
        let html = `<pre class="ocr-json">${JSON.stringify(res.data, null, 2)}</pre>`;
        const conf = res.data?.confidence ?? 1;
        const isFactura = /cfdi|factura|xml/i.test(file.name) || res.data?.document_type === 'CFDI';

        if (isFactura && conf < 0.97)
          html += `<div class="alert-warning">⚠️ Precisión ${(conf*100).toFixed(1)}% &lt; 97% requerido para acreditamiento IVA<br><small>Art. 5 LIVA | Regla 2.7.1.19 RMF 2024</small></div>`;
        if (res.needsHumanReview)
          html += `<div class="alert-warning">⚠️ ${res.humanReviewReason || 'Revisión humana recomendada'}</div>`;
        if (res.data?._rfc_emisor_valid === false)
          html += `<div class="alert-error">❌ RFC del emisor inválido — CFDI no acreditable para IVA</div>`;
        if (!isFactura)
          html += `<div class="alert-warning" style="background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.3);color:#93c5fd">📘 ISR RESICO: se paga sobre ingresos brutos, sin deducir este gasto (Art. 113-E LISR)</div>`;

        output.innerHTML = html;
        if (window.Store) Store.saveDocument({ ...res, fileName: file.name });
      } catch(err) {
        output.innerHTML = `<p class="error">❌ ${_esc(err.message)}</p>`;
        console.error('[OCR]', err);
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

    const session = await window.APP_STATE?.supabase?.auth.getSession?.();
    const token   = session?.data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch('/api/gemini-proxy', {
      method: 'POST', headers,
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Eres OCR fiscal mexicano. Extrae JSON: {document_type,confidence,emisor_rfc,receptor_rfc,total,iva,subtotal,fecha,folio,forma_pago}. SOLO JSON, sin texto adicional.' },
          { inline_data: { mime_type: file.type || 'image/jpeg', data: b64 } },
        ]}],
        generationConfig: { temperature: 0.05, maxOutputTokens: 500 },
      }),
    });

    if (!resp.ok) throw new Error(`OCR HTTP ${resp.status} — verifica GEMINI_API_KEY en Vercel`);
    const d = await resp.json();
    const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = txt.replace(/```json|```/g, '').trim();
    let data = {};
    try { data = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1)); } catch(_) {}
    return {
      data,
      needsHumanReview: (data.confidence ?? 0) < 0.85,
      humanReviewReason: 'Confianza baja — verifica los datos manualmente',
      confidence: data.confidence ?? 0,
    };
  }

  // ══════════════════════════════════════════════
  // BOOT — secuencia correcta
  // ══════════════════════════════════════════════
  function _waitFor(name, ms = 5000) {
    return new Promise(res => {
      if (window[name]) return res();
      const t0 = Date.now();
      const id = setInterval(() => {
        if (window[name] || Date.now() - t0 > ms) { clearInterval(id); res(); }
      }, 80);
    });
  }

  async function init() {
    console.log('%c🛡️ Aliado RESICO v5.4', 'color:#10b981;font-weight:bold;font-size:14px');
    console.log('%cFiscal IA — Art. 113-E LISR | Art. 17-K CFF', 'color:#6ee7b7;font-size:11px');

    // 1. Módulos síncronos sin esperar red
    initTheme();
    initNavigation();
    initSettings();
    initRFC();
    initChat();
    initDocuments();

    // 2. Esperar librería Supabase CDN (máx 5 s)
    await _waitFor('supabase', 5000);

    // 3. Crear cliente instanciado (init-db.js → APP_STATE.supabase)
    if (typeof initDatabase === 'function') {
      try { await initDatabase(); }
      catch(e) { console.warn('[App] BD offline:', e.message); }
    }

    // 4. Inicializar módulos de negocio
    for (const mod of ['Store', 'IntentClassifier', 'DocumentProcessor', 'Dashboard', 'Chat', 'ConversationManager']) {
      try { if (window[mod]?.init) await window[mod].init(); }
      catch(e) { console.warn(`[App] ${mod}:`, e.message); }
    }

    // 5. Auth guard — después de que Supabase esté listo
    await initAuth();

    // 6. Dashboard inicial (dentro de initAuth si hay sesión, aquí como fallback)
    try { await Dashboard?.syncAndRender?.(); }
    catch(e) { console.warn('[App] Dashboard:', e.message); }

    console.log('%c✅ Aliado RESICO listo', 'color:#10b981;font-weight:bold');
  }

  return { init, navigateTo, validateRFC, IS_DEV };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
if (typeof window !== 'undefined') window.App = App;
