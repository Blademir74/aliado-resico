/* ════════════════════════════════════════════════
   ALIADO RESICO — App Core v6.0
   ✅ Sin process.env en browser
   ✅ Auth IDs alineados al HTML
   ✅ Monthly Tracker con persistencia localStorage
   ✅ Chat wired a #classifier-form
   ✅ RFC validator standalone
   ✅ DEVOLUCION_SALDO_A_FAVOR manejada
   ════════════════════════════════════════════════ */
const App = (() => {
  const VIEWS = ['dashboard', 'classifier', 'documents'];
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
  // AUTH GUARD
  // IDs del HTML: #auth-overlay, #auth-submit,
  // #auth-email, #auth-password, #auth-msg,
  // #auth-demo, #tab-login, #tab-register,
  // #app, #user-chip, #user-email-display, #logout-btn
  // ══════════════════════════════════════════════
  async function initAuth() {
    const overlay   = document.getElementById('auth-overlay');
    const appEl     = document.getElementById('app');
    const chip      = document.getElementById('user-chip');
    const emailEl   = document.getElementById('user-email-display');
    const logoutBtn = document.getElementById('logout-btn');
    if (!overlay || !appEl) return;

    const client = window.APP_STATE?.supabase;

    if (!client) {
      // Sin Supabase — modo demo directo
      _showApp(overlay, appEl, chip, emailEl, logoutBtn, null);
      return;
    }

    try {
      const { data } = await client.auth.getSession();
      if (data?.session?.user) {
        _showApp(overlay, appEl, chip, emailEl, logoutBtn, data.session.user);
        return;
      }
    } catch(_) {}

    _showOverlay(overlay, appEl);
    _wireAuthForm(client, overlay, appEl, chip, emailEl, logoutBtn);
  }

  function _showApp(overlay, appEl, chip, emailEl, logoutBtn, user) {
    overlay.style.display = 'none';
    appEl.hidden = false;
    if (chip) { chip.hidden = !user; }
    if (emailEl && user) emailEl.textContent = user.email;
    if (logoutBtn) logoutBtn.hidden = !user;
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
    const emailInput  = document.getElementById('auth-email');
    const passInput   = document.getElementById('auth-password');
    const submitBtn   = document.getElementById('auth-submit');
    const msgEl       = document.getElementById('auth-msg');
    const demoBtn     = document.getElementById('auth-demo');
    const tabLogin    = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    let isRegister = false;

    tabLogin?.addEventListener('click', () => {
      isRegister = false;
      tabLogin.classList.add('active'); tabRegister?.classList.remove('active');
      if (submitBtn) submitBtn.textContent = '🔐 Iniciar Sesión';
      if (msgEl) msgEl.hidden = true;
    });
    tabRegister?.addEventListener('click', () => {
      isRegister = true;
      tabRegister.classList.add('active'); tabLogin?.classList.remove('active');
      if (submitBtn) submitBtn.textContent = '✅ Crear Cuenta';
      if (msgEl) msgEl.hidden = true;
    });

    submitBtn?.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass  = passInput?.value;
      if (!email || !pass) { _showAuthMsg(msgEl, 'Ingresa tu correo y contraseña.', true); return; }

      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Procesando…';
      if (msgEl) msgEl.hidden = true;

      try {
        let result;
        if (isRegister) {
          result = await client.auth.signUp({ email, password: pass });
          if (result.error) throw result.error;
          if (result.data?.user && !result.data.session) {
            _showAuthMsg(msgEl, '✅ Cuenta creada. Revisa tu correo para confirmar el acceso.', false);
            submitBtn.disabled = false; submitBtn.textContent = 'Crear Cuenta'; return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }
        const user = result.data.user;
        _showApp(overlay, appEl, chip, emailEl, logoutBtn, user);
        if (Store?.initSupabase) await Store.initSupabase();
        if (Dashboard?.syncAndRender) await Dashboard.syncAndRender();
      } catch(err) {
        const map = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed': 'Confirma tu correo antes de entrar.',
          'User already registered': 'Ese correo ya tiene cuenta — inicia sesión.',
        };
        _showAuthMsg(msgEl, map[err.message] || err.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? 'Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn?.click(); })
    );

    demoBtn?.addEventListener('click', () => {
      _showApp(overlay, appEl, chip, emailEl, logoutBtn, null);
      if (MockData) MockData.load(window.Store);
    });

    logoutBtn?.addEventListener('click', async () => {
      await client?.auth.signOut();
      chip && (chip.hidden = true);
      if (emailEl) emailEl.textContent = '';
      if (logoutBtn) logoutBtn.hidden = true;
      _showOverlay(overlay, appEl);
    });

    client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        _showOverlay(overlay, appEl);
        if (chip) chip.hidden = true;
        if (logoutBtn) logoutBtn.hidden = true;
      }
    });
  }

  // ══════════════════════════════════════════════
  // MONTHLY STATUS TRACKER
  // Art. 113-E LISR — pagos definitivos mensuales
  // Persistencia: localStorage por año + RFC
  // ══════════════════════════════════════════════
  const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const YEAR  = new Date().getFullYear();
  const MONTH_NOW = new Date().getMonth(); // 0-indexed

  function _getMonthlyKey() {
    const user = window.APP_STATE?.currentUser;
    const uid  = user?.id || 'demo';
    return `ar_monthly_${YEAR}_${uid}`;
  }

  function _loadMonthlyState() {
    try {
      const raw = localStorage.getItem(_getMonthlyKey());
      if (raw) return JSON.parse(raw);
    } catch(_) {}
    // Estado inicial: meses pasados pendientes, futuros = future
    const state = {};
    MESES.forEach((_, i) => {
      state[i] = i < MONTH_NOW ? 'pending' : i === MONTH_NOW ? 'pending' : 'future';
    });
    return state;
  }

  function _saveMonthlyState(state) {
    try { localStorage.setItem(_getMonthlyKey(), JSON.stringify(state)); } catch(_) {}
  }

  function initMonthlyTracker() {
    const grid = document.getElementById('monthly-grid');
    const summary = document.getElementById('monthly-summary');
    if (!grid) return;

    let state = _loadMonthlyState();

    function render() {
      grid.innerHTML = '';
      let paidCount = 0, overdueCount = 0;

      MESES.forEach((mes, i) => {
        const s = state[i];
        if (s === 'paid') paidCount++;
        if (s === 'overdue' || (s === 'pending' && i < MONTH_NOW)) overdueCount++;

        const cell = document.createElement('button');
        cell.type = 'button';
        const effectiveState = (s === 'pending' && i < MONTH_NOW) ? 'overdue' : s;
        cell.className = `month-cell ${effectiveState}`;
        cell.setAttribute('aria-label', `${mes} ${YEAR}: ${_statusLabel(effectiveState)}`);
        cell.innerHTML = `
          <span class="month-name">${mes}</span>
          <span class="month-status-icon">${_statusIcon(effectiveState)}</span>
          <span class="month-check">✓</span>
        `;
        if (effectiveState !== 'future') {
          cell.addEventListener('click', () => {
            state[i] = state[i] === 'paid' ? 'pending' : 'paid';
            _saveMonthlyState(state);
            render();
          });
        }
        grid.appendChild(cell);
      });

      const total = MONTH_NOW; // meses que ya pasaron
      if (summary) {
        if (paidCount === 0 && total === 0) {
          summary.textContent = `Ejercicio ${YEAR} — Marca los pagos presentados`;
        } else {
          summary.textContent = `${paidCount}/${total} pagos presentados${overdueCount > 0 ? ` · ⚠️ ${overdueCount} posiblemente pendiente${overdueCount>1?'s':''}` : ' ✅'}`;
        }
      }
    }

    function _statusIcon(s) {
      return { paid:'✅', pending:'⏳', overdue:'🔴', future:'—' }[s] || '—';
    }
    function _statusLabel(s) {
      return { paid:'Presentado', pending:'Pendiente', overdue:'Posiblemente atrasado', future:'Aún no aplica' }[s] || '';
    }

    render();
  }

  // ══════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════
  function initSettings() {
    const devPanel = document.getElementById('dev-config');
    if (devPanel) devPanel.hidden = !IS_DEV;

    document.getElementById('refresh-feed')?.addEventListener('click', () =>
      Dashboard?.syncAndRender?.()
    );
    document.getElementById('gemini-test')?.addEventListener('click', async () => {
      try {
        const r = await fetch('/api/gemini-proxy', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ contents:[{parts:[{text:'Di solo OK'}]}] }),
        });
        alert(r.ok ? '✅ Proxy Gemini OK' : `❌ Error ${r.status}`);
      } catch(e) { alert('❌ '+e.message); }
    });
    document.getElementById('supabase-test')?.addEventListener('click', async () => {
      const c = window.APP_STATE?.supabase;
      if (!c) return alert('❌ Supabase no inicializado');
      try {
        const {error} = await c.from('conversations').select('id').limit(1);
        alert(error ? `❌ ${error.message}` : '✅ Supabase OK con RLS activo');
      } catch(e) { alert('❌ '+e.message); }
    });
  }

  // ══════════════════════════════════════════════
  // RFC VALIDATOR — standalone
  // ══════════════════════════════════════════════
  const RFC_PF  = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
  const RFC_PM  = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
  const RFC_GEN = ['XAXX010101000','XEXX010101000'];

  function validateRFC(raw) {
    if (!raw?.trim()) return { valid:false, error:'Ingresa un RFC.' };
    const rfc = raw.trim().toUpperCase().replace(/\s/g,'');
    if (RFC_GEN.includes(rfc)) return { valid:true, type:'RFC Genérico SAT', date:'N/A', rfc };
    const isPF = RFC_PF.test(rfc), isPM = RFC_PM.test(rfc);
    if (!isPF && !isPM) return { valid:false, error:`Formato inválido (${rfc.length} chars). PF: 13 · PM: 12.` };
    const s = isPF ? 4 : 3, dp = rfc.slice(s, s+6);
    const yr = parseInt(dp.slice(0,2),10);
    return { valid:true, type: isPF?'Persona Física':'Persona Moral', date:`${yr<=24?2000+yr:1900+yr}-${dp.slice(2,4)}-${dp.slice(4,6)}`, rfc };
  }

  function initRFC() {
    const btn = document.getElementById('rfc-validate-btn');
    const inp = document.getElementById('rfc-input');
    const res = document.getElementById('rfc-result');
    if (!btn || !inp || !res) return;
    const run = () => {
      const r = validateRFC(inp.value);
      res.innerHTML = r.valid
        ? `<span class="success">✅ ${r.type} — <code>${r.rfc}</code><br><small>Fecha: ${r.date}</small></span>`
        : `<span class="error">❌ ${r.error}</span>`;
    };
    btn.addEventListener('click', run);
    inp.addEventListener('keydown', e => { if(e.key==='Enter') run(); });
    inp.addEventListener('input', () => { inp.value = inp.value.toUpperCase(); });
  }

  // ══════════════════════════════════════════════
  // CHAT — conecta #classifier-form con el proxy
  // ══════════════════════════════════════════════
  function initChat() {
    const form   = document.getElementById('classifier-form');
    const input  = document.getElementById('classifier-input');
    const chatEl = document.getElementById('chat-messages');
    if (!form || !input || !chatEl) return;

    // Mensaje de bienvenida inicial
    if (!chatEl.children.length) {
      _appendBot(chatEl,
        '👋 Hola. Soy tu Asistente Fiscal RESICO.<br>' +
        'Puedo orientarte sobre ISR, IVA, facturas, saldo a favor y salud fiscal.<br>' +
        '<small style="color:var(--text-muted)">Recuerda que mis respuestas son orientativas — siempre confirma con tu contador.</small>'
      );
    }

    form.addEventListener('submit', e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      if (window.Chat?.sendMessage) {
        const ci = document.getElementById('chat-input');
        if (ci) ci.value = text;
        Chat.sendMessage(text);
        input.value = '';
      } else {
        _sendMessage(text, input, chatEl);
      }
    });

    document.querySelectorAll('.example-btn[data-msg]').forEach(btn =>
      btn.addEventListener('click', () => {
        input.value = btn.getAttribute('data-msg');
        form.dispatchEvent(new Event('submit', {bubbles:true}));
      })
    );
  }

  function _appendBot(chatEl, html) {
    const ts = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
    const b = document.createElement('div');
    b.className = 'chat-bubble bot';
    b.innerHTML = `<p>${html}</p><span class="bubble-time">${ts}</span>`;
    chatEl.appendChild(b);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  async function _sendMessage(text, input, chatEl) {
    // Sanitizar contra prompt injection antes de enviar a Gemini
    if (window.InputSanitizer?.sanitizeForAI) text = window.InputSanitizer.sanitizeForAI(text);
    const ts = () => new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});

    // Burbuja usuario
    const uB = document.createElement('div');
    uB.className = 'chat-bubble user';
    uB.innerHTML = `<p>${_esc(text)}</p><span class="bubble-time">${ts()}</span>`;
    chatEl.appendChild(uB);
    chatEl.scrollTop = chatEl.scrollHeight;
    input.value = '';

    // Typing
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.innerHTML = '<span></span><span></span><span></span>';
    chatEl.appendChild(typing);
    chatEl.scrollTop = chatEl.scrollHeight;

    try {
      // Clasificar
      let cls = { intent:'OTROS', confidence:.5, resico_context:null, salud_fiscal_alerta:null };
      if (window.IntentClassifier?.classify) {
        cls = await IntentClassifier.classify(text);
      }

      // Actualizar panel de análisis
      _updateResultPanel(cls, text);

      // Llamar proxy Gemini
      const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
      const token   = session?.data?.session?.access_token;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const SYSTEM = `Eres Aliado RESICO, asistente fiscal IA para México. Responde en español, de forma concisa y práctica. Máx 200 palabras. Cita artículos del CFF/LISR cuando aplique.
REGLAS FISCALES:
- ISR RESICO: sobre ingresos efectivamente cobrados, sin deducciones (Art. 113-E LISR). Tasas 1%–2.5% mensual.
- RESICO SÍ tiene declaración anual simplificada en abril (Art. 113-F LISR). NO digas que no hay declaración anual.
- IVA: requiere CFDI 4.0 válido para acreditamiento (Art. 5 LIVA).
- Saldo a favor: SÍ es posible en RESICO, PERO requiere buzón activo, declaraciones al corriente y e.firma vigente para tramitar devolución.
- Buzón Tributario (Art. 17-K CFF): su inactividad no solo genera multa — el plazo legal corre aunque no lo leas.
- Límite RESICO: $3,500,000 MXN/año (Art. 113-E, fracc. III LISR).`;

      const r = await fetch('/api/gemini-proxy', {
        method:'POST', headers,
        body: JSON.stringify({
          contents:[{parts:[{text:`${SYSTEM}\n\nConsulta: ${text}`}]}],
          generationConfig:{temperature:.3, maxOutputTokens:600},
        }),
      });

      let botText = '';
      if (r.ok) {
        const d = await r.json();
        botText = d.candidates?.[0]?.content?.parts?.[0]?.text || '⚠️ Sin respuesta.';
      } else {
        botText = _localFallback(cls.intent);
      }

      typing.remove();
      const bB = document.createElement('div');
      bB.className = 'chat-bubble bot';
      bB.innerHTML = `<p>${_mdToHtml(botText)}</p>`;

      // Mostrar alerta de salud fiscal si aplica
      if (cls.salud_fiscal_alerta) {
        bB.innerHTML += `<div class="bubble-alert">⚠️ ${_esc(cls.salud_fiscal_alerta)}</div>`;
      }
      bB.innerHTML += `<span class="bubble-time">${ts()}</span>`;
      chatEl.appendChild(bB);
      chatEl.scrollTop = chatEl.scrollHeight;

      if (window.Store) {
        Store.addConversation({
          id:`c-${Date.now()}`, text, sender:'Usuario', time:ts(),
          intent:cls.intent, confidence:cls.confidence,
          keywords:cls.keywords_matched||[], response:botText,
          source: r.ok?'gemini':'local', timestamp:Date.now(),
        });
      }
    } catch(err) {
      typing.remove();
      const errB = document.createElement('div');
      errB.className = 'chat-bubble bot';
      errB.innerHTML = `<p>❌ ${_esc(err.message)}</p><span class="bubble-time">${ts()}</span>`;
      chatEl.appendChild(errB);
    }
  }

  function _updateResultPanel(cls, text) {
    const emptyEl   = document.getElementById('classification-empty');
    const contentEl = document.getElementById('classification-content');
    if (emptyEl)  emptyEl.hidden = true;
    if (contentEl) contentEl.hidden = false;

    const CFG = window.CATEGORY_CONFIG || {};
    const cat = CFG[cls.intent] || { label:cls.intent, icon:'💬', cssClass:'otros' };

    const intentEl = document.getElementById('result-intent');
    if (intentEl) intentEl.innerHTML = `<span class="cat-badge ${cat.cssClass}">${cat.icon} ${cat.label}</span>`;

    const pct = Math.round((cls.confidence||0)*100);
    const barEl = document.getElementById('result-confidence-bar');
    const valEl = document.getElementById('result-confidence-val');
    if (barEl) barEl.style.width = pct+'%';
    if (valEl) valEl.textContent = pct+'%';

    const kwEl = document.getElementById('result-keywords');
    if (kwEl) {
      kwEl.innerHTML = (cls.keywords_matched||[]).map(k =>
        `<span class="keyword-tag">${_esc(k)}</span>`
      ).join('') || '<span style="color:var(--text-muted);font-size:.7rem">—</span>';
    }

    const srcEl = document.getElementById('result-source');
    if (srcEl) srcEl.innerHTML = `<span class="source-badge ${cls.source==='gemini_proxy'?'gemini':'local'}">${cls.source==='gemini_proxy'?'Gemini IA':'Local'}</span>`;

    const ctxEl = document.getElementById('result-resico-context');
    if (ctxEl) {
      if (cls.resico_context) { ctxEl.textContent = cls.resico_context; ctxEl.hidden = false; }
      else ctxEl.hidden = true;
    }

    const saludEl = document.getElementById('result-salud-alerta');
    if (saludEl) {
      if (cls.salud_fiscal_alerta) { saludEl.textContent = cls.salud_fiscal_alerta; saludEl.hidden = false; }
      else saludEl.hidden = true;
    }
  }

  function _localFallback(intent) {
    const r = {
      CONSULTA_FISCAL:          '📘 En RESICO el ISR se calcula sobre ingresos efectivamente cobrados, sin deducciones (Art. 113-E LISR). Tasas: 1% a 2.5% mensual. ¿Sobre qué aspecto quieres más detalle?',
      SOLICITUD_FACTURA:        '📑 Para timbrar un CFDI 4.0 necesitas: RFC del receptor, régimen fiscal, código postal, descripción del servicio y forma de pago.',
      REGISTRO_GASTO:           '🧾 Para acreditar IVA de este gasto, el CFDI debe tener tu RFC correcto y el gasto debe ser estrictamente indispensable (Art. 5 LIVA). El ISR RESICO no permite deducirlo.',
      REPORTE_PAGO:             '💳 Registrado. Recuerda: en RESICO, el ISR se paga sobre lo efectivamente cobrado, no sobre lo facturado.',
      SALUD_FISCAL:             '🏥 Buzón Tributario: ACTÍVALO. Si el SAT te envió una notificación y no la leíste, el plazo legal corre igual. Multa hasta $10,260 MXN (Art. 17-K CFF).',
      DEVOLUCION_SALDO_A_FAVOR: '💰 SÍ puedes tener saldo a favor en RESICO. Para tramitar la devolución necesitas: buzón activo, declaraciones al corriente, e.firma vigente y no tener requerimientos abiertos. Solicítala en el portal del SAT.',
      OTROS:                    '🤖 Soy Aliado RESICO. Puedo orientarte sobre ISR, IVA, facturas, saldo a favor o salud fiscal. ¿Con qué te ayudo?',
    };
    return r[intent] || r.OTROS;
  }

  function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function _mdToHtml(s) {
    return s
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  // ══════════════════════════════════════════════
  // OCR
  // ══════════════════════════════════════════════
  function initDocuments() {
    const zone   = document.getElementById('drop-zone');
    const input  = document.getElementById('file-input');
    const output = document.getElementById('ocr-output');
    if (!zone) return;

    zone.addEventListener('click', () => input?.click());
    zone.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' ') input?.click(); });
    ['dragenter','dragover','dragleave','drop'].forEach(e =>
      zone.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); })
    );
    ['dragenter','dragover'].forEach(e => zone.addEventListener(e, () => zone.classList.add('drag-over')));
    ['dragleave','drop'].forEach(e => zone.addEventListener(e, () => zone.classList.remove('drag-over')));

    const handle = async file => {
      if (!file || !output) return;
      output.innerHTML = '<div class="loading">🔄 Extrayendo datos fiscales…</div>';
      try {
        let res = window.DocumentProcessor?.processImage
          ? await DocumentProcessor.processImage(file)
          : await _ocrFallback(file);

        let html = `<pre class="ocr-json">${JSON.stringify(res.data, null, 2)}</pre>`;
        const conf      = res.data?.confidence ?? 1;
        const isFactura = /cfdi|factura|xml/i.test(file.name) || res.data?.document_type === 'CFDI';

        if (isFactura && conf < 0.97)
          html += `<div class="alert-warning">⚠️ Precisión ${(conf*100).toFixed(1)}% — Se requiere ≥97% para garantizar el acreditamiento de IVA.<br><small>Art. 5 LIVA | Regla 2.7.1.19 RMF 2024</small></div>`;
        if (res.needsHumanReview)
          html += `<div class="alert-warning">⚠️ ${res.humanReviewReason || 'Revisión humana recomendada'}</div>`;
        if (res.data?._rfc_emisor_valid === false)
          html += `<div class="alert-error">❌ RFC del emisor inválido — este CFDI no es acreditable para IVA</div>`;
        if (!isFactura)
          html += `<div class="alert-warning" style="background:rgba(59,130,246,.07);border-color:rgba(59,130,246,.25);color:#93c5fd">📘 ISR RESICO: este gasto no es deducible para ISR. Para IVA, verifica que el CFDI tenga tu RFC correcto (Art. 5 LIVA).</div>`;

        output.innerHTML = html;
        if (window.Store) Store.saveDocument({ ...res, fileName: file.name });
      } catch(err) {
        output.innerHTML = `<p class="error">❌ ${_esc(err.message)}</p>`;
      }
    };

    zone.addEventListener('drop', e => handle(e.dataTransfer.files[0]));
    input?.addEventListener('change', e => handle(e.target.files[0]));
  }

  async function _ocrFallback(file) {
    const b64 = await new Promise((res,rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]); r.onerror = rej;
      r.readAsDataURL(file);
    });
    const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
    const token   = session?.data?.session?.access_token;
    const headers = {'Content-Type':'application/json'};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetch('/api/gemini-proxy', {
      method:'POST', headers,
      body: JSON.stringify({
        contents:[{parts:[
          {text:'Eres OCR fiscal mexicano. Extrae JSON: {document_type,confidence,emisor_rfc,receptor_rfc,total,iva,subtotal,fecha,folio,forma_pago}. SOLO JSON, sin texto adicional.'},
          {inline_data:{mime_type:file.type||'image/jpeg',data:b64}},
        ]}],
        generationConfig:{temperature:.05,maxOutputTokens:500},
      }),
    });
    if (!resp.ok) throw new Error(`OCR HTTP ${resp.status} — verifica GEMINI_API_KEY en Vercel`);
    const d = await resp.json();
    const txt = d.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const clean = txt.replace(/```json|```/g,'').trim();
    let data = {};
    try { data = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}')+1)); } catch(_) {}
    return { data, needsHumanReview:(data.confidence||0)<.85, humanReviewReason:'Confianza baja — revisa los datos', confidence:data.confidence||0 };
  }

  // ══════════════════════════════════════════════
  // AUTH CALLBACK — confirmación de email Supabase
  // Procesa ?token_hash=...&type=email en la URL
  // ══════════════════════════════════════════════
  async function _handleAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get('token_hash');
    const type      = params.get('type');
    if (!tokenHash || !type) return;

    // Esperar cliente Supabase
    if (typeof initDatabase === 'function') {
      try { await initDatabase(); } catch(_) {}
    }

    const client = window.APP_STATE?.supabase;
    if (!client) return;

    try {
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        console.error('[Auth] Error verificando token:', error.message);
      } else {
        console.log('[Auth] ✅ Email confirmado correctamente');
        // Limpiar URL sin recargar
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch(e) {
      console.warn('[Auth] Callback error:', e.message);
    }
  }

  // ══════════════════════════════════════════════
  // BOOT — secuencia robusta v6.1
  // Supabase CDN carga sin defer (síncrono)
  // app.js carga sin defer, se auto-invoca
  // ══════════════════════════════════════════════
  async function init() {
    console.log('%c🛡️ Aliado RESICO v6.1', 'color:#10b981;font-weight:bold;font-size:14px');

    // 0. Manejar callback de confirmación de email (token_hash en URL)
    await _handleAuthCallback();

    // 1. Módulos UI síncronos — siempre primero
    initTheme();
    initNavigation();
    initSettings();
    initRFC();
    initChat();
    initDocuments();

    // 2. Supabase CDN ya cargó sin defer — instanciar cliente
    if (typeof initDatabase === 'function') {
      try { await initDatabase(); }
      catch(e) { console.warn('[App] BD offline:', e.message); }
    } else {
      console.warn('[App] initDatabase no disponible — modo offline');
    }

    // 3. Módulos de negocio
    for (const mod of ['Store','IntentClassifier','DocumentProcessor','Dashboard','Chat','ConversationManager']) {
      try { if (window[mod]?.init) await window[mod].init(); }
      catch(e) { console.warn(`[App] ${mod}:`, e.message); }
    }

    // 4. Auth guard — después de que Supabase esté listo
    await initAuth();

    // 5. Datos demo
    if (window.MockData && window.Store) {
      MockData.load(Store);
    }

    // 6. Monthly tracker
    initMonthlyTracker();

    // 7. Dashboard
    try { await Dashboard?.syncAndRender?.(); }
    catch(e) { console.warn('[App] Dashboard:', e.message); }

    console.log('%c✅ Aliado RESICO listo', 'color:#10b981;font-weight:bold');
  }

  return { init, navigateTo, validateRFC, IS_DEV };
})();

// Auto-boot: app.js carga sin defer, DOM ya está listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  // DOM ya cargado (script al final del body sin defer)
  App.init();
}

if (typeof window !== 'undefined') window.App = App;
