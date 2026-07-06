/* ============================================
   ALIADO RESICO — Auth Module v4.1 FINAL
   ✅ Demo funciona sin Supabase ni mock-data.js
   ✅ Dashboard referenciado via window (nunca directo)
   ✅ _wireAuthForm en un solo lugar
   ✅ Blindaje fiscal 2026: Art. 113-E, 17-K, 86-C CFF
   ============================================ */

const AuthManager = (() => {
  let _initialized = false;

  const FISCAL = {
    YEAR: 2026,
    INCOME_LIMIT: 3_500_000,
    ALERT_94: 3_290_000,
    MULTA_BUZON: 10_260,
    ART_113E: 'Art. 113-E LISR',
    ART_113F: 'Art. 113-F LISR',
    ART_17K:  'Art. 17-K CFF',
    ART_86C:  'Art. 86-C CFF',
  };

  // ── HELPERS DOM ──────────────────────────────
  function _showApp(user) {
    const overlay = document.getElementById('auth-overlay');
    const app     = document.getElementById('app');
    const chip    = document.getElementById('user-chip');
    const emailEl = document.getElementById('user-email-display');
    const logoutEl= document.getElementById('logout-btn');
    if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
    if (app)     { app.hidden = false; app.style.removeProperty('display'); }
    if (chip)    chip.hidden = !user;
    if (emailEl) emailEl.textContent = user?.email ?? '👤 Demo';
    if (logoutEl) logoutEl.hidden = false;
  }

  function _showLogin() {
    const overlay = document.getElementById('auth-overlay');
    const app     = document.getElementById('app');
    const chip    = document.getElementById('user-chip');
    const logoutEl= document.getElementById('logout-btn');
    if (overlay) { overlay.hidden = false; overlay.style.display = 'flex'; }
    if (app)     { app.hidden = true; app.style.display = 'none'; }
    if (chip)    chip.hidden = true;
    if (logoutEl) logoutEl.hidden = true;
  }

  function _showAuthMsg(el, text, isError) {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.className = isError ? 'auth-msg error' : 'auth-msg success';
  }

  // ── INIT ─────────────────────────────────────
  async function init() {
    if (_initialized) return;
    _initialized = true;

    _wireAuthForm();
    _wireLogout();

    const client = window.APP_STATE?.supabase;

    if (!client) {
      console.warn('[Auth] Supabase no disponible — habilitando Demo de emergencia.');
      enableDemoButton();
      _showLogin();
      return;
    }

    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (data?.session?.user) {
        _showApp(data.session.user);
        _postLoginInit();
        _subscribeAuthChanges(client);
        return;
      }
    } catch (e) {
      console.warn('[Auth] getSession error:', e.message);
    }

    _showLogin();
    _subscribeAuthChanges(client);
  }

  // ── AUTH STATE CHANGE ─────────────────────────
  // Guard anti-flash: solo actúa si la app está oculta
  function _subscribeAuthChanges(client) {
    if (!client) return;
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const appEl = document.getElementById('app');
        if (!appEl || appEl.hidden) {
          _showApp(session.user);
          _postLoginInit();
        }
        return;
      }
      if (event === 'SIGNED_OUT') {
        _showLogin();
      }
    });
  }

  // ── WIRE AUTH FORM ────────────────────────────
  function _wireAuthForm() {
    if (_wireAuthForm._wired) return;
    _wireAuthForm._wired = true;

    const emailInput  = document.getElementById('auth-email');
    const passInput   = document.getElementById('auth-password');
    const submitBtn   = document.getElementById('auth-submit');
    const msgEl       = document.getElementById('auth-msg');
    const demoBtn     = document.getElementById('auth-demo');
    const tabLogin    = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    if (!submitBtn) {
      console.error('[Auth] #auth-submit no encontrado — revisa el HTML');
      return;
    }

    let isRegister = false;

    tabLogin?.addEventListener('click', () => {
      isRegister = false;
      tabLogin.classList.add('active');
      tabRegister?.classList.remove('active');
      submitBtn.textContent = '🔐 Iniciar Sesión';
      if (msgEl) msgEl.hidden = true;
    });

    tabRegister?.addEventListener('click', () => {
      isRegister = true;
      tabRegister.classList.add('active');
      tabLogin?.classList.remove('active');
      submitBtn.textContent = '✅ Crear Cuenta';
      if (msgEl) msgEl.hidden = true;
    });

    submitBtn.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass  = passInput?.value;

      if (!email || !pass) {
        _showAuthMsg(msgEl, 'Ingresa tu correo y contraseña.', true);
        return;
      }

      // Resolver en tiempo de ejecución — nunca desde closure
      const client = window.APP_STATE?.supabase;

      if (!client) {
        enableDemoButton();
        _showAuthMsg(
          msgEl,
          '⚠️ Sin conexión al servidor. Usa el botón "Ver Demo" para continuar.',
          true
        );
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
            _showAuthMsg(msgEl, '✅ Cuenta creada. Confirma tu correo para acceder.', false);
            return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }
        _showApp(result.data.user);
        _postLoginInit();
      } catch (err) {
        const map = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed':        'Confirma tu correo antes de entrar.',
          'User already registered':    'Ese correo ya tiene cuenta — inicia sesión.',
        };
        _showAuthMsg(msgEl, map[err.message] || err.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); })
    );

    demoBtn?.addEventListener('click', _activateDemo);
  }

  // ── WIRE LOGOUT ───────────────────────────────
  function _wireLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (!logoutBtn || logoutBtn._logoutWired) return;
    logoutBtn._logoutWired = true;

    logoutBtn.addEventListener('click', async () => {
      try { await window.APP_STATE?.supabase?.auth.signOut(); } catch (_) {}
      if (window.Store?.reset) Store.reset();
      try { sessionStorage.clear(); } catch (_) {}
      // Remover banner demo si existe
      document.getElementById('demo-banner')?.remove();
      window.history.replaceState(null, '', window.location.pathname);
      window.history.pushState(null, '', window.location.pathname);
      _showLogin();
    });

    window.addEventListener('popstate', () => {
      const overlay = document.getElementById('auth-overlay');
      if (overlay && overlay.style.display !== 'none') {
        window.history.pushState(null, '', window.location.pathname);
      }
    });
  }

  // ── DEMO ──────────────────────────────────────
  function enableDemoButton() {
    const btn = document.getElementById('auth-demo');
    if (!btn) return;
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.title = 'Explorar con datos de demostración — sin cuenta requerida';
  }

  function _activateDemo() {
    _showDemoBanner();
    _showApp(null);
    // Cargar mock-data si existe el módulo externo
    if (window.MockData?.load && window.Store) {
      window.MockData.load(window.Store);
    } else {
      // Mock-data de emergencia integrado
      _loadEmergencyMockData();
    }
    // Dashboard via window — nunca referencia directa
    setTimeout(() => {
      if (window.Dashboard?.syncAndRender) window.Dashboard.syncAndRender();
      if (window.App?.initMonthlyTracker) window.App.initMonthlyTracker();
    }, 100);
    _injectWelcomeMessage(true);
  }

  function bypassToDemo() { _activateDemo(); }

  // ── MOCK DATA DE EMERGENCIA ───────────────────
  // Funciona aunque mock-data.js no esté cargado
  function _loadEmergencyMockData() {
    if (!window.APP_STATE) window.APP_STATE = {};
    window.APP_STATE.isDemo = true;
    window.APP_STATE.currentUser = { email: 'demo@aliado.resico', id: 'demo-001' };

    // Poblar store directamente si existe
    if (window.Store?.setState) {
      window.Store.setState({
        ingresos: [
          { id: 1, descripcion: 'Servicio de consultoría', monto: 45000, fecha: '2026-06-15', categoria: 'SERVICIO' },
          { id: 2, descripcion: 'Desarrollo web',         monto: 32000, fecha: '2026-05-20', categoria: 'SERVICIO' },
          { id: 3, descripcion: 'Asesoría fiscal',        monto: 18500, fecha: '2026-04-10', categoria: 'SERVICIO' },
        ],
        totalAnual: 95500,
        pagosISR: [
          { mes: 'Enero', estado: 'paid', monto: 955 },
          { mes: 'Febrero', estado: 'paid', monto: 1120 },
          { mes: 'Marzo', estado: 'paid', monto: 875 },
          { mes: 'Abril', estado: 'pending', monto: 0 },
          { mes: 'Mayo', estado: 'pending', monto: 0 },
          { mes: 'Junio', estado: 'pending', monto: 0 },
        ],
      });
    }
  }

  // ── DEMO BANNER ───────────────────────────────
  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:#92400e', 'color:#fef3c7', 'text-align:center',
      'padding:8px 16px', 'font-size:13px', 'font-weight:600', 'letter-spacing:.01em',
    ].join(';');
    banner.innerHTML =
      '⚠️ MODO DEMO — Datos ficticios, no fiscalmente vinculantes · ' +
      '<strong>Art. 17-K CFF:</strong> Buzón inactivo = multa hasta $10,260 MXN · ' +
      '<a href="#" id="demo-exit-link" style="color:#fde68a;text-decoration:underline;margin-left:8px">' +
      '← Iniciar sesión real</a>';
    document.body.prepend(banner);
    document.getElementById('demo-exit-link')?.addEventListener('click', e => {
      e.preventDefault();
      banner.remove();
      _showLogin();
    });
  }

  // ── POST LOGIN ────────────────────────────────
  function _postLoginInit() {
    if (window.Store?.initSupabase) Store.initSupabase();
    // Usar window.Dashboard — nunca referencia directa
    setTimeout(() => {
      if (window.Dashboard?.syncAndRender) window.Dashboard.syncAndRender();
    }, 80);
    _injectWelcomeMessage(false);
  }

  // ── MENSAJE BIENVENIDA FISCAL 2026 ────────────
  function _injectWelcomeMessage(isDemo) {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl) return;

    const ts = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.innerHTML = `
      <div class="bubble-content">
        <p>🛡️ <strong>Aliado RESICO — Ejercicio Fiscal ${FISCAL.YEAR}</strong>${isDemo ? ' <span style="color:#f59e0b;font-size:12px">[MODO DEMO]</span>' : ''}</p>
        <p>📊 <strong>${FISCAL.ART_113E}:</strong> Límite anual RESICO:
           <strong>$${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN</strong>.
           Al alcanzar el 94% (<strong>$${FISCAL.ALERT_94.toLocaleString('es-MX')} MXN</strong>)
           recibirás alerta automática de migración al Régimen General.</p>
        <p>📬 <strong>${FISCAL.ART_17K}:</strong> Buzón Tributario inactivo =
           multa hasta <strong>$${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN</strong>.
           Reincidencia lo <strong>duplica automáticamente</strong> (${FISCAL.ART_86C}).</p>
        <p>📋 <strong>${FISCAL.ART_113F}:</strong> Antes de confirmar tu obligación de
           Declaración Anual te preguntaré si tuviste ingresos mixtos
           (salarios &gt; $400k, intereses o dividendos).</p>
        <p>🔒 Datos blindados bajo <strong>LFPDPPP</strong> con <strong>RLS Supabase</strong> —
           ningún otro contribuyente puede ver tu información.</p>
        <p style="color:#6ee7b7;font-size:12px">💬 Escribe tu consulta fiscal y te respondo en segundos.</p>
      </div>
      <span class="bubble-time">${ts}</span>`;
    chatEl.appendChild(bubble);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  return { init, enableDemoButton, bypassToDemo };
})();

if (typeof window !== 'undefined') window.AuthManager = AuthManager;