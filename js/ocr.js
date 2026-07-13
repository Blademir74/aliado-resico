const DocumentProcessor = (() => {
  function esc(text) {
    return String(text || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = String(r.result || '');
        // Extrae solo la parte base64 (después de la coma)
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function processImage(file) {
    const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
    const token = session?.data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const base64Data = await fileToBase64(file);

    const resp = await fetch('/api/gemini-proxy', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text: [
                'Eres OCR fiscal mexicano para RESICO 2026.',
                'Extrae SOLO JSON con estos campos:',
                '{',
                '"document_type":"CFDI|TICKET|OTRO",',
                '"confidence":0.97,',
                '"rfc_emisor":"string|null",',
                '"rfc_receptor":"string|null",',
                '"subtotal":123.45,',
                '"iva":19.76,',               // <-- IVA desglosado obligatorio
                '"total":143.21,',
                '"folio":"string|null",',
                '"fecha":"YYYY-MM-DD|null",',
                '"nota":"ISR: sin deducciones. IVA: indispensable para acreditamiento con CFDI válido."',
                '}',
                'El IVA debe salir desglosado cuando exista. Si no se detecta, enviar 0.'
              ].join('\n')
            },
            {
              inline_data: {
                mime_type: file.type || 'image/jpeg',
                data: base64Data
              }
            }
          ]
        }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 500 }
      })
    });

    if (!resp.ok) throw new Error(`OCR HTTP ${resp.status}`);

    const d = await resp.json();
    // Uso correcto del encadenamiento opcional (no hay doble ?.?)
    const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = raw.replace(/```json/gi, '```').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('OCR sin JSON válido');

    let data;
    try {
      data = JSON.parse(cleaned.slice(start, end + 1));
    } catch (e) {
      throw new Error('Error al parsear JSON de Gemini: ' + e.message);
    }

    // Asegurar que el IVA esté presente
    if (data.iva === undefined) data.iva = 0;

    return {
      data,
      needsHumanReview: Number(data.confidence || 0) < 0.85,
      humanReviewReason: 'Confianza OCR menor a 85%. Verificación Humana obligatoria.'
    };
  }

  function renderResult(result) {
    const data = result?.data || {};
    const review = result?.needsHumanReview;

    return `
      <div class="ocr-card">
        <p><strong>Tipo:</strong> ${esc(data.document_type || 'OTRO')}</p>
        <p><strong>Confianza:</strong> ${Math.round(Number(data.confidence || 0) * 100)}%</p>
        <p><strong>RFC emisor:</strong> ${esc(data.rfc_emisor || '—')}</p>
        <p><strong>RFC receptor:</strong> ${esc(data.rfc_receptor || '—')}</p>
        <p><strong>Subtotal:</strong> ${esc(data.subtotal ?? '—')}</p>
        <p><strong>IVA:</strong> ${esc(data.iva ?? '—')}</p>
        <p><strong>Total:</strong> ${esc(data.total ?? '—')}</p>
        <p><strong>Folio:</strong> ${esc(data.folio || '—')}</p>
        <p><strong>Fecha:</strong> ${esc(data.fecha || '—')}</p>
        <p><strong>Nota fiscal:</strong> ISR RESICO no deduce este gasto; el IVA requiere CFDI válido y gasto indispensable para acreditamiento.</p>
        ${review ? '<div class="auth-msg error">Verificación Humana requerida: confianza menor a 85%.</div>' : '<div class="auth-msg success">Documento procesado correctamente.</div>'}
      </div>
    `;
  }

  async function init() {
    const fileInput = document.getElementById('file-input');
    const btn = document.getElementById('ocr-process-btn');
    const output = document.getElementById('ocr-output');

    if (!fileInput || !btn || !output) return;

    btn.addEventListener('click', async () => {
      const file = fileInput.files?.[0];
      if (!file) {
        output.innerHTML = '<div class="auth-msg error">Selecciona un archivo primero.</div>';
        return;
      }

      btn.disabled = true;
      output.innerHTML = '<p class="ocr-placeholder">Extrayendo datos fiscales…</p>';

      try {
        const res = await processImage(file);
        output.innerHTML = renderResult(res);
        window.Store?.saveDocument?.({
          id: crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()),
          file_name: file.name,
          confidence: Number(res.data?.confidence || 0),
          document_type: res.data?.document_type || 'OTRO',
          extracted_data: res.data,
          safety_flag: !!res.needsHumanReview,
          created_at: new Date().toISOString()
        });
      } catch (err) {
        output.innerHTML = `<div class="auth-msg error">${esc(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  return {
    init,
    processImage
  };
})();

window.DocumentProcessor = DocumentProcessor;