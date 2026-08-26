const AuthRegisterUI = (() => {
  let isRegisterMode = false;

  const RFC_REGEX_PF = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
  const RFC_REGEX_PM = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;
  const PHONE_REGEX = /^\d{10}$/;
  const PASSWORD_MIN = 12;
  const PASSWORD_MAX = 18;
// ── FIX R-110: Algoritmo oficial SAT (Anexo 3 CFF) ──────────────────────
// PF (13): dígito = checkDigit(primeros 12) · PM (12): dígito = checkDigit(' ' + primeros 11)
// Pesos 13..2 · Tabla: 0-9, A=10..Z=36, &=24, ' '=37, Ñ=38
function checkDigitSAT(base12) {
  const M = {'0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
    'A':10,'B':11,'C':12,'D':13,'E':14,'F':15,'G':16,'H':17,'I':18,'J':19,
    'K':20,'L':21,'M':22,'N':23,'&':24,'O':25,'P':26,'Q':27,'R':28,'S':29,
    'T':30,'U':31,'V':32,'W':33,'X':34,'Y':35,'Z':36,' ':37,'Ñ':38};
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = M[base12[i]];
    if (v === undefined) return null;
    sum += v * (13 - i);
  }
  const rem = sum % 11;
  if (rem === 0) return '0';
  const d = 11 - rem;
  return d === 10 ? 'A' : String(d);
}
function validateRFCChecksum(rfc) {
  const clean = String(rfc || '').trim().toUpperCase();
  if (!clean) return { valid: false, reason: 'RFC vacío' };
  if (clean === 'XAXX010101000' || clean === 'XEXX010101000')
    return { valid: true, isGeneric: true, reason: 'RFC genérico válido (público en general)' };
  if (clean.length === 13) {
    const exp = checkDigitSAT(clean.substring(0, 12));
    if (exp === null) return { valid: false, reason: 'Carácter inválido en el RFC.' };
    if (exp !== clean.charAt(12))
      return { valid: false, reason: `Dígito verificador incorrecto. Esperado: ${exp}, recibido: ${clean.charAt(12)}.` };
    return { valid: true, isGeneric: false, type: 'PF', reason: 'RFC válido (Persona Física) con homoclave correcta.' };
  }
  if (clean.length === 12) {
    const exp = checkDigitSAT(' ' + clean.substring(0, 11));
    if (exp === null) return { valid: false, reason: 'Carácter inválido en el RFC.' };
    if (exp !== clean.charAt(11))
      return { valid: false, reason: `Dígito verificador incorrecto. Esperado: ${exp}, recibido: ${clean.charAt(11)}.` };
    return { valid: true, isGeneric: false, type: 'PM', reason: 'RFC válido (Persona Moral) con homoclave correcta.' };
  }
  return { valid: false, reason: `Longitud inválida (${clean.length}). PF=13, PM=12.` };
}

  function byId(id) { return document.getElementById(id); }

  function validateRFCLive(value) {
  const clean = String(value || '').trim().toUpperCase();
  if (!clean) return { valid: false, message: '', tone: 'neutral' };
  if (clean.length < 12) return { valid: false, message: 'RFC incompleto...', tone: 'neutral' };
  const isPF = RFC_REGEX_PF.test(clean);
  const isPM = RFC_REGEX_PM.test(clean);
  if (isPF || isPM) {
    // ── FIX FASE 1.2.B: Validar carácter verificador ────────────────────
    const checksum = validateRFCChecksum(clean);
    if (!checksum.valid) {
      return {
        valid: false,
        message: `✗ ${checksum.reason}`,
        tone: 'invalid'
      };
    }
    return { valid: true, message: `✓ RFC válido (${isPF ? 'Persona Física' : 'Persona Moral'}) con homoclave correcta`, tone: 'valid' };
  }
  return { valid: false, message: '✗ Formato de RFC inválido', tone: 'invalid' };
}

  function validatePhoneLive(value) {
    const clean = String(value || '').replace(/\D/g, '');
    if (!clean) return { valid: false, message: '', tone: 'neutral' };
    if (PHONE_REGEX.test(clean)) {
      return { valid: true, message: '✓ Número válido para WhatsApp', tone: 'valid' };
    }
    return { valid: false, message: '✗ Ingresa 10 dígitos sin espacios', tone: 'invalid' };
  }

  /**
   * validatePasswordStrict — Regla no negociable: 12 a 18 caracteres.
   * Bloquea el botón de registro si no se cumple.
   */
  function validatePasswordStrict(value) {
    const len = String(value || '').length;
    const inRange = len >= PASSWORD_MIN && len <= PASSWORD_MAX;

    let message = '';
    let tone = 'neutral';

    if (len === 0) {
      message = `Requiere entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres`;
      tone = 'neutral';
    } else if (len < PASSWORD_MIN) {
      message = `Faltan ${PASSWORD_MIN - len} caracteres (mínimo ${PASSWORD_MIN})`;
      tone = 'invalid';
    } else if (len > PASSWORD_MAX) {
      message = `Excede el máximo por ${len - PASSWORD_MAX} caracteres (máximo ${PASSWORD_MAX})`;
      tone = 'invalid';
    } else {
      message = `✓ Longitud válida (${len}/${PASSWORD_MAX})`;
      tone = 'valid';
    }

    return { valid: inRange, message, tone, length: len };
  }

  function updatePasswordUI(value) {
    const result = validatePasswordStrict(value);
    const hint = byId('auth-password-hint');
    const fill = byId('auth-password-strength-fill');

    if (hint) {
      hint.textContent = result.message;
      hint.className = `auth-field-hint ${result.tone}`;
    }

    if (fill) {
      const pct = Math.min(100, (result.length / PASSWORD_MAX) * 100);
      fill.style.width = `${pct}%`;
      fill.style.background = result.valid ? '#10b981' : result.length > PASSWORD_MAX ? '#f59e0b' : '#ef4444';
    }

    return result.valid;
  }

  function updateSubmitButtonState() {
    const submitBtn = byId('auth-submit');
    if (!submitBtn) return;

    if (!isRegisterMode) {
      submitBtn.disabled = false;
      return;
    }

    const password = byId('auth-password')?.value || '';
    const rfc = byId('auth-rfc')?.value || '';
    const phone = byId('auth-phone')?.value || '';
    const fullName = byId('auth-fullname')?.value || '';

    const passwordOk = validatePasswordStrict(password).valid;
    const rfcOk = validateRFCLive(rfc).valid;
    const phoneOk = validatePhoneLive(phone).valid;
    const nameOk = fullName.trim().length >= 3;

    // Bloqueo estricto: el botón se deshabilita si CUALQUIER campo falla
    submitBtn.disabled = !(passwordOk && rfcOk && phoneOk && nameOk);
  }

  /**
   * renderRegisterFields — Genera dinámicamente Nombre Completo, RFC
   * (con validador en tiempo real) y Teléfono WhatsApp.
   */
  function renderRegisterFields() {
    const container = byId('auth-register-fields');
    if (!container) return;

    container.innerHTML = `
      <div class="auth-field">
        <label for="auth-fullname">Nombre completo</label>
        <input type="text" id="auth-fullname" placeholder="Ej. María Fernanda López García" autocomplete="name">
      </div>
      <div class="auth-field">
        <label for="auth-rfc">RFC</label>
        <input type="text" id="auth-rfc" placeholder="XAXX010101000" maxlength="13" autocomplete="off" style="text-transform:uppercase;">
        <div id="auth-rfc-hint" class="auth-field-hint neutral"></div>
      </div>
      <div class="auth-field">
        <label for="auth-phone">Teléfono (WhatsApp)</label>
        <input type="tel" id="auth-phone" placeholder="10 dígitos, ej. 5512345678" maxlength="10" autocomplete="tel">
        <div id="auth-phone-hint" class="auth-field-hint neutral"></div>
      </div>
    `;
    container.style.display = 'block';

    // Bind de validadores en tiempo real
    byId('auth-rfc')?.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
      const result = validateRFCLive(e.target.value);
      const hint = byId('auth-rfc-hint');
      if (hint) {
        hint.textContent = result.message;
        hint.className = `auth-field-hint ${result.tone}`;
      }
      updateSubmitButtonState();
    });

    byId('auth-phone')?.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
      const result = validatePhoneLive(e.target.value);
      const hint = byId('auth-phone-hint');
      if (hint) {
        hint.textContent = result.message;
        hint.className = `auth-field-hint ${result.tone}`;
      }
      updateSubmitButtonState();
    });

    byId('auth-fullname')?.addEventListener('input', updateSubmitButtonState);
  }

  function hideRegisterFields() {
    const container = byId('auth-register-fields');
    if (container) {
      container.innerHTML = '';
      container.style.display = 'none';
    }
  }

  // FIX: garantizar estado limpio al cargar la página — el botón
  // NUNCA debe empezar deshabilitado si el tab activo es login.
  const submitBtnInit = byId('auth-submit');
  if (submitBtnInit && !isRegisterMode) {
    submitBtnInit.disabled = false;
  }

  function switchToLogin() {
  isRegisterMode = false;
  hideRegisterFields();

  byId('tab-login').style.background = 'rgba(82,39,255,0.25)';
  byId('tab-login').style.border = '1px solid #5227FF';
  byId('tab-register').style.background = 'transparent';
  byId('tab-register').style.border = '1px solid #475569';

  const submitBtn = byId('auth-submit');
  if (submitBtn) {
    submitBtn.textContent = '🔐 Iniciar Sesión';
    // FIX: forzar disabled=false SIEMPRE al volver a login,
    // sin importar el estado previo de validación del registro.
    submitBtn.disabled = false;
    submitBtn.removeAttribute('disabled');
  }

  const pwHint = byId('auth-password-hint');
  if (pwHint) { pwHint.textContent = ''; pwHint.className = 'auth-field-hint neutral'; }
  const pwFill = byId('auth-password-strength-fill');
  if (pwFill) pwFill.style.width = '0%';
}

  function switchToRegister() {
    isRegisterMode = true;
    renderRegisterFields();

    byId('tab-register').style.background = 'rgba(82,39,255,0.25)';
    byId('tab-register').style.border = '1px solid #5227FF';
    byId('tab-login').style.background = 'transparent';
    byId('tab-login').style.border = '1px solid #475569';

    const submitBtn = byId('auth-submit');
    if (submitBtn) {
      submitBtn.textContent = 'Crear Cuenta';
      submitBtn.disabled = true; // bloqueado hasta cumplir validaciones
    }

    updatePasswordUI(byId('auth-password')?.value || '');
    updateSubmitButtonState();
  }

  function getRegisterPayload() {
    if (!isRegisterMode) return null;
    return {
      fullName: byId('auth-fullname')?.value?.trim() || '',
      rfc: byId('auth-rfc')?.value?.trim().toUpperCase() || '',
      phone: byId('auth-phone')?.value?.trim() || '',
      email: byId('auth-email')?.value?.trim() || '',
      password: byId('auth-password')?.value || ''
    };
  }

  function isRegisterModeActive() { return isRegisterMode; }

  function init() {
  if (window.__authRegisterUIBound) {
    console.warn('[AuthRegisterUI] init() ya fue ejecutado. Ignorando doble llamada.');
    return;
  }
  window.__authRegisterUIBound = true;

  const tabLogin = byId('tab-login');
  const tabRegister = byId('tab-register');
  const submitBtn = byId('auth-submit');

  if (!tabLogin || !tabRegister || !submitBtn) {
    console.warn(
      '[AuthRegisterUI] ⚠️ No se encontraron uno o más elementos del formulario ' +
      '(tab-login / tab-register / auth-submit). Verifica el orden de carga en index.html.'
    );
    return;
  }

  tabLogin.addEventListener('click', switchToLogin);
  tabRegister.addEventListener('click', switchToRegister);

  byId('auth-password')?.addEventListener('input', (e) => {
    updatePasswordUI(e.target.value);
    updateSubmitButtonState();
  });

  // NOTA: #auth-demo NO se toca aquí. auth.js lo gestiona
  // exclusivamente vía bindEvents() → bypassToDemo().

  console.info('[AuthRegisterUI] ✅ Listeners de tabs y campos de registro vinculados.');
}

  return {
    init,
    isRegisterModeActive,
    getRegisterPayload,
    validatePasswordStrict,
    validateRFCLive,
    validatePhoneLive
  };
})();

window.AuthRegisterUI = AuthRegisterUI;
document.addEventListener('DOMContentLoaded', () => window.AuthRegisterUI.init());