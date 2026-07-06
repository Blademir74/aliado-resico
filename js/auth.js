/* ============================================
   ALIADO RESICO — Auth Module v4.0 STABLE
   Fix: _wireAuthForm ÚNICO — eliminado de app.js
   Fix: onAuthStateChange con guard anti-flash
   Fix: Demo habilitado inmediato si Supabase falla
   Fix: Textos fiscales 2026 (Art. 113-E, 17-K, 86-C CFF)
   LFPDPPP | RLS Supabase | Node.js 24.x
   ============================================ */

const AuthManager = (() => {
  let _initialized = false;

  // ── CONSTANTES FISCALES 2026 ──────────────────
  const FISCAL = {
    YEAR: 2026,
    INCOME_LIMIT: 3_500_000,
    ALERT_94_PCT: 3_290_000,   // 94% de 3.5M
    MULTA_BUZON: 10_260,
    ART_113E: 'Art. 113-E LISR',
    ART_113F: 'Art. 113-F LISR',
    ART_17K:  'Art. 17-K CFF',
    ART_86C:  'Art. 86-C CFF',
  };

  // ── HELPERS DOM ───────────────────────────────
  function _showApp(user) {
    const overlay = document.getElementById('auth-overlay');
    const app     = document.getElementById('app');
    const chip    = document.getElementById('user-chip');
    const emailEl = document.getElementById('user-email-display');
    const logoutEl= document.getElementById('logout-btn');

    if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
    if (app)     { app.hidden = false; app.style.removeProperty('display'); }
    if (chip)    chip.hidden = !user;
    if (emailEl && user) emailEl.textContent = user.email ?? '';
    if (logoutEl) logoutEl.hidden = !user;
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

  // ── INIT PRINCIPAL ────────────────────────────
  // Llamado UNA SOLA VEZ desde app.js DOMContentLoaded.
  // Gestiona toda la lógica de sesión y formularios.
  async function init() {
    if (_initialized) return;
    _initialized = true;

    _wireAuthForm();   // Registrar listeners PRIMERO
    _wireLogout();     // Logout y anti-back-button

    const client = window.APP_STATE?.supabase;

    if (!client) {
      // Sin Supabase → Modo Demo habilitado inmediatamente
      console.warn('[Auth] Supabase no disponible — activando Demo.');
      enableDemoButton();
      _showLogin();
      return;
    }

    // Verificar sesión activa (asíncrono, único llamado)
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
      console.warn('[Auth] getSession falló:', e.message, '— mostrando login.');
    }

    _showLogin();
    _subscribeAuthChanges(client);
  }

  // ── SUSCRIPCIÓN onAuthStateChange ─────────────
  // Guard: solo actúa si NO hay sesión en curso.
  // Previene el flash de "login aparece y desaparece".
  function _subscribeAuthChanges(client) {
    if (!client) return;

    client.auth.onAuthStateChange((event, session) => {
      // SIGNED_IN puede llegar justo después de getSession —
      // si ya mostramos la app, no volvemos a renderizar.
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
  // Flag global para garantizar un solo registro.
  function _wireAuthForm() {
    if (_wireAuthForm._wired) return;
    _wireAuthForm._wired = true;

    const emailInput = document.getElementById('auth-email');
    const passInput  = document.getElementById('auth-password');
    const submitBtn  = document.getElementById('auth-submit');
    const msgEl      = document.getElementById('auth-msg');
    const demoBtn    = document.getElementById('auth-demo');
    const tabLogin   = document.getElementById('tab-login');
    const tabRegister= document.getElementById('tab-register');

    if (!submitBtn) {
      console.error('[Auth] #auth-submit no encontrado.');
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

      // Resolver client en tiempo de ejecución (no en closure)
      const client = window.APP_STATE?.supabase;

      if (!client) {
        enableDemoButton();
        _showAuthMsg(
          msgEl,
          '⚠️ Servidor fiscal sin respuesta. Usa el Modo Demo mientras tanto.',
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

    // ── Botón Demo ───────────────────────────────
    if (demoBtn) {
      demoBtn.addEventListener('click', _activateDemo);
    } else {
      console.warn('[Auth] #auth-demo no encontrado.');
    }
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

  // ── BYPASS DEMO ───────────────────────────────
  function enableDemoButton() {
    const demoBtn = document.getElementById('auth-demo');
    if (!demoBtn) return;
    demoBtn.disabled = false;
    demoBtn.style.opacity = '1';
    demoBtn.title = 'Accede al Dashboard con datos de demostración';
  }

  function _activateDemo() {
    _showDemoBanner();
    _showApp(null);
    if (window.MockData && window.Store) {
      window.MockData.load(window.Store);
    }
    if (window.Dashboard?.syncAndRender) Dashboard.syncAndRender();
    _injectWelcomeMessage(true);
  }

  function bypassToDemo() { _activateDemo(); }

  // ── DEMO BANNER ───────────────────────────────
  function _showDemoBanner() {
    const existing = document.getElementById('demo-banner');
    if (existing) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:#b45309', 'color:#fff', 'text-align:center',
      'padding:8px 16px', 'font-size:13px', 'font-weight:600',
    ].join(';');
    banner.innerHTML =
      '⚠️ MODO DEMO — Datos ficticios. ' +
      '<strong>Art. 17-K CFF:</strong> Multa hasta $10,260 MXN por Buzón inactivo. ' +
      '<a href="#" onclick="document.getElementById(\'auth-overlay\').style.display=\'flex\';' +
      'document.getElementById(\'app\').hidden=true;this.closest(\'#demo-banner\').remove();' +
      'return false;" style="color:#fde68a;margin-left:8px">← Iniciar sesión real</a>';
    document.body.prepend(banner);
  }

  // ── POST-LOGIN ────────────────────────────────
  function _postLoginInit() {
    if (window.Store?.initSupabase) Store.initSupabase();
    if (window.Dashboard?.syncAndRender) Dashboard.syncAndRender();
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
        <p>🛡️ <strong>Aliado RESICO — Ejercicio Fiscal ${FISCAL.YEAR}</strong>
        ${isDemo ? ' <span style="color:#f59e0b">[MODO DEMO]</span>' : ''}</p>
        <p>📊 <strong>${FISCAL.ART_113E}:</strong> Límite anual RESICO:
           <strong>$${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN</strong>.
           Al alcanzar el 94% (<strong>$${FISCAL.ALERT_94_PCT.toLocaleString('es-MX')} MXN</strong>)
           recibirás alerta de migración forzosa al Régimen General.</p>
        <p>📬 <strong>${FISCAL.ART_17K}:</strong> Buzón Tributario inactivo genera multa de hasta
           <strong>$${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN</strong>.
           Por reincidencia, la multa se <strong>duplica automáticamente</strong>
           (${FISCAL.ART_86C}).</p>
        <p>📋 <strong>${FISCAL.ART_113F}:</strong> Antes de confirmar tu obligación de Declaración
           Anual, te preguntaré si tuviste ingresos mixtos (salarios &gt; $400k,
           intereses o dividendos).</p>
        <p>🔒 Datos protegidos bajo <strong>LFPDPPP</strong> con
           <strong>Row Level Security (RLS)</strong> — ningún otro contribuyente
           accede a tu información.</p>
      </div>
      <span class="bubble-time">${ts}</span>`;
    chatEl.appendChild(bubble);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  return {
    init,
    enableDemoButton,
    bypassToDemo,
  };
})();

if (typeof window !== 'undefined') window.AuthManager = AuthManager;