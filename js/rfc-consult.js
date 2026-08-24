// js/rfc-consult.js — Módulo Consultas RFC (FIX FASE 2.5)
// Valida RFC + verifica lista EFOS + genera recomendación fiscal

(function() {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ── Estado interno ────────────────────────────────────────────────────
  let isLoading = false;

  // ── Renderizar UI ─────────────────────────────────────────────────────
  function render() {
    const container = $('rfc-consult-container');
    if (!container) return;

    container.innerHTML = `
      <div class="glass-card" style="max-width:600px;margin:0 auto;">
        <div style="text-align:center;margin-bottom:20px;">
          <h2 style="color:var(--color-text-primary);font-size:24px;margin-bottom:8px;">
            🔍 Consultas RFC
          </h2>
          <p style="color:var(--color-text-secondary);font-size:14px;">
            Valida cualquier RFC antes de emitir o aceptar CFDI
          </p>
        </div>

        <div style="margin-bottom:16px;">
          <label style="display:block;color:var(--color-text-primary);font-weight:600;margin-bottom:8px;">
            RFC a consultar
          </label>
          <input 
            type="text" 
            id="rfc-input" 
            placeholder="Ej: GARC850101HDFRRS0" 
            maxlength="13"
            style="width:100%;padding:12px 16px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg-input);color:var(--color-text-primary);font-size:16px;text-transform:uppercase;"
          />
          <div id="rfc-hint" style="margin-top:6px;font-size:12px;color:var(--color-text-secondary);"></div>
        </div>

        <button 
          id="rfc-consult-btn" 
          style="width:100%;padding:14px;background:var(--color-primary);color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;transition:all 0.2s;"
          onmouseover="this.style.opacity='0.9'" 
          onmouseout="this.style.opacity='1'"
        >
          Consultar RFC
        </button>

        <div id="rfc-result" style="margin-top:20px;"></div>
      </div>
    `;

    // Bind events
    const input = $('rfc-input');
    const btn = $('rfc-consult-btn');

    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleConsult();
    });
    btn.addEventListener('click', handleConsult);
  }

  // ── Validación en tiempo real ─────────────────────────────────────────
  function handleInput(e) {
    const value = e.target.value.toUpperCase();
    const hint = $('rfc-hint');
    
    if (!value) {
      hint.textContent = '';
      return;
    }

    if (value.length < 12) {
      hint.textContent = `⏳ RFC incompleto (${value.length}/12 caracteres para PM, /13 para PF)`;
      hint.style.color = 'var(--color-warning)';
    } else if (value.length === 12 || value.length === 13) {
      hint.textContent = '✓ Longitud correcta, presiona Consultar';
      hint.style.color = 'var(--color-success)';
    } else {
      hint.textContent = '✗ RFC demasiado largo';
      hint.style.color = 'var(--color-error)';
    }
  }

  // ── Consulta al backend ───────────────────────────────────────────────
  async function handleConsult() {
    if (isLoading) return;

    const input = $('rfc-input');
    const btn = $('rfc-consult-btn');
    const resultDiv = $('rfc-result');
    const rfc = input.value.trim().toUpperCase();

    if (!rfc || rfc.length < 12) {
      resultDiv.innerHTML = `
        <div style="padding:16px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);border-radius:8px;color:#fde68a;">
          ⚠️ Ingresa un RFC completo (12 o 13 caracteres)
        </div>
      `;
      return;
    }

    isLoading = true;
    btn.disabled = true;
    btn.textContent = 'Consultando...';
    resultDiv.innerHTML = `
      <div style="text-align:center;padding:20px;color:var(--color-text-secondary);">
        <div style="display:inline-block;width:20px;height:20px;border:2px solid var(--color-primary);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <p style="margin-top:8px;">Consultando RFC y lista EFOS...</p>
      </div>
    `;

    try {
      const token = await getAuthToken();
      const response = await fetch('/api/rfc-consult', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ rfc })
      });

      const result = await response.json();
      renderResult(result);

    } catch (error) {
      resultDiv.innerHTML = `
        <div style="padding:16px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;">
          ❌ Error al consultar: ${error.message}
        </div>
      `;
    } finally {
      isLoading = false;
      btn.disabled = false;
      btn.textContent = 'Consultar RFC';
    }
  }

  // ── Obtener token de Supabase ─────────────────────────────────────────
  async function getAuthToken() {
    try {
      const { data } = await window.supabase.auth.getSession();
      return data.session?.access_token || '';
    } catch {
      return '';
    }
  }

  // ── Renderizar resultado ──────────────────────────────────────────────
  function renderResult(result) {
    const resultDiv = $('rfc-result');
    
    const colors = {
      LOW: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)', text: '#6ee7b7' },
      INFO: { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.3)', text: '#93c5fd' },
      HIGH: { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)', text: '#fcd34d' },
      CRITICAL: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)', text: '#fca5a5' }
    };

    const color = colors[result.riskLevel] || colors.INFO;

    resultDiv.innerHTML = `
      <div style="padding:20px;background:${color.bg};border:1px solid ${color.border};border-radius:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:24px;">${result.riskLevel === 'LOW' ? '✅' : result.riskLevel === 'CRITICAL' ? '🚨' : result.riskLevel === 'HIGH' ? '⚠️' : 'ℹ️'}</span>
          <span style="font-weight:700;color:${color.text};font-size:18px;">
            ${result.valid ? 'RFC Válido' : 'RFC Inválido'}
          </span>
        </div>
        
        <div style="background:rgba(0,0,0,0.2);padding:12px;border-radius:8px;margin-bottom:12px;">
          <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">RFC Consultado</div>
          <div style="font-size:16px;font-weight:600;color:var(--color-text-primary);letter-spacing:1px;">${result.rfc}</div>
        </div>

        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">Resultado</div>
          <div style="font-size:14px;color:${color.text};">${result.reason}</div>
        </div>

        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:var(--color-text-secondary);margin-bottom:4px;">Recomendación</div>
          <div style="font-size:14px;color:var(--color-text-primary);line-height:1.5;">${result.recommendation}</div>
        </div>

        ${result.inEFOSList ? `
        <div style="padding:12px;background:rgba(239,68,68,0.2);border-radius:8px;margin-bottom:12px;">
          <div style="font-weight:700;color:#fca5a5;margin-bottom:6px;">📋 Detalles EFOS</div>
          <div style="font-size:13px;color:#fecaca;">
            <div>Emisor: ${result.efosData?.rfc_emisor || 'N/A'}</div>
            <div>Situación: ${result.efosData?.situacion || 'N/A'}</div>
            <div>Fuente: ${result.efosData?.fuente || 'SAT'}</div>
          </div>
        </div>
        ` : ''}

        <div style="font-size:12px;color:var(--color-text-secondary);margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.1);">
          📜 ${result.legalReference || 'Art. 69-B CFF'}
        </div>
      </div>
    `;
  }

  // ── Inicialización ────────────────────────────────────────────────────
  function init() {
    render();
  }

  // Exponer API pública
  window.RFCConsult = { init, render };

  // Auto-inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();