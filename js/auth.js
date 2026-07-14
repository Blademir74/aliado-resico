window.APP_STATE = window.APP_STATE || {
  supabase: null,
  currentUser: null,
  isDemo: false,
  authInitialized: false,
  authError: null
};

window.MockData = window.MockData || {
  load(store) {
    store?.setState({
      conversations: [
        {
          id: 'demo-1',
          text: '¿Estoy cerca del límite de RESICO?',
          intent: 'CONSULTA_FISCAL',
          confidence: 0.96,
          timestamp: Date.now(),
          is_fiscal_audit_completed: true,
          source: 'demo'
        },
        {
          id: 'demo-2',
          text: 'Mi buzón tributario está inactivo',
          intent: 'SALUD_FISCAL',
          confidence: 0.98,
          timestamp: Date.now() - 60000,
          is_fiscal_audit_completed: true,
          source: 'demo'
        }
      ],
      incomeYTD: 95500,
      fiscalMetrics: {
        annualLimit: 3500000,
        riskLevel: 'SEGURO'
      },
      saludFiscal: {
        buzonTributarioActivo: false,
        eFirmaVigente: true,
        alertLevel: 'warning'
      }
    });
  }
};

const AuthManager = (() => {
  let currentUser = null;
  let _authInitialized = false;
  let _isChecking = false;
  let _checkPromise = null;

  const FISCAL = {
    INCOME_LIMIT: 3500000,
    ALERT_94: 3300000,
    MULTA_BUZON: 10260,
    ART_113E: 'Art. 113-E LISR',
    ART_113F: 'Art. 113-F LISR',
    ART_17K: 'Art. 17-K CFF',
    ART_86C: 'Art. 86-C CFF'
  };

  function getAppEl() { return document.getElementById('app'); }

  function removeGuard() {
    const guard = document.getElementById('auth-guard-css');
    if (guard) guard.remove();
  }

  function _showApp(user) {
    removeGuard();
    const overlay = document.getElementById('auth-overlay');
    const app = getAppEl();
    const chip = document.getElementById('user-chip');
    const emailEl = document.getElementById('user-email-display');
    const logoutEl = document.getElementById('logout-btn');
    const loader = document.getElementById('auth-loader');
    const msg = document.getElementById('auth-msg');

    if (loader) loader.style.display = 'none';
    if (msg) msg.hidden = true;
    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = 'none';
    }
    if (app) {
      app.hidden = false;
      app.style.display = '';
    }
    if (chip) chip.hidden = false;
    if (emailEl) emailEl.textContent = user?.email || 'Modo Demo';
    if (logoutEl) logoutEl.hidden = false;
    window.APP_STATE.authError = null;
  }

  function _showLoginWithError(message) {
    const overlay = document.getElementById('auth-overlay');
    const app = getAppEl();
    const chip = document.getElementById('user-chip');
    const logoutEl = document.getElementById('logout-btn');
    const loader = document.getElementById('auth-loader');
    const msg = document.getElementById('auth-msg');

    if (loader) loader.style.display = 'none';
    if (msg) {
      msg.hidden = false;
      msg.textContent = message || 'Error de autorización. Contacta a soporte para verificar tu Bóveda Fiscal.';
      msg.className = 'auth-msg error';
      msg.style.color = '#ef4444';
    }
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
    }
    if (app) {
      app.hidden = true;
      app.style.display = 'none';
    }
    if (chip) chip.hidden = true;
    if (logoutEl) logoutEl.hidden = true;
    window.APP_STATE.authError = message || 'Error de autorización';
  }

  function _showLogin() {
    const overlay = document.getElementById('auth-overlay');
    const app = getAppEl();
    const chip = document.getElementById('user-chip');
    const logoutEl = document.getElementById('logout-btn');
    const loader = document.getElementById('auth-loader');
    const msg = document.getElementById('auth-msg');

    if (loader) loader.style.display = 'none';
    if (msg) msg.hidden = true;
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'flex';
    }
    if (app) {
      app.hidden = true;
      app.style.display = 'none';
    }
    if (chip) chip.hidden = true;
    if (logoutEl) logoutEl.hidden = true;
    window.APP_STATE.authError = null;
  }

  function _showAuthMsg(el, text, isError) {
    if (!el) return;
    el.hidden = false;
    el.textContent = text;
    el.className = isError ? 'auth-msg error' : 'auth-msg success';
    el.style.color = isError ? '#ef4444' : '#10b981';
  }

  function enableDemoButton() {
    const btn = document.getElementById('auth-demo');
    if (!btn) return;
    btn.disabled = false;
    btn.hidden = false;
  }

  function _showDemoBanner() {
    if (document.getElementById('demo-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#92400e;color:#fff;padding:10px 16px;text-align:center;font-size:13px;font-weight:600;';
    banner.textContent = `⚠️ MODO DEMO — ${FISCAL.ART_17K}: multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN por Buzón Tributario inactivo.`;
    document.body.prepend(banner);
  }

  function _injectWelcomeMessage() {
    const chatEl = document.getElementById('chat-messages');
    if (!chatEl || chatEl.dataset.welcomeInjected === '1') return;
    chatEl.dataset.welcomeInjected = '1';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble bot';
    bubble.textContent =
      `🛡️ Aliado RESICO activo.\n\n` +
      `${FISCAL.ART_113E}: tu límite anual es $${FISCAL.INCOME_LIMIT.toLocaleString('es-MX')} MXN.\n` +
      `Al 94% ($${FISCAL.ALERT_94.toLocaleString('es-MX')} MXN) debes tratarlo como riesgo de expulsión.\n\n` +
      `⚠️ **ALERTA DE SALUD FISCAL**\n` +
      `${FISCAL.ART_17K}: Buzón Tributario inactivo = multa hasta $${FISCAL.MULTA_BUZON.toLocaleString('es-MX')} MXN y pérdida de plazos; la reincidencia escala el riesgo (${FISCAL.ART_86C}).\n\n` +
      `${FISCAL.ART_113F}: antes de confirmar anual, se pregunta si hubo ingresos mixtos.\n\n` +
      `📘 **Educación fiscal**:\n` +
      `- El ISR en RESICO se calcula sobre ingresos brutos, sin deducciones de gastos.\n` +
      `- El IVA solo es acreditable si cuentas con CFDI válido que acredite el gasto indispensable.`;
    chatEl.appendChild(bubble);
  }

  function bypassToDemo() {
    window.APP_STATE.isDemo = true;
    _showDemoBanner();
    _showApp(null);
    window.MockData?.load?.(window.Store);
    _injectWelcomeMessage();
    window.Dashboard?.syncAndRender?.();
  }

  // ============================================================
  // checkSession: con manejo de 403 y creación automática de fila
  // ============================================================
  async function checkSession() {
    if (_authInitialized) {
      console.log('[Auth] Sesión ya verificada');
      return true;
    }
    if (_isChecking) {
      console.log('[Auth] checkSession en ejecución, esperando...');
      return _checkPromise;
    }

    _isChecking = true;
    _checkPromise = (async () => {
      const loader = document.getElementById('auth-loader');
      if (loader) loader.style.display = 'block';
      const overlay = document.getElementById('auth-overlay');
      if (overlay && overlay.hidden) {
        overlay.hidden = false;
        overlay.style.display = 'flex';
      }

      try {
        const url = window.AppConfig?.getSupabaseUrl?.() || '';
        const key = window.AppConfig?.getSupabaseKey?.() || '';
        const client = window.APP_STATE?.supabase;

        if (!url || !key || !client) {
          console.warn('[Auth] Supabase no configurado');
          _showLogin();
          enableDemoButton();
          if (loader) loader.style.display = 'none';
          _authInitialized = true;
          return false;
        }

        // Obtener sesión
        const { data: sessionData, error: sessionError } = await client.auth.getSession();
        if (sessionError || !sessionData?.session) {
          _showLogin();
          enableDemoButton();
          if (loader) loader.style.display = 'none';
          _authInitialized = true;
          return false;
        }

        // Obtener usuario
        const { data: userData, error: userError } = await client.auth.getUser();
        if (userError || !userData?.user) {
          await client.auth.signOut().catch(() => {});
          _showLogin();
          enableDemoButton();
          if (loader) loader.style.display = 'none';
          _authInitialized = true;
          return false;
        }

        const userId = userData.user.id;

        // ============================================================
        // INTENTAR CONSULTAR fiscal_metrics - si falla por 403, crear fila
        // ============================================================
        let metricsOk = false;
        try {
          const { data: metricsData, error: metricsError } = await client
            .from('fiscal_metrics')
            .select('user_id, income_ytd, total_processed, avg_confidence')
            .eq('user_id', userId)
            .maybeSingle();

          if (metricsError) {
            // Si es 403 o 404 (tabla sin registro), intentar crear la fila
            if (metricsError.code === 'PGRST301' || 
                metricsError.message?.includes('permission denied') ||
                metricsError.status === 403 ||
                metricsError.code === 'PGRST116') { // 404 - not found
              
              console.warn('[Auth] No se encontró registro en fiscal_metrics, creando...');
              // Insertar fila para el usuario
              const { error: insertError } = await client
                .from('fiscal_metrics')
                .insert({
                  user_id: userId,
                  income_ytd: 0,
                  total_processed: 0,
                  avg_confidence: 0
                })
                .select();

              if (insertError) {
                console.warn('[Auth] Error al crear fiscal_metrics:', insertError.message);
                _showLoginWithError('Error al inicializar Bóveda Fiscal. Contacta a soporte.');
                enableDemoButton();
                if (loader) loader.style.display = 'none';
                _authInitialized = true;
                return false;
              }
              metricsOk = true;
            } else {
              console.warn('[Auth] Error consultando fiscal_metrics:', metricsError.message);
              _showLoginWithError('Error al acceder a Bóveda Fiscal. Contacta a soporte.');
              enableDemoButton();
              if (loader) loader.style.display = 'none';
              _authInitialized = true;
              return false;
            }
          } else {
            metricsOk = true;
          }
        } catch (err) {
          console.warn('[Auth] Excepción en fiscal_metrics:', err.message);
          // Intentar crear fila por si la tabla existe pero no hay registro
          try {
            const { error: insertError } = await client
              .from('fiscal_metrics')
              .insert({
                user_id: userId,
                income_ytd: 0,
                total_processed: 0,
                avg_confidence: 0
              })
              .select();
            if (insertError) {
              _showLoginWithError('Error al inicializar Bóveda Fiscal. Contacta a soporte.');
              enableDemoButton();
              if (loader) loader.style.display = 'none';
              _authInitialized = true;
              return false;
            }
            metricsOk = true;
          } catch (err2) {
            _showLoginWithError('Error crítico al acceder a Bóveda Fiscal.');
            enableDemoButton();
            if (loader) loader.style.display = 'none';
            _authInitialized = true;
            return false;
          }
        }

        // Si todo OK, continuar
        if (metricsOk) {
          currentUser = userData.user;
          window.APP_STATE.currentUser = currentUser;
          _showApp(currentUser);
          _injectWelcomeMessage();
          window.Dashboard?.syncAndRender?.();
          if (loader) loader.style.display = 'none';
          _authInitialized = true;
          return true;
        } else {
          // Fallback a login
          _showLogin();
          enableDemoButton();
          if (loader) loader.style.display = 'none';
          _authInitialized = true;
          return false;
        }
      } catch (err) {
        console.warn('[Auth] checkSession error:', err.message);
        if (err?.status === 403 || err?.message?.includes('403') || err?.message?.includes('permission denied')) {
          _showLoginWithError('Error de Autorización: Contacta a soporte para verificar tu Bóveda Fiscal.');
        } else {
          _showLogin();
        }
        enableDemoButton();
        if (loader) loader.style.display = 'none';
        _authInitialized = true;
        return false;
      }
    })();

    const result = await _checkPromise;
    _isChecking = false;
    return result;
  }

  // ============================================================
  // Inicialización
  // ============================================================
  async function init() {
    if (_authInitialized) {
      console.log('[Auth] Ya inicializado');
      return;
    }

    const submitBtn = document.getElementById('auth-submit');
    const demoBtn = document.getElementById('auth-demo');
    const msgEl = document.getElementById('auth-msg');
    const emailInput = document.getElementById('auth-email');
    const passInput = document.getElementById('auth-password');
    const logoutBtn = document.getElementById('logout-btn');
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');

    if (!submitBtn) return;

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
      const pass = passInput?.value;
      if (!email || !pass) {
        _showAuthMsg(msgEl, 'Ingresa tu correo y contraseña.', true);
        return;
      }
      const client = window.APP_STATE?.supabase;
      if (!client) {
        enableDemoButton();
        _showAuthMsg(msgEl, 'Supabase no está listo. Usa Demo.', true);
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
          if (result.data?.user && !result.data?.session) {
            _showAuthMsg(msgEl, 'Cuenta creada. Revisa tu correo para confirmar.', false);
            return;
          }
        } else {
          result = await client.auth.signInWithPassword({ email, password: pass });
          if (result.error) throw result.error;
        }
        currentUser = result.data.user;
        window.APP_STATE.currentUser = currentUser;
        await checkSession();
      } catch (err) {
        const map = {
          'Invalid login credentials': 'Correo o contraseña incorrectos.',
          'Email not confirmed': 'Confirma tu correo antes de entrar.',
          'User already registered': 'Ese correo ya tiene cuenta.'
        };
        _showAuthMsg(msgEl, map[err.message] || err.message, true);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isRegister ? '✅ Crear Cuenta' : '🔐 Iniciar Sesión';
      }
    });

    [emailInput, passInput].forEach(el =>
      el?.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
      })
    );

    demoBtn?.addEventListener('click', bypassToDemo);

    const forgotBtn = document.getElementById('auth-forgot-password');
    forgotBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      const email = emailInput?.value?.trim();
      if (!email) {
        _showAuthMsg(msgEl, 'Ingresa tu correo para restablecer tu contraseña.', true);
        return;
      }
      const client = window.APP_STATE?.supabase;
      if (!client) {
        _showAuthMsg(msgEl, 'Supabase no está disponible.', true);
        return;
      }
      forgotBtn.textContent = '⏳ Enviando…';
      try {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/api/auth-callback?next=/`
        });
        if (error) throw error;
        _showAuthMsg(msgEl, 'Correo de recuperación enviado. Revisa tu bandeja de entrada.', false);
      } catch (err) {
        _showAuthMsg(msgEl, err.message, true);
      } finally {
        forgotBtn.textContent = '¿Olvidaste tu contraseña?';
      }
    });

    logoutBtn?.addEventListener('click', async () => {
      try {
        await window.APP_STATE?.supabase?.auth?.signOut();
      } catch (_) {}
      window.Store?.reset?.();
      window.APP_STATE.currentUser = null;
      window.APP_STATE.isDemo = false;
      _authInitialized = false;
      _showLogin();
      enableDemoButton();
    });

    await checkSession();
  }

  return {
    init,
    checkSession,
    enableDemoButton,
    bypassToDemo,
    isInitialized: () => _authInitialized
  };
})();

window.AuthManager = AuthManager;