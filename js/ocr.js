const DocumentProcessor = (() => {
  let booted = false;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',') : result;[6]
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderResult(payload) {
    const doc = payload?.document || {};
    const data = doc.extracted_data || {};
    const review = !!payload?.needsHumanReview || !!doc?.needs_review || !!doc?.safety_flag;

    return `
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:16px;color:#e2e8f0;">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
          <div>
            <div style="font-weight:700;">${esc(doc.file_name || 'documento')}</div>
            <div style="color:#94a3b8;font-size:13px;margin-top:4px;">
              ${esc(doc.document_type || doc.doc_type || 'OTRO')} · Confianza ${Math.round(Number(doc.confidence || 0) * 100)}%
            </div>
          </div>
          <span class="${review ? 'badge-warning' : 'badge-safe'}" style="padding:6px 10px;border-radius:999px;">
            ${review ? 'Verificación humana obligatoria' : 'Procesado'}
          </span>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:12px;">
          <div><strong>RFC emisor:</strong><br>${esc(data.rfc_emisor || '—')}</div>
          <div><strong>RFC receptor:</strong><br>${esc(data.rfc_receptor || '—')}</div>
          <div><strong>Subtotal:</strong><br>${esc(data.subtotal ?? '—')}</div>
          <div><strong>IVA:</strong><br>${esc(data.iva ?? '—')}</div>
          <div><strong>Total:</strong><br>${esc(data.total ?? '—')}</div>
          <div><strong>Folio:</strong><br>${esc(data.folio || '—')}</div>
          <div><strong>Fecha:</strong><br>${esc(data.fecha || '—')}</div>
          <div><strong>Utilidad fiscal:</strong><br>${esc(data.tax_usefulness || '—')}</div>
        </div>

        <div style="margin-top:12px;color:#94a3b8;font-size:13px;">
          ${esc(doc.pedagogical_note || 'ISR RESICO no deduce gastos; IVA requiere CFDI válido y gasto indispensable.')}
        </div>
      </div>
    `;
  }

  async function processSelectedFile() {
    const input = document.getElementById('file-input');
    const output = document.getElementById('ocr-output');
    const button = document.getElementById('ocr-process-btn');

    if (!input || !output || !button) return;

    const file = input.files?.;
    if (!file) {
      output.innerHTML = '<p style="color:#f59e0b;">Selecciona un archivo antes de analizar.</p>';
      return;
    }

    button.disabled = true;
    button.textContent = 'Analizando...';
    output.innerHTML = '<p style="color:#94a3b8;">Extrayendo datos fiscales…</p>';

    try {
      const base64Data = await fileToBase64(file);

      const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
      const token = session?.data?.session?.access_token;

      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch('/api/document-ocr', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          base64Data
        })
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error || `OCR HTTP ${response.status}`);
      }

      output.innerHTML = renderResult(payload);

      await window.Store?.saveDocument?.({
        ...payload.document,
        file_name: payload.document.file_name || file.name,
        document_type: payload.document.document_type || payload.document.doc_type || 'OTRO',
        extracted_data: payload.document.extracted_data || {},
        confidence: Number(payload.document.confidence || 0),
        safety_flag: !!payload.document.safety_flag,
        validation_status: payload.document.validation_status || 'pendiente',
        needs_review: !!payload.document.needs_review || !!payload.needsHumanReview,
        source: payload.document.source || 'ocr_ai',
        created_at: new Date().toISOString()
      });

      window.DocumentsManager?.renderDocuments?.();
    } catch (error) {
      output.innerHTML = `
        <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);border-radius:12px;padding:14px;color:#fecaca;">
          Error procesando documento: ${esc(error?.message || 'Error desconocido')}
        </div>
      `;
    } finally {
      button.disabled = false;
      button.textContent = 'Analizar documento';
    }
  }

  function init() {
    if (booted) return;
    booted = true;

    const button = document.getElementById('ocr-process-btn');
    if (button) {
      button.addEventListener('click', processSelectedFile);
    }
  }

  return {
    init,
    processSelectedFile
  };
})();

window.DocumentProcessor = DocumentProcessor;