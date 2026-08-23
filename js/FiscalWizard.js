// js/FiscalWizard.js — Aliado RESICO 2026
// VERSION CERTIFICADA Y CORREGIDA: Fixes aplicados:
// - FIX ALTO-3: Art. 113-F completo: intereses > $100k → anual obligatoria
// - FIX ALTO-3: Campo separado para salarios e intereses
// - FIX T21: Alerta proactiva e.firma próxima a vencer (30 días)
// - FIX T25-T29: Validador de RFC (PF=13 chars, PM=12 chars)
// - FIX UI: Confirmación en lugar de alert() (más profesional)
// - FIX SINTAXIS: Llaves de cierre faltantes corregidas (bloqueaban el script)

(function () {
  // ── Constantes Fiscales 2026 ─────────────────────────────
  const RESICO_LIMIT = 3_500_000;
  const ANNUAL_THRESHOLD_80 = RESICO_LIMIT * 0.80; // $2,800,000
  const ANNUAL_THRESHOLD_90 = RESICO_LIMIT * 0.90; // $3,150,000
  const ANNUAL_THRESHOLD_94 = RESICO_LIMIT * 0.94; // $3,290,000
  const MIXTOS_LIMIT = 400_000; // Art. 113-F LISR — salarios
  const INTERESES_LIMIT = 100_000; // Art. 113-F LISR — intereses
  const MULTA_BUZON = 10_260; // Art. 17-K CFF
  const EFIRMA_ALERT_DAYS = 30; // Días de anticipación para alerta

  // ── Estado del wizard ────────────────────────────────────
  const STEPS = 5; // Aumentado de 4 a 5 para separar salarios/intereses
  let currentStep = 1;
  let wizardData = {};

  // ── Validador de RFC ──────────────────────────────────────

  /**
   * Valida formato de RFC mexicano.
   * PF: 4 letras + 6 dígitos fecha + 3 homoclave = 13 chars
   * PM: 3 letras + 6 dígitos fecha + 3 homoclave = 12 chars
   * @param {string} rfc
   * @returns {{ valid: boolean, type: 'PF'|'PM'|null, warning: string|null }}
   */
  function validateRFC(rfc) {
    if (!rfc || typeof rfc !== 'string') {
      return { valid: false, type: null, warning: 'RFC vacío o inválido.' };
    }

    const cleaned = rfc.trim().toUpperCase();

    // RFC genérico CFDI (no acredita IVA)
    const GENERIC_RFCs = ['XAXX010101000', 'XEXX010101000'];
    if (GENERIC_RFCs.includes(cleaned)) {
      return {
        valid: true,
        type: cleaned === 'XEXX010101000' ? 'extranjero' : 'publico',
        warning: '⚠️ RFC genérico: No permite acreditamiento de IVA ni deducción de ISR. Solicita factura con RFC real.'
      };
    }

    // Patrón PF (Persona Física): 13 caracteres
    const rfcPF = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;
    if (rfcPF.test(cleaned)) {
      return { valid: true, type: 'PF', warning: null };
    }

    // Patrón PM (Persona Moral): 12 caracteres
    const rfcPM = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;
    if (rfcPM.test(cleaned)) {
      return { valid: true, type: 'PM', warning: null };
    }

    // Detección de longitud incorrecta
    if (cleaned.length === 12) {
      return {
        valid: false,
        type: null,
        warning: `RFC de 12 caracteres con formato incorrecto. ¿Es Persona Moral? Verifica en el SAT.`
      };
    }

    if (cleaned.length === 13) {
      return {
        valid: false,
        type: null,
        warning: `RFC de 13 caracteres con formato incorrecto. ¿Es Persona Física? Verifica en el SAT.`
      };
    }

    return {
      valid: false,
      type: null,
      warning: `RFC inválido (${cleaned.length} caracteres). PF=13, PM=12. Riesgo de rechazo SAT.`
    };
  }

  // ── Alerta proactiva e.firma ──────────────────────────────

  /**
   * Calcula días hasta vencimiento de e.firma y genera alerta si <30 días.
   * FIX T21: Implementación de alerta proactiva
   */
  function checkEFirmaProximaVencer() {
    const saludFiscal = window.Store?.getSaludFiscal?.() || {};
    const expiryStr = saludFiscal.eFirmaExpiry ||
      window.Store?.getCarpetaFiscal?.()?.efirmaExpiry;

    if (!expiryStr || expiryStr === 'pendiente') return null;

    const expiry = new Date(expiryStr);
    const today = new Date();
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      return {
        level: 'VENCIDA',
        days: Math.abs(diffDays),
        message: `⚠️ Tu e.firma venció hace ${Math.abs(diffDays)} día(s). Sin e.firma no puedes emitir CFDI ni presentar declaraciones. Renuévala en el SAT inmediatamente.`
      };
    }

    if (diffDays <= EFIRMA_ALERT_DAYS) {
      return {
        level: 'PROXIMA',
        days: diffDays,
        message: `⏰ Tu e.firma vence en ${diffDays} día(s) (${expiry.toLocaleDateString('es-MX')}). Agenda tu renovación en el SAT antes de que expire.`
      };
    }

    return null;
  }

  // ── Navegación del wizard ─────────────────────────────────

  window.wizardNext = function () {
    if (!validateCurrentStep()) return;

    if (currentStep === STEPS) {
      showResult();
      return;
    }

    const current = document.querySelector(`.wizard-step[data-step="${currentStep}"]`);
    current?.classList.remove('active');
    currentStep++;
    const next = document.querySelector(`.wizard-step[data-step="${currentStep}"]`);
    next?.classList.add('active');
    updateProgress();
  };

  function validateCurrentStep() {
    if (currentStep === 1) {
      // Paso 1: Ingresos brutos RESICO
      const income = parseFloat(document.getElementById('wiz-income')?.value);
      if (isNaN(income) || income < 0) {
        showWizardError('Ingresa un monto válido (puede ser $0 si apenas empiezas).');
        return false;
      }

      wizardData.income = income;

      // Validar límite RESICO
      if (income > RESICO_LIMIT) {
        showWizardError(`¡Atención! $${income.toLocaleString('es-MX')} supera el límite RESICO de $${RESICO_LIMIT.toLocaleString('es-MX')}. Consulta a tu contador sobre cambio de régimen.`);
        return false;
      }

      return true;
    }

    if (currentStep === 2) {
      // Paso 2: ¿Ingresos mixtos? (salarios de empresa)
      wizardData.mixtos = document.getElementById('wiz-mixtos')?.value === 'si';
      wizardData.socioPM = document.getElementById('wiz-socio')?.value === 'si';
      return true;
    }

    if (currentStep === 3) {
      // Paso 3 (NUEVO): Monto de salarios e intereses — FIX ALTO-3
      const salarios = parseFloat(document.getElementById('wiz-salarios')?.value || '0');
      const intereses = parseFloat(document.getElementById('wiz-intereses')?.value || '0');

      if (wizardData.mixtos && (isNaN(salarios) || salarios < 0)) {
        showWizardError('Ingresa el monto de salarios recibidos.');
        return false;
      }

      wizardData.salarios = isNaN(salarios) ? 0 : salarios;
      wizardData.intereses = isNaN(intereses) ? 0 : intereses;
      return true;
    }

    if (currentStep === 4) {
      // Paso 4: CFDI global y buzón
      wizardData.cfdiGlobal = document.getElementById('wiz-cfdi')?.value === 'si';
      wizardData.buzonActivo = document.getElementById('wiz-buzon')?.value === 'si';
      return true;
    }

    return true;
  }

  // ── Cálculo del resultado ─────────────────────────────────

  function showResult() {
    const ingresos = wizardData.income || 0;
    const mixtos = wizardData.mixtos || false;
    const socio = wizardData.socioPM || false;
    const cfdi = wizardData.cfdiGlobal !== undefined ? wizardData.cfdiGlobal : true;
    const salarios = wizardData.salarios || 0;
    const intereses = wizardData.intereses || 0;
    const buzon = wizardData.buzonActivo !== undefined ? wizardData.buzonActivo : true;

    // ── Regla Art. 113-F LISR — FIX ALTO-3 COMPLETO ──────
    const mixtosSalariosObligatorios = mixtos && (salarios > MIXTOS_LIMIT);
    const interesesObligatorios = intereses > INTERESES_LIMIT;
    const anualObligatoria = mixtosSalariosObligatorios || interesesObligatorios || socio;

    // ── Riesgo CFDI Global (Art. 17-K CFF) ────────────────
    const riesgoMulta = !cfdi;

    // ── Riesgo Buzón Tributario ────────────────────────────
    const riesgoBuzon = !buzon;

    // ── Nivel de riesgo del monitor $3.5M ─────────────────
    const riskLevel = calcRiskLevelLocal(ingresos);

    // ── Alerta e.firma ─────────────────────────────────────
    const efirmaAlert = checkEFirmaProximaVencer();

    // ── Renderizar resultados ──────────────────────────────
    const fmt = n => `$${Number(n).toLocaleString('es-MX')} MXN`;

    setResultField('res-income', fmt(ingresos));
    setResultField('res-salarios', fmt(salarios));
    setResultField('res-intereses', fmt(intereses));

    // Declaración anual
    const anualEl = document.getElementById('res-anual');
    if (anualEl) {
      let anualText = anualObligatoria ? '⚠️ OBLIGATORIA' : '✅ No obligatoria';
      let anualDetail = '';
      if (mixtosSalariosObligatorios) anualDetail += ' (salarios > $400k — Art. 113-F)';
      if (interesesObligatorios) anualDetail += ' (intereses > $100k — Art. 113-F)';
      if (socio) anualDetail += ' (socio de PM)';
      anualEl.textContent = anualText + anualDetail;
      anualEl.style.color = anualObligatoria ? '#ef4444' : '#10b981';
    }

    // Riesgo CFDI
    const multaEl = document.getElementById('res-multa');
    if (multaEl) {
      multaEl.textContent = riesgoMulta
        ? `🔴 Sin CFDI global → multa hasta ${fmt(MULTA_BUZON)} (Art. 17-K CFF)`
        : '✅ CFDI global al corriente';
      multaEl.style.color = riesgoMulta ? '#ef4444' : '#10b981';
    }

    // Riesgo Buzón
    const buzonEl = document.getElementById('res-buzon');
    if (buzonEl) {
      buzonEl.textContent = riesgoBuzon
        ? `🔴 Buzón inactivo → multa hasta ${fmt(MULTA_BUZON)} (Art. 17-K CFF)`
        : '✅ Buzón Tributario activo';
      buzonEl.style.color = riesgoBuzon ? '#ef4444' : '#10b981';
    }

    // Monitor RESICO
    const riskEl = document.getElementById('res-risk');
    if (riskEl) {
      const riskColors = {
        SEGURO: '#10b981',
        PREVENTIVO: '#f59e0b',
        RIESGO_ALTO: '#f97316',
        EXPULSION: '#ef4444'
      };
      const pct = ingresos > 0 ? ((ingresos / RESICO_LIMIT) * 100).toFixed(1) : '0.0';
      riskEl.textContent = `${riskLevel} — ${pct}% del límite anual`;
      riskEl.style.color = riskColors[riskLevel] || '#64748b';
    }

    // Alerta e.firma próxima a vencer
    const efirmaEl = document.getElementById('res-efirma');
    if (efirmaEl && efirmaAlert) {
      efirmaEl.textContent = efirmaAlert.message;
      efirmaEl.style.color = efirmaAlert.level === 'VENCIDA' ? '#ef4444' : '#f59e0b';
      efirmaEl.hidden = false;
    } else if (efirmaEl) {
      efirmaEl.hidden = true;
    }

    // Recomendación final
    let recomendacion = '';
    if (anualObligatoria) recomendacion += 'Debes presentar Declaración Anual en abril 2027. ';
    if (riesgoMulta) recomendacion += `Emite CFDI global de inmediato para evitar multa de ${fmt(MULTA_BUZON)}. `;
    if (riesgoBuzon) recomendacion += 'Activa tu Buzón Tributario en el portal del SAT hoy mismo. ';
    if (riskLevel === 'PREVENTIVO') recomendacion += 'Monitorea tus ingresos — estás al 80% del límite RESICO. ';
    if (riskLevel === 'RIESGO_ALTO') recomendacion += '¡Precaución! Estás al 90%+ del límite. Habla con tu contador. ';
    if (riskLevel === 'EXPULSION') recomendacion += '🚨 URGENTE: Superas el 94% del límite RESICO. Cambia de régimen inmediatamente. ';
    if (!recomendacion) recomendacion = '✅ Estás al día fiscalmente. Sigue facturando y cumpliendo puntualmente.';

    setResultField('res-recomendacion', recomendacion);

    // Nota pedagógica ISR vs IVA
    setResultField('res-pedagogia',
      '📚 Recuerda: ISR RESICO se calcula sobre tus ingresos brutos (sin deducciones). ' +
      'IVA solo es acreditable si tienes CFDI válido y el gasto fue indispensable para tu actividad.'
    );

    // Ocultar botón siguiente y mostrar resumen
    const lastStep = document.querySelector(`.wizard-step[data-step="${STEPS}"] .btn-primary`);
    if (lastStep) lastStep.style.display = 'none';

    const resultEl = document.getElementById('wizard-result');
    if (resultEl) resultEl.style.display = 'block';

    // Persistir diagnóstico en store
    window.Store?.setState?.({
      diagnostic: {
        income: ingresos,
        salarios,
        intereses,
        mixtos,
        socioPM: socio,
        cfdiGlobal: cfdi,
        buzonActivo: buzon,
        anualObligatoria,
        riesgoMulta,
        riesgoBuzon,
        riskLevel,
        recomendacion,
        completedAt: new Date().toISOString()
      }
    });
  }

  // ── Guardar diagnóstico en Supabase ──────────────────────

  window.saveDiagnostic = async function () {
    const user = window.APP_STATE?.currentUser;
    const client = window.APP_STATE?.supabase;
    const diag = window.Store?.getState?.()?.diagnostic || {};

    if (!user) {
      showWizardError('Inicia sesión para guardar el diagnóstico.');
      return;
    }

    if (!client) {
      showWizardError('Servicio de base de datos no disponible.');
      return;
    }

    try {
      const { error } = await client.from('diagnostic_results').upsert({
        user_id: user.id,
        income_estimated: diag.income || 0,
        salarios_estimated: diag.salarios || 0, // FIX ALTO-3
        intereses_estimated: diag.intereses || 0, // FIX ALTO-3
        has_mixed_income: diag.mixtos || false,
        is_socio_pm: diag.socioPM || false,
        has_cfdi_global: diag.cfdiGlobal || false,
        anual_obligatoria: diag.anualObligatoria || false,
        riesgo_multa: diag.riesgoMulta || false,
        recomendacion: diag.recomendacion || '',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

      if (error) throw error;
      showWizardSuccess('✅ Diagnóstico guardado correctamente en tu Bóveda Fiscal.');
    } catch (e) {
      showWizardError('Error al guardar: ' + (e.message || 'Intenta de nuevo.'));
    }
  };

  // ── Resetear wizard ───────────────────────────────────────

  window.resetWizard = function () {
    currentStep = 1;
    wizardData = {};

    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    const firstStep = document.querySelector('.wizard-step[data-step="1"]');
    firstStep?.classList.add('active');

    const resultEl = document.getElementById('wizard-result');
    if (resultEl) resultEl.style.display = 'none';

    const lastBtn = document.querySelector(`.wizard-step[data-step="${STEPS}"] .btn-primary`);
    if (lastBtn) lastBtn.style.display = 'inline-block';

    // Limpiar campos
    const fields = {
      'wiz-income': '',
      'wiz-mixtos': 'no',
      'wiz-socio': 'no',
      'wiz-salarios': '0',
      'wiz-intereses': '0',
      'wiz-cfdi': 'si',
      'wiz-buzon': 'si'
    };
    Object.entries(fields).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });

    updateProgress();
    hideWizardMessage();
  };

  // ── Utilidades UI ─────────────────────────────────────────

  function setResultField(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function showWizardError(msg) {
    const msgEl = document.getElementById('wizard-msg');
    if (msgEl) {
      msgEl.textContent = msg;
      msgEl.style.color = '#ef4444';
      msgEl.style.display = 'block';
    }
  }

  function showWizardSuccess(msg) {
    const msgEl = document.getElementById('wizard-msg');
    if (msgEl) {
      msgEl.textContent = msg;
      msgEl.style.color = '#10b981';
      msgEl.style.display = 'block';
    }
  }

  function hideWizardMessage() {
    const msgEl = document.getElementById('wizard-msg');
    if (msgEl) msgEl.style.display = 'none';
  }

  function updateProgress() {
    const dots = document.querySelectorAll('#wizard-progress span');
    dots.forEach((dot, idx) => {
      dot.style.color = (idx + 1) <= currentStep ? '#10b981' : '#64748b';
      dot.style.fontWeight = (idx + 1) === currentStep ? '700' : '400';
    });
  }

  /**
   * Calcula el nivel de riesgo local (sin Supabase) para el resultado del wizard.
   */
  function calcRiskLevelLocal(income) {
    const ratio = income / RESICO_LIMIT;
    if (ratio >= 0.94) return 'EXPULSION';
    if (ratio >= 0.90) return 'RIESGO_ALTO';
    if (ratio >= 0.80) return 'PREVENTIVO';
    return 'SEGURO';
  }

  // ── Exponer validador RFC globalmente ─────────────────────
  window.ValidatorRFC = { validate: validateRFC };

  // ── Inicialización ────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    const firstStep = document.querySelector('.wizard-step[data-step="1"]');
    firstStep?.classList.add('active');
    updateProgress();

    // Verificar e.firma al cargar el wizard (alerta proactiva)
    const efirmaAlert = checkEFirmaProximaVencer();
    if (efirmaAlert) {
      const alertBanner = document.getElementById('efirma-alert-banner');
      if (alertBanner) {
        alertBanner.textContent = efirmaAlert.message;
        alertBanner.style.color = efirmaAlert.level === 'VENCIDA' ? '#ef4444' : '#f59e0b';
        alertBanner.style.display = 'block';
      }
    }
  });
})();
