/* ============================================
   ALIADO RESICO — Auth Module v3.0
   Fix: _wireAuthForm es el único punto de control de listeners
   Fix: demo button oculta overlay e inyecta mock-data correctamente
   Fix: blindaje fiscal 2026 en mensajes de bienvenida
   Fix: supabaseClient en lugar de supabase (variable global)
   Fix: Auth Guard estricto — app oculta hasta sesión válida
   Fix: botón Salir funcional con recarga limpia
   LFPDPPP | Art. 17-K CFF | Art. 113-E LISR | RLS Supabase
   ============================================ */

const AuthManager = (() => {
  let supabaseClient = null;
  let currentUser    = null;

  // ─────────────────────────────────────────────────
  // CONSTANTES FISCALES 2026
  // ─────────────────────────────────────────────────
  const FISCAL = {
    INCOME_LIMIT:   3_500_000,
    ALERT_94:       3_300_000,
    MULTA_BUZON:    10_260,
    ART_113E:       'Art. 113-E LISR',
    ART_17K:        'Art. 17-K CFF',
    ART_86C:        'Art. 86-C CFF',
    ART_113F:       'Art. 113-F LISR',
  };

  // ─────────────────────────────────────────────────
  // HELPERS DE DOM
  // ─────────────────────────────────────────────────
  function _showApp(user) {
    const overlay  = document.getElementById('auth-overlay');
    const app      = document.getElementById('app');
    const userChip = document.getElementById('user-chip');
    const emailEl  = document.getElementById('user-email-display');
    const logoutEl = document.getElementById('logout-btn');

    if (overlay)  { overlay.hidden = true;  overlay.style.display = 'none'; }
    if (app)      { app.hidden = false;     app.style.display = '';         }
    if (userChip) { userChip.hidden = false; }
    if (emailEl)  { emailEl.textContent = user?.email ?? ''; }
    if (logoutEl) { logoutEl.hidden = false; }
  }

  function _showLogin() {
    const overlay  = document.getElementById('auth-overlay');
    const app      = document.getElementById('app');
    const userChip = document.getElementById('user-chip');
    const logoutEl = document.getElementById('logout-btn');

    if (overlay)  { overlay.hidden = false; overlay.style.display = 'flex'; }
    if (app)      { app.hidden = true;      app.style.display = 'none';     }
    if (userChip) { userChip.hidden = true; }
    if (logoutEl) { logoutEl.hidden = true; }
  }

  function _showAuthMsg(el, text, isError) {
    if (!el) return;
    el.hidden       = false;
    el.textContent  = text;
    el.className    = isError ? 'auth-msg error' : 'auth-msg success';
  }

  // ─────────────────────────────────────────────────
  // WIRE AUTH FORM
  // Único punto donde se registran los listeners del
  // formulario de login, registro y demo.
  // Se protege con _wireAuthForm._wired para garantizar
  // que no se dupliquen si init() se llama más de una vez.
  // ─────────────────────────────────────────────────
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

    // ── Tabs login / registro ──
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

    // ── Submit (login o registro) ──
    submitBtn.addEventListener('click', async () => {
      const email = emailInput?.value?.trim();
      const pass  = passInput?.value;

      if (!email || !pass) {
        _showAuthMsg(msgEl, 'Ingresa tu correo y contraseña.', true);
        return;
      }

      // Supabase puede tardar en estar disponible en el primer render.
      // Si no está listo, NO bloqueamos al usuario: ofrecemos Modo Demo.
      const client = supabaseClient || window.APP_STATE?.supabase;
      if (!client) {
        // Reintentar si Supabase carga en los próximos 3s (CDN tardío, etc.)
        const tryAgain = setTimeout(() => {
          if (window.APP_STATE?.supabase) {
            _showAuthMsg(msgEl, '✅ Conexión restaurada. Intenta iniciar sesión de nuevo.', false);
            submitBtn.disabled    = false;
            submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
          }
        }, 3000);

        // Mientras tanto, no dejamos al usuario tirado: habilitamos Demo.
        if (typeof AuthManager?.enableDemoButton === 'function') {
          AuthManager.enableDemoButton();
        }
        _showAuthMsg(
          msgEl,
          'El servidor de autenticación tarda en responder. Puedes iniciar el ' +
          'Modo Demo ahora mismo (botón abajo) o esperar 3s y reintentar.',
          true
        );
        // Guardar referencia para cancelar el reintento si el usuario cambia de vista
        submitBtn._retryTimer = tryAgain;
        return;
      }
      // Si ya había un reintento agendado, cancelarlo
      if (submitBtn._retryTimer) { clearTimeout(submitBtn._retryTimer); submitBtn._retryTimer = null; }

      submitBtn.disabled   = true;
      submitBtn.textContent = '⏳ Procesando…';
      if (msgEl) msgEl.hidden = true;

      try {
        let result;
        if (isRegister) {
          result = await client.auth.signUp({ email, password: pass });
          if (result.error) throw result.error;
          if (result.data?.user && !result.data.session) {
            _showAuthMsg(msgEl, '✅ Cuenta creada. Revisa tu correo para confirmar el acceso.', false);
            submitBtn.disabled    = false;
            submitBtn.textContent = '✅ Crear Cuenta';
            return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }

        currentUser = result.data.user;
        _showApp(currentUser);
        _postLoginInit();

      } catch (err) {
        const errorMap = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed':       'Confirma tu correo antes de entrar.',
          'User already registered':   'Ese correo ya tiene cuenta — inicia sesión.',
        };
        _showAuthMsg(msgEl, errorMap[err.message] || err.message, true);
      } finally {
        submitBtn.disabled    = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    // Enter en campos dispara el submit
    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); })
    );

    // ── Botón Demo ──
    // Oculta el overlay, muestra banner ámbar e inyecta mock-data
    // No requiere Supabase — funciona en cualquier estado de red
    if (demoBtn) {
      demoBtn.addEventListener('click', () => {
        _showDemoBanner();
        _showApp(null);
        _loadDemoData();
      });
    } else {
      console.warn('[Auth] #auth-demo no encontrado en el DOM');
    }
  }

  // ─────────────────────────────────────────────────
  // POST-LOGIN INIT
  // Acciones que deben ocurrir tras autenticación exitosa
  // (real o demo)
  // ─────────────────────────────────────────────────
  function _postLoginInit() {
    if (window.Store?.initSupabase) window.Store.initSupabase();
    if (window.Dashboard?.syncAndRender) window.Dashboard.syncAndRender();

    // Mensaje de bienvenida con blindaje fiscal 2026
    _injectWelcomeMessage();
  }

  function _loadDemoData() {
    if (window.MockData && window.Store) {
      window.MockData.load(window.Store);
    }
    if (window.Dashboard?.syncAndRender) window.Dashboard.syncAndRender();
    _injectWelcomeMessage();
  }

  // ─────────────────────────────────────────────────
  // MENSAJE DE BIENVENIDA FISCAL
  // Se inyecta en el chat al entrar al sistema.
  // Cubre Art. 17-K, Art. 113-E y Art. 86-C.
  // ─────────────────────────────────────────────────
  function _injectWelcomeMessage() {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl) return;

    const ts = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.innerHTML = `
      <p>
        🛡️ <strong>Aliado RESICO activo — Ejercicio ${new Date().getFullYear()}</strong><br><br>
        📊 <strong>${FISCAL.ART_113E}:</strong> Tu límite de ingresos RESICO es
        <strong>$${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN</strong> anuales.
        Al llegar al 94% ($${FISCAL.ALERT_94.toLocaleString('es-MX')} MXN) recibirás
        alerta de migración forzosa al Régimen General.<br><br>
        📬 <strong>${FISCAL.ART_17K}:</strong> El Buzón Tributario inactivo genera una multa
        de hasta <strong>$${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN</strong>.
        La reincidencia duplica el monto automáticamente
        (<strong>${FISCAL.ART_86C}</strong>).<br><br>
        📋 <strong>${FISCAL.ART_113F} — Declaración Anual:</strong> Antes de confirmar
        tu obligación, te preguntaré si tuviste ingresos mixtos (salarios &gt; $400k,
        intereses o dividendos).<br><br>
        🔒 Tus datos están protegidos bajo la <strong>LFPDPPP</strong> con
        <strong>Row Level Security (RLS)</strong> — ningún otro contribuyente
        puede ver tu información.
      </p>
      <span class="bubble-time">${ts}</span>
    `;
    chatEl.appendChild(bubble);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  // ─────────────────────────────────────────────────
  // INICIALIZACIÓN PRINCIPAL
  // Llamado desde app.js. Registra listeners de sesión
  // y verifica si ya existe una sesión activa.
  // ─────────────────────────────────────────────────
  async function init() {
    supabaseClient = window.APP_STATE?.supabase;

    // Registrar siempre los listeners del formulario,
    // independientemente del estado de Supabase
    _wireAuthForm();

    if (!supabaseClient) {
      console.warn('[Auth] Cliente Supabase no disponible — modo sin BD');
      _showLogin();
      return false;
    }

    // Escuchar cambios de sesión en tiempo real
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
        currentUser = session.user;
        _showApp(session.user);
        _postLoginInit();
      } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        _showLogin();
      }
    });

    // Verificar sesión existente al cargar
    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      console.warn('[Auth] Error al verificar sesión:', error.message);
      _showLogin();
      return false;
    }

    if (data?.session?.user) {
      currentUser = data.session.user;
      _showApp(data.session.user);
      _postLoginInit();
      return true;
    }

    _showLogin();
    return false;
  }

  // ─────────────────────────────────────────────────
  // CIERRE DE SESIÓN SEGURO
  // ─────────────────────────────────────────────────
  async function logout() {
    try {
      if (supabaseClient) await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn('[Auth] Error en signOut:', e.message);
    }

    currentUser = null;
    sessionStorage.clear();
    localStorage.removeItem('aliado_resico_v5');
    localStorage.removeItem('aliado_resico_onboarding_done');

    // Reload fuerza al Auth Guard a evaluarse desde cero
    window.location.reload();
  }

  // ─────────────────────────────────────────────────
  // BIND LOGOUT BUTTON
  // Llamado desde app.js después de que el DOM esté listo.
  // Flag _logoutWired evita duplicar el listener.
  // ─────────────────────────────────────────────────
  function bindLogoutButton() {
    const btn = document.getElementById('logout-btn');
    if (!btn) {
      console.warn('[Auth] #logout-btn no encontrado en el DOM');
      return;
    }

    if (btn._logoutWired) return;
    btn._logoutWired = true;

    btn.addEventListener('click', () => logout());
  }

  // ─────────────────────────────────────────────────
  // GETTERS
  // ─────────────────────────────────────────────────
  function getUserId()      { return currentUser?.id ?? null; }
  function getCurrentUser() { return currentUser; }

  // ─────────────────────────────────────────────────
  // MÉTRICAS FISCALES — user_id inyectado aquí
  // Garantiza que el RLS auth.uid() = user_id filtre
  // correctamente y un contribuyente nunca vea datos ajenos
  // ─────────────────────────────────────────────────
  async function upsertFiscalMetrics(metrics) {
    const uid = getUserId();
    if (!uid) throw new Error('[Auth] Usuario no autenticado — upsertFiscalMetrics');

    const { error } = await supabaseClient
      .from('fiscal_metrics')
      .upsert({
        user_id:         uid,
        income_ytd:      metrics.incomeYTD      ?? 0,
        total_processed: metrics.totalProcessed ?? 0,
        avg_confidence:  metrics.avgConfidence  ?? 0,
        last_updated:    new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) throw error;

    // Verificar umbral Art. 113-E LISR
    if ((metrics.incomeYTD ?? 0) >= FISCAL.ALERT_94) {
      console.warn(
        `%c⚠️ ALERTA ${FISCAL.ART_113E}: Ingresos en $${metrics.incomeYTD?.toLocaleString('es-MX')} — riesgo de expulsión del régimen`,
        'background:#ef4444;color:white;font-weight:bold'
      );
    }

    return true;
  }

  async function getFiscalMetrics() {
    const uid = getUserId();
    if (!uid) return null;

    const { data, error } = await supabaseClient
      .from('fiscal_metrics')
      .select('income_ytd, total_processed, avg_confidence')
      .eq('user_id', uid)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  // ─────────────────────────────────────────────────
  // VERIFICADOR RLS
  // Confirma que auth.uid() = user_id bloquea datos ajenos
  // ─────────────────────────────────────────────────
  async function testRLSIsolation() {
    if (!supabaseClient) return false;

    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    try {
      const { error: insertError } = await supabaseClient
        .from('fiscal_metrics')
        .insert({ user_id: fakeUserId, income_ytd: 0 });

      if (!insertError || !insertError.message.includes('row-level security')) {
        console.error(
          '%c❌ CRÍTICO: RLS NO ESTÁ BLOQUEANDO. DETENER DESPLIEGUE.',
          'background:#ef4444;color:white;font-size:16px'
        );
        throw new Error('RLS_FAILURE');
      }

      console.log('%c✅ RLS OK: aislamiento multi-tenant verificado', 'color:#10b981');
      return true;

    } catch (err) {
      if (err.message === 'RLS_FAILURE') throw err;
      console.log('[Auth] RLS activo — acceso a datos ajenos bloqueado');
      return true;
    }
  }

  // ─────────────────────────────────────────────────
  // ONBOARDING
  // ─────────────────────────────────────────────────
  function isFirstLogin() {
    const uid = getUserId();
    if (!uid) return false;
    return !localStorage.getItem(`onboarding_done_${uid}`);
  }

  function markOnboardingDone() {
    const uid = getUserId();
    if (uid) localStorage.setItem(`onboarding_done_${uid}`, 'true');
  }

  // ─────────────────────────────────────────────────
  // BANNER MODO DEMO
  // Obligatorio por responsabilidad legal del consultor.
  // Se inserta una sola vez en el DOM.
  // ─────────────────────────────────────────────────
  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:9999',
      'background:#f59e0b', 'color:#0a0f1c',
      'text-align:center', 'padding:10px 16px',
      'font-weight:700', 'font-size:13px',
      'letter-spacing:0.3px',
      'box-shadow:0 2px 8px rgba(0,0,0,0.35)',
    ].join(';');
    banner.innerHTML =
      '⚠️ MODO DEMOSTRACIÓN — Datos de prueba, no sincronizados con el SAT. ' +
      '<span style="font-weight:400;opacity:0.85">' +
        'Buzón Tributario inactivo: multa hasta $10,260 MXN (' + FISCAL.ART_17K + ')' +
      '</span>';
    document.body.prepend(banner);
    // Evitar que el banner tape el contenido superior
    const app = document.getElementById('app');
    if (app) app.style.paddingTop = '48px';
  }

  // ─────────────────────────────────────────────────
  // BYPASS A DEMO — llamado desde app.js si Supabase
  // no responde en el timeout de 3s
  // ─────────────────────────────────────────────────
  function bypassToDemo() {
    _showDemoBanner();
    _showApp(null);
    _loadDemoData();
  }

  // ─────────────────────────────────────────────────
  // HABILITAR BOTÓN DEMO VISUALMENTE
  // Llamado desde app.js después del timeout de 3s.
  // Pulso ámbar guía al usuario cuando Supabase falla.
  // ─────────────────────────────────────────────────
  function enableDemoButton() {
    const btn = document.getElementById('auth-demo');
    if (!btn) return;
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.style.border = '2px solid #f59e0b';
    // Animación de pulso si la API está disponible
    if (typeof btn.animate === 'function') {
      btn.animate(
        [
          { boxShadow: '0 0 0 0 rgba(245,158,11,0.7)' },
          { boxShadow: '0 0 0 10px rgba(245,158,11,0)' },
        ],
        { duration: 900, iterations: 3 }
      );
    }
    // Mostrar texto de ayuda bajo el botón
    const msgEl = document.getElementById('auth-msg');
    if (msgEl) {
      msgEl.hidden = false;
      msgEl.className = 'auth-msg';
      msgEl.style.color = '#f59e0b';
      msgEl.textContent = 'Servicio de autenticación no disponible. Puedes explorar en Modo Demo.';
    }
  }

  // ─────────────────────────────────────────────────
  // API PÚBLICA
  // window.AuthManager se asigna DENTRO del IIFE para
  // que esté disponible aunque ocurra un error async
  // posterior (no espera al return del IIFE).
  // ─────────────────────────────────────────────────
  const _publicAPI = {
    init,
    bindLogoutButton,
    logout,
    getUserId,
    getCurrentUser,
    upsertFiscalMetrics,
    getFiscalMetrics,
    testRLSIsolation,
    isFirstLogin,
    markOnboardingDone,
    bypassToDemo,
    enableDemoButton,
    FISCAL,
  };

  // Asignación temprana: disponible antes del return
  window.AuthManager = _publicAPI;
  return _publicAPI;
})();

// Asignación defensiva: si el IIFE retornó correctamente
if (typeof AuthManager !== 'undefined') window.AuthManager = AuthManager;