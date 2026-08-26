const DocumentProcessor = (() => {
  let booted = false;
  const SAFETY_THRESHOLD = 0.85; // 85% — Umbral Safety Flag (DOC02 TRD)

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // ── FIX 413: compresión client-side para fotos de cámara ────────────────
// Vercel rechaza bodies > ~4.5MB (HTTP 413). Reducimos a máx. 1280px / JPEG 0.8
// (~200–400 KB) sin perder legibilidad de RFC/montos para Gemini Vision.
function compressImage(file, maxDim = 1920, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file || !file.type?.startsWith('image/')) { resolve(file); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1 && file.size < 900 * 1024) { resolve(file); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        if (!blob) { resolve(file); return; }
        resolve(new File([blob], (file.name || 'documento').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Detección de tipo de documento (ticket de gasto vs CFDI vs otro) ─────
  function detectTicketType(extractedData, fileName = '') {
    const emisor = String(extractedData?.rfc_emisor || '').toUpperCase();
    const nombreComercial = String(extractedData?.nombre_emisor || '').toUpperCase();
    const combined = `${emisor} ${nombreComercial} ${fileName}`.toUpperCase();

    const isGasStation = /GASOLIN|PEMEX|OXXO GAS|SHELL|BP\b|MOBIL|G500|GNP GAS/.test(combined);
    const isOxxo = /OXXO(?!\s*GAS)/.test(combined);
    const isTicket = isGasStation || isOxxo || extractedData?.tipo_comprobante === 'TICKET';

    return { isTicket, isGasStation, isOxxo };
  }

  // ── Nota pedagógica RESICO: ISR no deducible, IVA sí acreditable ─────────
  function buildFiscalNote(extractedData, fileName) {
    const { isTicket, isGasStation, isOxxo } = detectTicketType(extractedData, fileName);

    if (isTicket) {
      const origen = isGasStation ? 'gasolina' : isOxxo ? 'OXXO' : 'gasto general';
      return {
        applies: true,
        origen,
        mensaje:
          `📌 Nota RESICO: Este ticket de ${origen} — ` +
          `Para ISR no es deducible (RESICO tributa sobre ingresos brutos sin deducciones), ` +
          `pero para IVA es indispensable para tu acreditamiento conforme a la Ley del IVA. ` +
          `Conserva el CFDI con desglose de IVA, no solo el ticket físico.`
      };
    }
    return { applies: false, origen: null, mensaje: '' };
  }

  // ── Safety Flag: Verificación Humana si confianza < 85% ──────────────────
  function computeSafetyFlag(confidence) {
    const conf = Number(confidence || 0);
    const normalizedConf = conf > 1 ? conf / 100 : conf; // soporta 0-1 o 0-100
    const needsReview = normalizedConf < SAFETY_THRESHOLD;

    return {
      safety_flag: needsReview,
      needs_review: needsReview,
      validation_status: needsReview ? 'Verificación Humana Requerida' : 'validado_ia',
      confidence_pct: Math.round(normalizedConf * 100)
    };
  }

  // ── Indicador visual de procesamiento IA ──────────────────────────────────
  function showProcessingIndicator(show) {
    const indicator = document.getElementById('ocr-processing-indicator');
    const button = document.getElementById('ocr-analyze-btn');
    if (indicator) indicator.hidden = !show;
    if (button) {
      button.disabled = show;
      button.textContent = show ? 'Analizando...' : 'Analizar con IA';
    }
  }

  function renderResult(payload) {
    const doc = payload?.document || {};
    const data = doc.extracted_data || {};
    const safety = computeSafetyFlag(doc.confidence);
    const fiscalNote = buildFiscalNote(data, doc.file_name);

    const reviewBadge = safety.needs_review
      ? `<span style="background:#f59e0b;color:#000;padding:3px 10px;border-radius:6px;
                       font-size:12px;font-weight:700;">
           ⚠️ Verificación Humana Requerida (${safety.confidence_pct}% confianza)
         </span>`
      : `<span style="background:#10b981;color:#fff;padding:3px 10px;border-radius:6px;
                       font-size:12px;font-weight:700;">
           ✅ Validado IA (${safety.confidence_pct}% confianza)
         </span>`;
  
    const noteBlock = fiscalNote.applies
      ? `<div style="margin-top:10px;padding:10px;background:rgba(16,185,129,0.1);
                     border-left:3px solid #10b981;border-radius:4px;font-size:13px;">
           ${esc(fiscalNote.mensaje)}
         </div>`
      : '';

    return `
      <div style="border:1px solid #334155;border-radius:8px;padding:16px;">
        <div style="margin-bottom:10px;">${reviewBadge}</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <tr><td style="padding:4px 0;color:#94a3b8;">RFC Emisor:</td><td>${esc(data.rfc_emisor || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">RFC Receptor:</td><td>${esc(data.rfc_receptor || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">Fecha:</td><td>${esc(data.fecha || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">Folio/Autorización:</td><td>${esc(data.folio || data.autorizacion || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">Subtotal:</td><td>$${Number(data.subtotal || 0).toLocaleString('es-MX')}</td></tr>
          ${data.descuento ? `<tr><td style="padding:4px 0;color:#f59e0b;">Descuento:</td><td style="color:#f59e0b;">-$${Number(data.descuento || 0).toLocaleString('es-MX')}</td></tr>` : ''}
          <tr><td style="padding:4px 0;color:#94a3b8;font-weight:700;">Total:</td><td style="font-weight:700;">$${Number(data.total || 0).toLocaleString('es-MX')}</td></tr>
        </table>
        ${noteBlock}
      </div>
    `;
  }

  async function analyzeFile(file) {
    const output = document.getElementById('ocr-result-output');
    if (!file) {
      if (output) output.innerHTML = '<p class="text-muted">Selecciona un archivo antes de analizar.</p>';
      return;
    }

    showProcessingIndicator(true);
 if (output) output.innerHTML = '';
 
     try {
      const compact = await compressImage(file); // FIX 413
      const base64Data = await fileToBase64(compact);
      if (base64Data.length > 3500000) {
        throw new Error('Imagen demasiado pesada incluso comprimida. Toma la foto con mejor iluminación y sin zoom.');
      }
      const session = await window.APP_STATE?.supabase?.auth?.getSession?.();

      const token = session?.data?.session?.access_token;

      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (window.APP_STATE?.isDemo) headers['x-demo-mode'] = 'true'; // demo usa OCR REAL sin JWT

      const response = await fetch('/api/document-ocr', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: compact.type || file.type || 'application/octet-stream',
          base64Data,
          // Prompt estructurado — extracción con precisión objetivo 97%
          extractionSchema: {
            rfc_emisor: 'string',
            rfc_receptor: 'string',
            nombre_emisor: 'string',
            fecha: 'YYYY-MM-DD',
            folio: 'string',
            autorizacion: 'string',
            subtotal: 'number',
            iva: 'number',
            total: 'number',
            tipo_comprobante: 'CFDI | TICKET | EFIRMA | CONSTANCIA | OPINION | OTRO',
            tax_usefulness: 'ISR | IVA | AMBOS | NINGUNO'
          },
          instructions:
            'Extrae los datos fiscales del documento con precisión del 97%. ' +
            'Identifica si es un ticket de gasto (OXXO, gasolinera) para marcar tax_usefulness=IVA. ' +
            'Si es un CFDI de ingreso propio, marca tax_usefulness=ISR. ' +
            'Si detectas archivo .cer o .key de e.firma, marca tipo_comprobante=EFIRMA y ' +
            'busca fecha_emision para calcular vigencia de 4 años (Art. 17-D CFF).'
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.document) {
        throw new Error(payload?.error || `OCR HTTP ${response.status}`);
      }

       showProcessingIndicator(false); // FIX: destrabar botón en ruta de éxito
        const safety = computeSafetyFlag(payload.document.confidence);
   if (output) output.innerHTML = renderResult(payload);
   if (payload.is_fallback && output) {
     const tried = payload.debug?.tried?.[0];
     output.innerHTML += `<div style="margin-top:8px;font-size:12px;color:#f59e0b;">
       🔎 Diagnóstico: ${esc(payload.reason || 'sin datos')} · engine ${esc(payload.engine || '-')}
       ${tried?.raw_preview ? ` · Gemini dijo: "${esc(String(tried.raw_preview).slice(0, 120))}…"` : ''}
     </div>`;
   }

      // Enriquecer el documento antes de guardarlo
      const extractedData = payload.document.extracted_data || {};
      const fiscalNote = buildFiscalNote(extractedData, file.name);

      await window.Store?.saveDocument?.({
        ...payload.document,
        file_name: payload.document.file_name || file.name,
        document_type: payload.document.document_type || payload.document.doc_type || 'OTRO',
        extracted_data: {
          ...extractedData,
          fiscal_note: fiscalNote.applies ? fiscalNote.mensaje : null
        },
        confidence: Number(payload.document.confidence || 0),
        safety_flag: safety.safety_flag,
        validation_status: safety.validation_status,
        needs_review: safety.needs_review,
        source: payload.document.source || 'ocr_ai',
        created_at: new Date().toISOString()
      });

      window.DocumentsManager?.renderDocuments?.();
      window.App?.renderCarpetaFiscal?.(); // refrescar carpeta fiscal si está montada

      } catch (error) {
    showProcessingIndicator(false);
    console.error('[OCR] Error:', error);
    
    let errorMessage = 'Error al procesar el documento';
    if (error.message.includes('401')) {
      errorMessage = 'Error de autenticación. Inicia sesión para usar el OCR.';
    } else if (error.message.includes('500')) {
      errorMessage = 'Error del servidor. Intenta de nuevo en unos minutos.';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'El procesamiento tardó demasiado. Intenta con una imagen más pequeña.';
    }
    
    if (output) {
      output.innerHTML = `
        <div style="color:#ef4444;padding:16px;border:1px solid #ef4444;border-radius:8px;background:rgba(239,68,68,0.1);">
          <div style="font-weight:700;margin-bottom:8px;">⚠️ ${errorMessage}</div>
          <div style="font-size:13px;color:#fca5a5;">
            ${error?.message || 'Error desconocido'}
          </div>
          <button onclick="document.getElementById('ocr-result-output').innerHTML=''" 
                  style="margin-top:12px;padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;">
            Cerrar
          </button>
        </div>
      `;
    }
  }
  }

  function bindInputPreview(inputId) {
    const input = document.getElementById(inputId);
    input?.addEventListener('change', () => {
      const file = input.files?.[0];
      const preview = document.getElementById('ocr-file-preview');
      const nameEl = document.getElementById('ocr-file-name');
      if (file && preview && nameEl) {
        nameEl.textContent = file.name;
        preview.hidden = false;
      }
      window.__ocrSelectedFile = file || null;
    });
  }

  function boot() {
    if (booted) return;
    booted = true;

    bindInputPreview('ocr-file-input');
    bindInputPreview('ocr-file-input-gallery');

    document.getElementById('ocr-analyze-btn')?.addEventListener('click', () => {
      analyzeFile(window.__ocrSelectedFile);
    });
  }

  return { boot, analyzeFile, computeSafetyFlag, buildFiscalNote };
})();

window.DocumentProcessor = DocumentProcessor;
document.addEventListener('DOMContentLoaded', () => window.DocumentProcessor.boot());