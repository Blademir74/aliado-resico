const Invoicing = (() => {
  const LS_KEY = 'aliado_resico_invoice_profiles_v1';
  let booted = false;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function loadProfiles() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveProfiles(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function getFormData() {
    return {
      rfc: byId('inv-rfc')?.value?.trim()?.toUpperCase() || '',
      name: byId('inv-name')?.value?.trim() || '',
      zip: byId('inv-zip')?.value?.trim() || '',
      regimenFiscal: byId('inv-regimen')?.value?.trim() || '',
      usoCfdi: byId('inv-uso-cfdi')?.value?.trim()?.toUpperCase() || '',
      metodoPago: byId('inv-metodo-pago')?.value?.trim()?.toUpperCase() || 'PUE',
      formaPago: byId('inv-forma-pago')?.value?.trim() || '',
      claveProdServ: byId('inv-clave-prodserv')?.value?.trim() || '',
      description: byId('inv-description')?.value?.trim() || '',
      unitPrice: Number(byId('inv-unit-price')?.value || 0),
      quantity: Number(byId('inv-quantity')?.value || 1),
      ivaType: byId('inv-iva-type')?.value?.trim()?.toUpperCase() || '16',
      receptorType: byId('inv-receptor-type')?.value?.trim()?.toUpperCase() || 'PF'
    };
  }

  function isValidRFC(rfc) {
    const clean = String(rfc || '').trim().toUpperCase();
    return /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(clean) || clean === 'XAXX010101000' || clean === 'XEXX010101000';
  }

  function validate(data) {
    const errors = [];
    if (!isValidRFC(data.rfc)) errors.push('RFC receptor inválido.');
    if (!data.name) errors.push('Nombre o razón social requerido.');
    if (!/^\d{5}$/.test(data.zip)) errors.push('Código postal inválido.');
    if (!data.regimenFiscal) errors.push('Régimen fiscal requerido.');
    if (!data.usoCfdi) errors.push('Uso CFDI requerido.');
    if (!['PUE', 'PPD'].includes(data.metodoPago)) errors.push('Método de pago inválido.');
    if (!data.formaPago) errors.push('Forma de pago requerida.');
    if (!data.claveProdServ) errors.push('Clave producto/servicio requerida.');
    if (!data.description) errors.push('Descripción requerida.');
    if (!(data.unitPrice > 0)) errors.push('Precio unitario inválido.');
    if (!(data.quantity > 0)) errors.push('Cantidad inválida.');
    return errors;
  }

  function renderOutput(html) {
    const out = byId('inv-output');
    if (out) out.innerHTML = html;
  }

  function renderProfiles() {
    const box = byId('inv-saved-profiles');
    if (!box) return;

    const profiles = loadProfiles();
    if (!profiles.length) {
      box.innerHTML = 'Sin perfiles guardados.';
      return;
    }

    box.innerHTML = profiles.map((p, idx) => `
      <button data-profile-index="${idx}" style="text-align:left;padding:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;color:#e2e8f0;cursor:pointer;">
        <strong>${esc(p.name)}</strong><br>
        <span style="color:#94a3b8;">${esc(p.rfc)} · ${esc(p.usoCfdi)} · ${esc(p.regimenFiscal)}</span>
      </button>
    `).join('');

    box.querySelectorAll('[data-profile-index]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-profile-index'));
        const p = profiles[idx];
        if (!p) return;

        byId('inv-rfc').value = p.rfc || '';
        byId('inv-name').value = p.name || '';
        byId('inv-zip').value = p.zip || '';
        byId('inv-regimen').value = p.regimenFiscal || '';
        byId('inv-uso-cfdi').value = p.usoCfdi || '';
        byId('inv-forma-pago').value = p.formaPago || '';
        byId('inv-clave-prodserv').value = p.claveProdServ || '';
        byId('inv-receptor-type').value = p.receptorType || 'PF';
      });
    });
  }

  function saveCurrentProfile() {
    const data = getFormData();
    const errors = validate(data);

    if (errors.length) {
      renderOutput(`
        <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);padding:12px;border-radius:12px;color:#fecaca;">
          ${errors.map(e => `<div>${esc(e)}</div>`).join('')}
        </div>
      `);
      return;
    }

    const profiles = loadProfiles();
    const withoutSame = profiles.filter(p => p.rfc !== data.rfc);
    withoutSame.unshift({
      rfc: data.rfc,
      name: data.name,
      zip: data.zip,
      regimenFiscal: data.regimenFiscal,
      usoCfdi: data.usoCfdi,
      formaPago: data.formaPago,
      claveProdServ: data.claveProdServ,
      receptorType: data.receptorType
    });

    saveProfiles(withoutSame.slice(0, 20));
    renderProfiles();

    renderOutput(`
      <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);padding:12px;border-radius:12px;color:#d1fae5;">
        Perfil receptor guardado correctamente.
      </div>
    `);
  }

  async function createInvoice() {
    const btn = byId('inv-create-btn');
    const data = getFormData();
    const errors = validate(data);

    if (errors.length) {
      renderOutput(`
        <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);padding:12px;border-radius:12px;color:#fecaca;">
          ${errors.map(e => `<div>${esc(e)}</div>`).join('')}
        </div>
      `);
      return;
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Timbrando...';
    }

    renderOutput('<div style="color:#94a3b8;">Enviando factura a Alegra…</div>');

    try {
      const response = await fetch('/api/alegra-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_invoice', input: data })
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result?.ok) {
        const detail = Array.isArray(result?.details) ? result.details.join(' · ') : (result?.error || 'Error desconocido');
        throw new Error(detail);
      }

      const total = result?.invoice?.total ?? '—';
      const number = result?.invoice?.number || result?.invoice?.id || 'sin folio';
      const repRequired = !!result?.repRequired;
      const retISR = !!result?.fiscal?.retencionISR125;

      if (window.Store?.addConversation) {
        window.Store.addConversation({
          message_text: `CFDI emitido para ${data.rfc} por ${data.unitPrice * data.quantity}`,
          intent: 'SOLICITUD_FACTURA',
          confidence: 0.99,
          source: 'alegra'
        });
      }

      if (window.Store?.updateIncome) {
        const current = Number(window.Store.getState?.().incomeYTD || 0);
        const next = current + Number(data.unitPrice || 0) * Number(data.quantity || 0);
        window.Store.updateIncome(next);
      }

      renderOutput(`
        <div style="background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.35);padding:16px;border-radius:12px;color:#d1fae5;">
          <div style="font-weight:700;">CFDI creado correctamente</div>
          <div style="margin-top:6px;">Folio / referencia: ${esc(number)}</div>
          <div style="margin-top:6px;">Total reportado por Alegra: ${esc(total)}</div>
          <div style="margin-top:6px;">Retención ISR 1.25% aplicada: ${retISR ? 'Sí' : 'No'}</div>
          <div style="margin-top:6px;">REP requerido: ${repRequired ? 'Sí, por método PPD' : 'No'}</div>
        </div>
      `);
    } catch (error) {
      renderOutput(`
        <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);padding:16px;border-radius:12px;color:#fecaca;">
          Error al timbrar: ${esc(error?.message || 'desconocido')}
        </div>
      `);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Timbrar CFDI ingreso';
      }
    }
  }

  function init() {
    if (booted) return;
    booted = true;

    byId('inv-create-btn')?.addEventListener('click', createInvoice);
    byId('inv-save-profile-btn')?.addEventListener('click', saveCurrentProfile);
    renderProfiles();
  }

  return {
    init,
    createInvoice,
    saveCurrentProfile,
    renderProfiles
  };
})();

window.Invoicing = Invoicing;