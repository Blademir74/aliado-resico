// FiscalWizard.js
(function() {
  const STEPS = 4;
  let currentStep = 1;
  let wizardData = {};

  window.wizardNext = function() {
    // Validar paso actual
    if (currentStep === 1) {
      const income = parseFloat(document.getElementById('wiz-income').value);
      if (isNaN(income) || income <= 0) {
        alert('Ingresa un monto válido.');
        return;
      }
      wizardData.income = income;
    } else if (currentStep === 2) {
      wizardData.mixtos = document.getElementById('wiz-mixtos').value === 'si';
      wizardData.socioPM = document.getElementById('wiz-socio').value === 'si';
    } else if (currentStep === 3) {
      wizardData.cfdiGlobal = document.getElementById('wiz-cfdi').value === 'si';
    }

    // Calcular si ya estamos en el último paso
    if (currentStep === STEPS) {
      showResult();
      return;
    }

    // Avanzar
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.remove('active');
    currentStep++;
    document.querySelector(`.wizard-step[data-step="${currentStep}"]`).classList.add('active');
    updateProgress();
  };

  function showResult() {
    const ingresos = wizardData.income || 0;
    const mixtos = wizardData.mixtos || false;
    const socio = wizardData.socioPM || false;
    const cfdi = wizardData.cfdiGlobal !== undefined ? wizardData.cfdiGlobal : true;

    // Regla Art. 113-F: declaración anual obligatoria si ingresos mixtos > 400k o socio_PM
    const anualObligatoria = (mixtos && ingresos > 400000) || socio;

    // Alerta CFDI global (Art. 17-K)
    const riesgoMulta = !cfdi;

    // Mensajes
    document.getElementById('res-income').textContent = `$${ingresos.toLocaleString('es-MX')} MXN`;
    document.getElementById('res-anual').textContent = anualObligatoria ? '⚠️ Obligatoria (Art. 113-F)' : '✅ No obligatoria';
    document.getElementById('res-anual').style.color = anualObligatoria ? '#ef4444' : '#10b981';
    document.getElementById('res-multa').textContent = riesgoMulta ? '🔴 Riesgo de multa (Art. 17-K CFF)' : '✅ Sin riesgo';
    document.getElementById('res-multa').style.color = riesgoMulta ? '#ef4444' : '#10b981';

    let recomendacion = '';
    if (anualObligatoria) recomendacion += 'Debes presentar declaración anual en abril. ';
    if (riesgoMulta) recomendacion += '¡Emita CFDI global de inmediato para evitar multa de $10,260 MXN! ';
    if (!anualObligatoria && !riesgoMulta) recomendacion = 'Estás al día. Sigue facturando y cumpliendo.';
    document.getElementById('res-recomendacion').textContent = recomendacion;

    // Ocultar botón siguiente y mostrar resumen
    document.querySelector(`.wizard-step[data-step="${currentStep}"] .btn-primary`).style.display = 'none';
    document.getElementById('wizard-result').style.display = 'block';

    // Guardar datos localmente
    window.Store?.setState?.({
      diagnostic: {
        income: ingresos,
        mixtos,
        socioPM: socio,
        cfdiGlobal: cfdi,
        anualObligatoria,
        riesgoMulta,
        recomendacion,
        completedAt: new Date().toISOString()
      }
    });
  }

  window.saveDiagnostic = async function() {
    const user = window.APP_STATE?.currentUser;
    if (!user) {
      alert('Inicia sesión para guardar el diagnóstico.');
      return;
    }
    const client = window.APP_STATE?.supabase;
    if (!client) {
      alert('Supabase no disponible.');
      return;
    }
    const diag = window.Store?.getState?.()?.diagnostic || {};
    try {
      const { error } = await client.from('diagnostic_results').upsert({
        user_id: user.id,
        income_estimated: diag.income || 0,
        has_mixed_income: diag.mixtos || false,
        is_socio_pm: diag.socioPM || false,
        has_cfdi_global: diag.cfdiGlobal || false,
        anual_obligatoria: diag.anualObligatoria || false,
        riesgo_multa: diag.riesgoMulta || false,
        recomendacion: diag.recomendacion || '',
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) throw error;
      alert('Diagnóstico guardado correctamente.');
    } catch (e) {
      alert('Error al guardar: ' + e.message);
    }
  };

  window.resetWizard = function() {
    currentStep = 1;
    wizardData = {};
    document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
    document.querySelector('.wizard-step[data-step="1"]').classList.add('active');
    document.getElementById('wizard-result').style.display = 'none';
    document.querySelector(`.wizard-step[data-step="4"] .btn-primary`).style.display = 'inline-block';
    // Limpiar campos
    document.getElementById('wiz-income').value = '';
    document.getElementById('wiz-mixtos').value = 'no';
    document.getElementById('wiz-socio').value = 'no';
    document.getElementById('wiz-cfdi').value = 'si';
    updateProgress();
  };

  function updateProgress() {
    const dots = document.querySelectorAll('#wizard-progress span');
    dots.forEach((dot, idx) => {
      dot.style.color = (idx + 1) <= currentStep ? '#10b981' : '#64748b';
    });
  }

  // Inicializar
  document.addEventListener('DOMContentLoaded', () => {
    // Mostrar el primer paso
    document.querySelector('.wizard-step[data-step="1"]').classList.add('active');
    updateProgress();
  });
})();