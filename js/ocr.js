// ════════════════════════════════════════════════════════════
// js/ocr.js — OCR Multimodal v9.2 CERTIFICADO (piloto 5 contadores)
// FIX: fallback con diagnóstico visible · cero-estado explicado ·
//      bindeo robusto cámara/galería · log de payload para forense
// ════════════════════════════════════════════════════════════
const DocumentProcessor = (() => {
  let booted = false;
  const SAFETY_THRESHOLD = 0.85;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function compressImage(file, maxDim = 1600, quality = 0.8) {
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
        resolve(result.includes(',') ? result.split(',')[1] : result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  // ── CFDI 4.0 (Art. 29-A CFF) ─────────────────────────────────────────
  const REGIMEN_TOKENS = /\b(S\.?\s?A\.?(\s?DE\s?C\.?\s?V\.?)?|S\.?\s?DE\s?R\.?\s?L\.?|S\.?\s?C\.?|S\.?\s?N\.?\s?C\.?|A\.?\s?C\.?|UNIDAD\s?DE\s?INVERSIÓN)\b/i;
  const RESICO_USOS_OK = ['G01','G02','G03','D01','D02','D03','D04','D05','D06','D07','D08','D09','D10','S01','CP01','CN01'];
  function validateCFDI40(data, perfil) {
    const warnings = []; let hardFail = false;
    const razon = String(data.razon_social_receptor || data.nombre_receptor || '').toUpperCase();
    if (razon && REGIMEN_TOKENS.test(razon)) { warnings.push(`⚠️ CFDI 4.0: La Razón Social del receptor incluye régimen societario ("${razon}"). Debe coincidir EXACTO con la Constancia (sin "SA DE CV").`); hardFail = true; }
    const cp = String(data.cp_receptor || '').trim();
    if (perfil?.cp && cp && cp !== String(perfil.cp).trim()) { warnings.push(`⚠️ CFDI 4.0: El CP del receptor (${cp}) no coincide con tu domicilio fiscal (${perfil.cp}).`); hardFail = true; }
    const uso = String(data.uso_cfdi || '').toUpperCase();
    if (uso && !RESICO_USOS_OK.includes(uso)) { warnings.push(`⚠️ CFDI 4.0: Uso "${uso}" incompatible con régimen RESICO (626).`); hardFail = true; }
    return { ok: !hardFail, warnings };
  }
  function detectTicketType(extractedData, fileName = '') {
    const combined = `${extractedData?.rfc_emisor || ''} ${extractedData?.nombre_emisor || ''} ${fileName}`.toUpperCase();
    const isGasStation = /GASOLIN|PEMEX|OXXO GAS|SHELL|BP\b|MOBIL|G500|GNP GAS/.test(combined);
    const isOxxo = /OXXO(?!\s*GAS)/.test(combined);
    const isTicket = isGasStation || isOxxo || extractedData?.tipo_comprobante === 'TICKET';
    return { isTicket, isGasStation, isOxxo };
  }
  function buildFiscalNote(extractedData, fileName) {
    const { isTicket, isGasStation, isOxxo } = detectTicketType(extractedData, fileName);
    if (isTicket) {
      const origen = isGasStation ? 'gasolina' : isOxxo ? 'OXXO' : 'gasto general';
      return { applies: true, origen, mensaje: `📌 Nota RESICO: Este ticket de ${origen} — Para ISR no es deducible (RESICO tributa sobre ingresos brutos sin deducciones), pero para IVA es indispensable para tu acreditamiento conforme a la Ley del IVA. Conserva el CFDI con desglose de IVA, no solo el ticket físico.` };
    }
    return { applies: false, origen: null, mensaje: '' };
  }
  function computeSafetyFlag(confidence) {
    const conf = Number(confidence || 0);
    const normalizedConf = conf > 1 ? conf / 100 : conf;
    const needsReview = normalizedConf < SAFETY_THRESHOLD;
    return { safety_flag: needsReview, needs_review: needsReview, validation_status: needsReview ? 'Verificación Humana Requerida' : 'validado_ia', confidence_pct: Math.round(normalizedConf * 100) };
  }
  function showProcessingIndicator(show) {
    const indicator = document.getElementById('ocr-processing-indicator');
    const button = document.getElementById('ocr-analyze-btn');
    if (indicator) indicator.hidden = !show;
    if (button) { button.disabled = show; button.textContent = show ? 'Analizando...' : 'Analizar con IA'; }
  }
  function renderResult(payload) {
    const doc = payload?.document || {};
    const data = doc.extracted_data || {};
    const safety = computeSafetyFlag(doc.confidence);
    const fiscalNote = buildFiscalNote(data, doc.file_name);
    const reviewBadge = safety.needs_review
      ? `<span style="background:#f59e0b;color:#000;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;">⚠️ Verificación Humana Requerida (${safety.confidence_pct}% confianza)</span>`
      : `<span style="background:#10b981;color:#fff;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700;">✅ Validado IA (${safety.confidence_pct}% confianza)</span>`;
    const noteBlock = fiscalNote.applies
      ? `<div style="margin-top:10px;padding:10px;background:rgba(16,185,129,0.1);border-left:3px solid #10b981;border-radius:4px;font-size:13px;">${esc(fiscalNote.mensaje)}</div>`
      : '';
    // ✅ DENTRO de renderResult: `data` existe aquí (FIX ReferenceError)
    const fuelAlertBlock = (data.safety_flag_reason === 'gasolina_efectivo')
      ? `<div style="margin-top:10px;padding:12px;background:rgba(239,68,68,0.15);border-left:4px solid #ef4444;border-radius:4px;font-size:13px;color:#fecaca;font-weight:600;">🚨 ALERTA FISCAL: Gasolina pagada en EFECTIVO (Art. 27 Fracc. III LISR)<br><span style="font-weight:400;font-size:12px;color:#fca5a5;">Este gasto NO es deducible para ISR ni acreditable para IVA. El SAT lo invalida automáticamente en auditorías. Debe pagarse con tarjeta, transferencia o monedero electrónico.</span></div>`
      : '';
    return `
      <div style="border:1px solid #334155;border-radius:8px;padding:16px;">
        <div style="margin-bottom:10px;">${reviewBadge}</div>
        <table style="width:100%;font-size:13px;border-collapse:collapse;">
          <tr><td style="padding:4px 0;color:#94a3b8;">RFC Emisor:</td><td>${esc(data.rfc_emisor || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">RFC Receptor:</td><td>${esc(data.rfc_receptor || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">Fecha:</td><td>${esc(data.fecha || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">Folio:</td><td>${esc(data.folio || '—')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;">Subtotal:</td><td>$${Number(data.subtotal || 0).toLocaleString('es-MX')}</td></tr>
          ${data.descuento ? `<tr><td style="padding:4px 0;color:#f59e0b;">Descuento:</td><td style="color:#f59e0b;">-$${Number(data.descuento || 0).toLocaleString('es-MX')}</td></tr>` : ''}
          <tr><td style="padding:4px 0;color:#94a3b8;">IVA:</td><td>$${Number(data.iva || 0).toLocaleString('es-MX')}</td></tr>
          <tr><td style="padding:4px 0;color:#94a3b8;font-weight:700;">Total:</td><td style="font-weight:700;">$${Number(data.total || 0).toLocaleString('es-MX')}</td></tr>
        </table>
        ${noteBlock}
        ${fuelAlertBlock}
      </div>`;
  }
  // ── FIX v9.2: el fallback YA NO queda mudo ────────────────────────────
  function renderFallbackDiag(payload) {
    const tried = payload?.debug?.tried || payload?.debug?.providers || [];
    const first = Array.isArray(tried) ? tried[0] : null;
    const preview = first?.raw_preview ? ` · Gemini dijo: "${esc(String(first.raw_preview).slice(0, 120))}…"` : '';
    return `<div style="margin-top:8px;padding:10px;background:rgba(245,158,11,0.12);border-left:3px solid #f59e0b;border-radius:4px;font-size:12px;color:#fde68a;">
      🔎 La IA no pudo extraer datos: ${esc(payload?.reason || 'sin datos')} · engine ${esc(payload?.engine || '-')} · proveedores fallidos: ${esc(String(Array.isArray(tried) ? tried.length : 0))}${preview}
    </div>`;
  }
  async function analyzeFile(file) {
    const output = document.getElementById('ocr-result-output');
    if (!file) { if (output) output.innerHTML = '<p class="text-muted">Selecciona un archivo antes de analizar.</p>'; return; }
    showProcessingIndicator(true);
    if (output) output.innerHTML = '';
    if (window.APP_STATE?.isDemo) {
      await new Promise(r => setTimeout(r, 1200));
      const simulated = { document: { file_name: file.name, document_type: 'TICKET', confidence: 0.93, source: 'demo_simulado', extracted_data: { rfc_emisor: 'XAXX010101000', rfc_receptor: 'DEMO123456XXX', nombre_emisor: 'COMERCIAL DEMO SA', fecha: new Date().toISOString().slice(0, 10), folio: 'DEMO-0001', subtotal: 1000, iva: 160, total: 1160, tax_usefulness: 'IVA' } } };
      showProcessingIndicator(false);
      if (output) output.innerHTML = renderResult(simulated);
      window.Store?.saveDocument?.({ ...simulated.document, safety_flag: false, needs_review: false, validation_status: 'demo' });
      window.DocumentsManager?.renderDocuments?.();
      return;
    }
    try {
      const compact = await compressImage(file);
      const base64Data = await fileToBase64(compact);
      if (base64Data.length > 3500000) throw new Error('Imagen demasiado pesada. Toma la foto con mejor iluminación y sin zoom.');
      const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
      const token = session?.data?.session?.access_token;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (window.APP_STATE?.isDemo) headers['x-demo-mode'] = 'true';
      const response = await fetch('/api/document-ocr', {
        method: 'POST', headers,
        body: JSON.stringify({
          fileName: file.name,
          mimeType: compact.type || file.type || 'application/octet-stream',
          base64Data,
          extractionSchema: { rfc_emisor: 'string', rfc_receptor: 'string', razon_social_receptor: 'string', cp_receptor: 'string', uso_cfdi: 'string', metodo_pago: 'string', forma_pago: 'string', concepto: 'string', nombre_emisor: 'string', fecha: 'YYYY-MM-DD', folio: 'string', subtotal: 'number', descuento: 'number', iva: 'number', total: 'number', tipo_comprobante: 'CFDI | TICKET | EFIRMA | CONSTANCIA | OPINION | OTRO', tax_usefulness: 'ISR | IVA | AMBOS | NINGUNO', tipo_servicio: 'string' },
          instructions: 'Extrae datos fiscales con precisión 97%. CFDI 4.0: reporta razon_social_receptor SIN régimen societario. Reporta cp_receptor y uso_cfdi exactamente como aparecen. metodo_pago: "PUE"|"PPD". forma_pago: "01"=Efectivo,"03"=Transferencia,"04"=Tarjeta crédito,"28"=Tarjeta débito. Si es combustible indica concepto="COMBUSTIBLE". Regla Art. 27 Fracc. III LISR: gasolina en efectivo (forma_pago 01) NO es deducible ni acreditable.'
        })
      });
      const payload = await response.json().catch(() => ({}));
      console.info('[OCR] payload recibido:', payload); // forense piloto
      if (!response.ok || !payload?.document) throw new Error(payload?.error || `OCR HTTP ${response.status}`);
      showProcessingIndicator(false);
      const perfil = window.Store?.getPerfilFiscal?.() || {};
      const extractedData = payload.document.extracted_data || {};
      const cfdiCheck = validateCFDI40(extractedData, perfil);
      if (!cfdiCheck.ok) { payload.document.safety_flag = true; payload.document.needs_review = true; payload.document.validation_status = 'CFDI_4.0_invalido'; }
      const treatment = window.Store?.computeGastoTreatment?.(payload.document);
      if (treatment) { extractedData.gasto_acreditable = treatment.gasto_acreditable; extractedData.isr_deducible = treatment.isr_deducible; }
      if (output) output.innerHTML = renderResult(payload);
      if (output && payload.is_fallback) output.innerHTML += renderFallbackDiag(payload);
      const allNull = !extractedData.rfc_emisor && !extractedData.total && !extractedData.subtotal && !extractedData.iva;
      if (output && allNull && !payload.is_fallback) {
        output.innerHTML += `<div style="margin-top:8px;padding:10px;background:rgba(59,130,246,0.12);border-left:3px solid #3b82f6;border-radius:4px;font-size:12px;color:#bfdbfe;">📷 No se detectaron datos legibles. Toma la foto con buena luz, encuadra TODO el ticket y evita reflejos o sombras.</div>`;
      }
      if (output && cfdiCheck.warnings.length) {
        output.innerHTML += `<div style="margin-top:8px;padding:10px;background:rgba(239,68,68,0.12);border-left:3px solid #ef4444;border-radius:4px;font-size:13px;color:#fecaca;">${cfdiCheck.warnings.map(w => esc(w)).join('<br>')}</div>`;
      }
      if (output && treatment) {
        output.innerHTML += `<div style="margin-top:8px;padding:10px;background:${treatment.gasto_acreditable ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.12)'};border-left:3px solid ${treatment.gasto_acreditable ? '#10b981' : '#ef4444'};border-radius:4px;font-size:13px;color:${treatment.gasto_acreditable ? '#d1fae5' : '#fecaca'};">${esc(treatment.microcopy)} <span style="opacity:.7;">(${treatment.legal})</span></div>`;
      }
      const safety = computeSafetyFlag(payload.document.confidence);
      const fiscalNote = buildFiscalNote(extractedData, file.name);
      await window.Store?.saveDocument?.({
        ...payload.document,
        file_name: payload.document.file_name || file.name,
        document_type: payload.document.document_type || payload.document.doc_type || 'OTRO',
        extracted_data: { ...extractedData, fiscal_note: fiscalNote.applies ? fiscalNote.mensaje : null },
        confidence: Number(payload.document.confidence || 0),
        safety_flag: safety.safety_flag, validation_status: safety.validation_status, needs_review: safety.needs_review,
        source: payload.document.source || 'ocr_ai', created_at: new Date().toISOString()
      });
      window.DocumentsManager?.renderDocuments?.();
      window.App?.renderCarpetaFiscal?.();
    } catch (error) {
      showProcessingIndicator(false);
      console.error('[OCR] Error:', error);
      if (output) output.innerHTML = `<div style="color:#ef4444;padding:16px;border:1px solid #ef4444;border-radius:8px;background:rgba(239,68,68,0.1);"><div style="font-weight:700;">⚠️ ${esc(error.message)}</div></div>`;
    }
  }
  function bindInputPreview(inputId) {
    const input = document.getElementById(inputId);
    if (!input || input.dataset.boundOcrPreview) return;
    input.dataset.boundOcrPreview = '1';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      const preview = document.getElementById('ocr-file-preview');
      const nameEl = document.getElementById('ocr-file-name');
      if (file && preview && nameEl) { nameEl.textContent = file.name; preview.hidden = false; }
      window.__ocrSelectedFile = file || null;
    });
  }
  // ── FIX v9.2: bindea CUALQUIER input de archivo del módulo OCR ────────
  function bindAllInputs() {
    document.querySelectorAll('input[type="file"]').forEach(inp => {
      if ((inp.id || '').startsWith('ocr-file')) bindInputPreview(inp.id);
    });
  }
  function boot() {
    if (booted) return;
    booted = true;
    bindAllInputs();
    document.getElementById('ocr-analyze-btn')?.addEventListener('click', () => { analyzeFile(window.__ocrSelectedFile); });
    console.info('[OCR] DocumentProcessor v9.2 activo');
  }
  return { boot, analyzeFile, computeSafetyFlag, buildFiscalNote, validateCFDI40 };
})();
window.DocumentProcessor = DocumentProcessor;
document.addEventListener('DOMContentLoaded', () => window.DocumentProcessor.boot());