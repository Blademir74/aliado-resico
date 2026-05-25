/* ============================================
   ALIADO RESICO — App Core v5.3
   Fix: chat form → Chat.sendMessage wired
   Fix: dev-config visible solo en localhost
   Fix: RFC validator standalone
   Fix: auth guard con Supabase
   Fix: proceso limpio sin process.env
   ============================================ */
const App = (() => {
  const VIEWS = ['dashboard', 'classifier', 'documents', 'settings'];
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
    document.querySelectorAll('.nav-btn[data-tab], .tab-btn[data-tab]').forEach(btn => {
      const match = btn.getAttribute('data-tab') === view;
      btn.classList.toggle('active', match);
      btn.setAttribute('aria-selected', String(match));
    });
    if (view === 'dashboard') setTimeout(() => Dashboard?.syncAndRender?.(), 60);
    window.location.hash = view;
  }

  function initNavigation() {
    document.querySelectorAll('[data-tab]').forEach(btn =>
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

  // ─── AUTH GUARD ──────────────────────────────────
  // Muestra el overlay de login si no hay sesión activa
  async function initAuth() {
    const overlay = document.getElementById('auth-overlay');
    const userChip = document.getElementById('user-session-chip');
    const emailEl  = document.getElementById('user-email-chip');

    if (!overlay) return; // Si no hay overlay en el HTML, continuar

    const client = window.APP_STATE?.supabase;

    // Modo demo (sin Supabase): saltar auth
    if (!client) {
      document.getElementById('auth-skip')?.addEventListener('click', () => {
        overlay.style.display = 'none';
      });
      overlay.style.display = 'flex';
      return;
    }

    // Verificar sesión existente
    try {
      const { data } = await client.auth.getSession();
      if (data?.session?.user) {
        _onAuthSuccess(data.session.user, overlay, userChip, emailEl);
        return;
      }
    } catch(_) {}

    // No hay sesión — mostrar overlay
    overlay.style.display = 'flex';
    _wireAuthForm(client, overlay, userChip, emailEl);
  }

  function _onAuthSuccess(user, overlay, userChip, emailEl) {
    if (overlay) overlay.style.display = 'none';
    if (userChip) userChip.style.display = 'block';
    if (emailEl) emailEl.textContent = user.email;
    console.log(`%c[Auth] ✅ ${user.email}`, 'color:#10b981;font-weight:bold');
  }

  function _wireAuthForm(client, overlay, userChip, emailEl) {
    const emailInput    = document.getElementById('auth-email');
    const passInput     = document.getElementById('auth-password');
    const submitBtn     = document.getElementById('auth-submit-btn');
    const errorEl       = document.getElementById('auth-error');
    const skipBtn       = document.getElementById('auth-skip');
    const tabLogin      = document.getElementById('auth-tab-login');
    const tabRegister   = document.getElementById('auth-tab-register');

    let isRegisterMode = false;

    tabLogin?.addEventListener('click', () => {
      isRegisterMode = false;
      submitBtn.textContent = '🔐 Iniciar Sesión';
      tabLogin.className = 'btn-primary';
      tabRegister.className = 'btn-ghost';
    });
    tabRegister?.addEventListener('click', () => {
      isRegisterMode = true;
      submitBtn.textContent = '✅ Crear Cuenta';
      tabRegister.className = 'btn-primary';
      tabLogin.className = 'btn-ghost';
    });

    submitBtn?.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass  = passInput?.value;
      if (!email || !pass) return;

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Procesando...';
      if (errorEl) errorEl.style.display = 'none';

      try {
        let result;
        if (isRegisterMode) {
          result = await client.auth.signUp({ email, password: pass });
          if (result.error) throw result.error;
          if (result.data?.user && !result.data.session) {
            if (errorEl) { errorEl.style.display = 'block'; errorEl.style.color = '#10b981'; errorEl.textContent = '✅ Cuenta creada. Revisa tu correo para confirmar.'; }
            submitBtn.disabled = false; submitBtn.textContent = 'Crear Cuenta'; return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }
        _onAuthSuccess(result.data.user, overlay, userChip, emailEl);
        await Store?.initSupabase?.();
        await Dashboard?.syncAndRender?.();
      } catch(err) {
        if (errorEl) { errorEl.style.display = 'block'; errorEl.style.color = '#ef4444'; errorEl.textContent = `❌ ${err.message}`; }
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegisterMode ? 'Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    // Enter en campos
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn?.click(); })
    );

    // Modo demo
    skipBtn?.addEventListener('click', () => { overlay.style.display = 'none'; });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', async () => {
      await client?.auth.signOut();
      overlay.style.display = 'flex';
      if (userChip) userChip.style.display = 'none';
    });
  }

  // ─── RFC VALIDATOR — standalone ──────────────────
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
      error: `Formato inválido (${rfc.length} chars). PF: 13 caracteres. PM: 12 caracteres.`,
    };
    const s = isPF ? 4 : 3;
    const dp = rfc.slice(s, s + 6);
    const yr = parseInt(dp.slice(0,2), 10);
    const yr4 = yr <= 24 ? 2000+yr : 1900+yr;
    return {
      valid: true, type: isPF ? 'Persona Física' : 'Persona Moral',
      date: `${yr4}-${dp.slice(2,4)}-${dp.slice(4,6)}`, rfc,
    };
  }

  // ─── SETTINGS ────────────────────────────────────
  function initSettings() {
    // Dev panel: solo en localhost
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
          ? `<span class="success">✅ ${r.type} — <code>${r.rfc}</code><br><small>Fecha nacimiento/constitución: ${r.date}</small></span>`
          : `<span class="error">❌ ${r.error}</span>`;
      };
      rfcBtn.addEventListener('click', run);
      rfcInput.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    }

    // Refresh feed
    document.getElementById('refresh-feed')?.addEventListener('click', () =>
      Dashboard?.syncAndRender?.()
    );

    // Dev: test buttons
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

  // ─── CHAT — conecta el form del HTML con Chat.js ──
  // El HTML usa: form#classifier-form + input#classifier-input
  // Chat.js escucha: #btn-send + #chat-input
  // Fix: interceptar el form submit aquí y delegar a Chat.sendMessage
  function initChat() {
    const form  = document.getElementById('classifier-form');
    const input = document.getElementById('classifier-input');

    if (!form || !input) return;

    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;

      if (window.Chat?.sendMessage) {
        // Monkeypatch: Chat.js lee #chat-input, así que sincronizamos el valor
        const chatInput = document.getElementById('chat-input');
        if (chatInput) chatInput.value = text;
        Chat.sendMessage(text);
        input.value = '';
      } else {
        _fallbackSend(text, input);
      }
    });

    // Quick examples — el HTML usa .example-btn[data-msg]
    document.querySelectorAll('.example-btn[data-msg]').forEach(btn =>
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-msg');
        form.dispatchEvent(new Event('submit', { bubbles: true }));
      })
    );
  }

  async function _fallbackSend(text, input) {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl) return;

    const ts = () => new Date().toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'});

    const userB = document.createElement('div');
    userB.className = 'chat-bubble user';
    userB.innerHTML = `<p>${text.replace(/</g,'&lt;')}</p><span class="bubble-time">${ts()}</span>`;
    chatEl.appendChild(userB);
    chatEl.scrollTop = chatEl.scrollHeight;
    if (input) input.value = '';

    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    chatEl.appendChild(typing);
    chatEl.scrollTop = chatEl.scrollHeight;

    try {
      // Intentar proxy Gemini con contexto fiscal RESICO
      const session = await window.APP_STATE?.supabase?.auth.getSession();
      const token   = session?.data?.session?.access_token;

      const payload = {
        contents: [{
          parts: [{
            text: `Eres Aliado RESICO, asistente fiscal IA para el Régimen Simplificado de Confianza en México. 
Responde en español, de forma concisa y práctica. Cita artículos del CFF/LISR cuando aplique.
REGLA CLAVE: En RESICO el ISR se paga sobre ingresos BRUTOS (sin deducciones). El IVA sí requiere CFDI válido.
Consulta del contribuyente: ${text}`,
          }],
        }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
      };

      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const r = await fetch('/api/gemini-proxy', {
        method: 'POST', headers, body: JSON.stringify(payload),
      });

      let botText = '';
      if (r.ok) {
        const d = await r.json();
        botText = d.candidates?.[0]?.content?.parts?.[0]?.text
          || d.response
          || 'Sin respuesta del servidor.';
      } else {
        // Fallback local por intención
        const intents = {
          deducir: '📘 En RESICO **no aplican deducciones** para el ISR. Tu impuesto se calcula sobre ingresos brutos. (Art. 113-E LISR 2024)',
          factura: '📑 Para timbrar un CFDI 4.0 necesitas: RFC receptor válido, régimen fiscal, código postal, descripción del servicio y forma de pago.',
          gasto:   '🧾 Para acreditar IVA de un gasto, el CFDI debe tener tu RFC correcto y ser un gasto estrictamente indispensable. (Art. 5 LIVA)',
          buzon:   '📬 El Buzón Tributario debe estar activo. Si no lo está, la multa es de $10,260 MXN por primera vez (Art. 17-K CFF).',
          default: '🤖 Entendido. Para orientarte mejor, ¿se trata de un gasto, una factura o una consulta sobre tu declaración?',
        };
        const lower = text.toLowerCase();
        botText = Object.entries(intents).find(([k]) => lower.includes(k))?.[1] || intents.default;
      }

      typing.remove();
      const botB = document.createElement('div');
      botB.className = 'chat-bubble bot';
      botB.innerHTML = `<p>${botText.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')}</p><span class="bubble-time">${ts()}</span>`;
      chatEl.appendChild(botB);
      chatEl.scrollTop = chatEl.scrollHeight;

      // Guardar en Store
      if (window.Store) {
        Store.addConversation({
          id: `c-${Date.now()}`, text, sender: 'Usuario',
          time: ts(), intent: 'CONSULTA_FISCAL', confidence: 0.9,
          keywords: [], response: botText, source: r.ok ? 'gemini' : 'local',
          timestamp: Date.now(),
        });
      }
    } catch(err) {
      typing.remove();
      const errB = document.createElement('div');
      errB.className = 'chat-bubble bot';
      errB.innerHTML = `<p>❌ ${err.message}</p><span class="bubble-time">${ts()}</span>`;
      chatEl.appendChild(errB);
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
        const conf = res.data?.confidence ?? 1;
        if (/cfdi|factura|xml/i.test(file.name) && conf < 0.97) {
          html += `<div class="alert-warning">⚠️ Precisión ${(conf*100).toFixed(1)}% &lt; 97% requerido para acreditamiento IVA<br><small>Art. 5 LIVA | Regla 2.7.1.19 RMF 2024</small></div>`;
        }
        if (res.needsHumanReview) html += `<div class="alert-warning">⚠️ ${res.humanReviewReason||'Revisión recomendada'}</div>`;
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
    const session = await window.APP_STATE?.supabase?.auth.getSession();
    const token   = session?.data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch('/api/gemini-proxy', {
      method: 'POST', headers,
      body: JSON.stringify({
        contents: [{ parts: [
          { text: 'Eres OCR fiscal mexicano. Extrae JSON: {document_type,confidence,emisor_rfc,total,iva,fecha,folio}. SOLO JSON, sin texto adicional.' },
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
    return { data, needsHumanReview: (data.confidence||0) < 0.85, humanReviewReason: 'Confianza baja' };
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
    console.log('%c🧠 Aliado RESICO v5.3', 'color:#10b981;font-weight:bold;font-size:14px');

    initTheme();
    initNavigation();
    initSettings();
    initChat();
    initDocuments();

    await _waitForCDN('supabase', 4000);

    if (typeof initDatabase === 'function') {
      try { await initDatabase(); } catch(e) { console.warn('[App] BD offline:', e.message); }
    }

    for (const mod of ['Store','IntentClassifier','DocumentProcessor','Dashboard','Chat','ConversationManager']) {
      try { if (window[mod]?.init) await window[mod].init(); }
      catch(e) { console.warn(`[App] ${mod}:`, e.message); }
    }

    // Auth guard — después de que Supabase esté listo
    await initAuth();

    try { await Dashboard?.syncAndRender?.(); } catch(e) { console.warn('[App] Dashboard sync:', e.message); }

    console.log('%c✅ Aliado RESICO listo', 'color:#10b981;font-weight:bold');
  }

  return { init, navigateTo, validateRFC, IS_DEV };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
if (typeof window !== 'undefined') window.App = App;
