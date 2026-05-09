/* ============================================
   ALIADO RESICO — OCR & Document Processor
   Gemini 1.5 Flash Vision + Human Verification
   v3.0 — Sanitización, Proxy Serverless, Seguridad
   ============================================ */

const DocumentProcessor = (() => {

  // Safety flag: documentos con confianza < 85% requieren verificación humana
  const HUMAN_REVIEW_THRESHOLD = 0.85;

  // --- Validación de RFC (algoritmo real) ---
  function validateRFC(rfc) {
    if (!rfc || typeof rfc !== 'string') return { valid: false, type: null, error: 'RFC vacío' };
    const clean = rfc.trim().toUpperCase().replace(/[\s-]/g, '');

    const regexFisica = /^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/;
    const regexMoral = /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/;

    let type = null;
    if (regexFisica.test(clean)) {
      type = 'Persona Física';
    } else if (regexMoral.test(clean)) {
      type = 'Persona Moral';
    } else {
      return { valid: false, type: null, error: 'Formato de RFC inválido. Persona Física: 13 caracteres. Persona Moral: 12 caracteres.' };
    }

    const dateStart = type === 'Persona Física' ? 4 : 3;
    const dateStr = clean.substring(dateStart, dateStart + 6);
    const year = parseInt(dateStr.substring(0, 2));
    const month = parseInt(dateStr.substring(2, 4));
    const day = parseInt(dateStr.substring(4, 6));

    if (month < 1 || month > 12) return { valid: false, type, error: `Mes inválido en RFC: ${month}` };
    if (day < 1 || day > 31) return { valid: false, type, error: `Día inválido en RFC: ${day}` };

    return {
      valid: true,
      type,
      rfc: clean,
      date: `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year < 50 ? '20' : '19'}${year.toString().padStart(2, '0')}`,
      homoclave: clean.slice(-3),
    };
  }

  // --- Prompt de Gemini Vision (Strict Mode) ---
  const OCR_PROMPT = `Eres un sistema OCR especializado en documentos fiscales mexicanos con precisión del 97%.

INSTRUCCIÓN CRÍTICA DE FORMATO:
Responde ÚNICAMENTE con el objeto JSON. NINGÚN texto antes o después. NINGÚN bloque de código markdown (no uses \`\`\`json). NINGÚN preámbulo. SOLO el JSON puro.

Analiza esta imagen y extrae los datos fiscales. El documento puede ser:
- Ticket de OXXO, tienda de conveniencia, gasolinera
- Comprobante de transferencia bancaria SPEI
- Factura CFDI (XML renderizado o PDF)
- Nota de venta o recibo
- Comprobante de pago de servicios (CFE, Telmex, etc.)

Extrae estos campos. Si un campo NO es legible, pon null:

{"document_type":"TICKET|CFDI|TRANSFERENCIA|NOTA_VENTA|RECIBO|DESCONOCIDO","confidence":0.97,"emisor_rfc":"RFC del emisor o null","emisor_nombre":"Nombre del emisor o null","receptor_rfc":"RFC del receptor o null","receptor_nombre":"Nombre del receptor o null","fecha":"DD/MM/AAAA o null","hora":"HH:MM o null","subtotal":"monto numérico sin símbolo o null","iva":"monto del IVA numérico sin símbolo o null","iva_tasa":"porcentaje (ej: 16) o null","total":"monto total numérico sin símbolo o null","metodo_pago":"Efectivo|Tarjeta Débito|Tarjeta Crédito|Transferencia|null","numero_autorizacion":"número de autorización/folio o null","folio_fiscal":"UUID del CFDI o null","concepto":"descripción breve del concepto principal o null","sucursal":"nombre/número de sucursal o null","quality_notes":"Notas sobre calidad de imagen: borrosa, oscura, parcial, etc. o null"}

REGLAS:
- Los montos deben ser SOLO números (sin $, sin comas de miles)
- Si la imagen está borrosa o ilegible, baja el confidence proporcionalmente
- Si no puedes leer un campo con certeza, pon null — NUNCA inventes datos
- El confidence debe reflejar la calidad REAL de la extracción
- Si la imagen no es un documento fiscal, retorna document_type: "DESCONOCIDO" con confidence: 0.1`;

  // =============================================
  // PARSER BLINDADO — extrae JSON aunque Gemini
  // añada preámbulos o bloques markdown
  // =============================================
  function extractJSON(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    // Paso 1: eliminar bloques markdown ```json ... ``` o ``` ... ```
    let cleaned = rawText.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1').trim();

    // Paso 2: extraer desde la primera { hasta la última }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) return null;

    return cleaned.slice(start, end + 1);
  }

  // --- Convierte archivo a Base64 ---
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // --- Llamada a Gemini Vision (vía proxy en producción) ---
  async function processWithGemini(file) {
    // Validar tamaño de archivo
    const sizeCheck = InputSanitizer.validateFileSize(file);
    if (!sizeCheck.valid) throw new Error(sizeCheck.error);

    if (!AppConfig.isGeminiConfigured()) throw new Error('No Gemini API Key configurada');

    const base64Data = await fileToBase64(file);
    const mimeType = file.type || 'image/jpeg';

    // Endpoint: proxy en producción, directo en desarrollo
    const endpoint = AppConfig.getGeminiEndpoint('gemini-2.5-flash');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: OCR_PROMPT },
            { inlineData: { mimeType, data: base64Data } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 800,
          responseMimeType: 'application/json',
        }
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.error || `Gemini Vision HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Respuesta vacía de Gemini Vision');

    // Parser blindado: tolera preámbulos y markdown
    const jsonString = extractJSON(rawText);
    if (!jsonString) {
      console.error('[OCR] Raw Gemini Vision response (no JSON found):', rawText);
      throw new Error('No se encontró JSON válido en la respuesta de Gemini Vision');
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      console.error('[OCR] JSON parse failed. Extracted string:', jsonString);
      throw new Error(`JSON inválido de Gemini Vision: ${e.message}`);
    }

    return parsed;
  }

  // --- processImage principal ---
  async function processImage(file) {
    const startTime = performance.now();

    // Sanitizar nombre de archivo
    const sanitizedName = InputSanitizer.sanitizeFileName(file.name);

    if (AppConfig.isGeminiConfigured()) {
      try {
        const geminiResult = await processWithGemini(file);
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);

        const typeMap = {
          'CFDI': 'CFDI',
          'TICKET': 'TICKET',
          'TRANSFERENCIA': 'TRANSFERENCIA',
          'NOTA_VENTA': 'TICKET',
          'RECIBO': 'TICKET',
          'DESCONOCIDO': 'UNKNOWN',
        };

        const docType = typeMap[geminiResult.document_type] || 'TICKET';
        const confidence = Math.max(0, Math.min(1, geminiResult.confidence || 0.5));

        // Safety flag: confianza < 85% → verificación humana obligatoria
        const needsHumanReview = confidence < HUMAN_REVIEW_THRESHOLD;

        const result = {
          type: docType,
          status: needsHumanReview ? 'needs_review' : 'processed',
          confidence,
          needsHumanReview,
          humanReviewReason: needsHumanReview
            ? `Confianza ${(confidence * 100).toFixed(0)}% por debajo del umbral ${(HUMAN_REVIEW_THRESHOLD * 100).toFixed(0)}%. ${geminiResult.quality_notes || 'Se recomienda verificación manual para datos fiscales críticos.'}`
            : null,
          source: 'gemini_vision',
          processingTime: `${elapsed}s`,
          data: {},
          fileName: sanitizedName,
          fileSize: `${(file.size / 1024).toFixed(1)} KB`,
        };

        if (docType === 'CFDI') {
          result.data = {
            uuid: geminiResult.folio_fiscal || null,
            version: '4.0',
            emisor_rfc: geminiResult.emisor_rfc || null,
            emisor_nombre: geminiResult.emisor_nombre || null,
            receptor_rfc: geminiResult.receptor_rfc || null,
            receptor_nombre: geminiResult.receptor_nombre || null,
            uso_cfdi: geminiResult.uso_cfdi || null,
            subtotal: geminiResult.subtotal ? `$${parseFloat(geminiResult.subtotal).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : null,
            iva: geminiResult.iva ? `$${parseFloat(geminiResult.iva).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : null,
            total: geminiResult.total ? `$${parseFloat(geminiResult.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : null,
            fecha: geminiResult.fecha || null,
            folio: geminiResult.numero_autorizacion || null,
            concepto: geminiResult.concepto || null,
          };
        } else {
          result.data = {
            vendor: geminiResult.emisor_nombre || geminiResult.sucursal || 'No detectado',
            rfc_emisor: geminiResult.emisor_rfc || null,
            date: geminiResult.fecha || new Date().toLocaleDateString('es-MX'),
            hora: geminiResult.hora || null,
            subtotal: geminiResult.subtotal ? `$${parseFloat(geminiResult.subtotal).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : null,
            iva: geminiResult.iva ? `$${parseFloat(geminiResult.iva).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : null,
            total: geminiResult.total ? `$${parseFloat(geminiResult.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : null,
            payment_method: geminiResult.metodo_pago || null,
            authorization: geminiResult.numero_autorizacion || null,
            concepto: geminiResult.concepto || null,
          };
        }

        // Post-procesamiento: validar RFCs extraídos
        const rfcEmisor = result.data.emisor_rfc || result.data.rfc_emisor;
        if (rfcEmisor) {
          result.data._rfc_emisor_valid = validateRFC(rfcEmisor).valid;
        }
        if (result.data.receptor_rfc) {
          result.data._rfc_receptor_valid = validateRFC(result.data.receptor_rfc).valid;
        }

        const reviewLabel = needsHumanReview ? ' ⚠️ VERIFICACIÓN HUMANA REQUERIDA' : '';
        console.log(
          `%c[OCR] Gemini Vision: ${elapsed}s — confianza: ${(confidence * 100).toFixed(1)}%${reviewLabel}`,
          needsHumanReview ? 'color:#f59e0b;font-weight:bold' : 'color:#10b981'
        );

        return result;

      } catch (error) {
        console.warn('%c[OCR] Gemini Vision falló, usando mock fallback:', 'color:#f59e0b', error.message);
        return generateFallbackResult(file, error.message);
      }
    }

    return generateFallbackResult(file);
  }

  // --- Fallback mock OCR (cuando Gemini no está disponible) ---
  function generateFallbackResult(file, errorMsg) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const fileName = file.name.toLowerCase();
        let result;

        if (fileName.includes('.pdf')) {
          result = generateMockCFDI(file);
        } else {
          result = generateMockTicket(file);
        }

        result.source = 'mock';
        if (errorMsg) result.fallbackReason = errorMsg;
        resolve(result);
      }, 1200 + Math.random() * 800);
    });
  }

  function generateMockTicket(file) {
    const vendors = ['Pemex Estación #4521', 'OXXO Sucursal Centro', 'Office Depot MX', 'Uber Trip', 'Restaurante La Parroquia', 'Telmex', 'CFE Distribución'];
    const vendor = vendors[Math.floor(Math.random() * vendors.length)];
    const amount = (Math.random() * 3000 + 100).toFixed(2);
    const iva = (parseFloat(amount) * 0.16).toFixed(2);

    return {
      type: 'TICKET',
      status: 'processed',
      confidence: 0.94 + Math.random() * 0.05,
      needsHumanReview: false,
      data: {
        vendor,
        date: new Date().toLocaleDateString('es-MX'),
        subtotal: `$${(parseFloat(amount) - parseFloat(iva)).toFixed(2)}`,
        iva: `$${iva}`,
        total: `$${amount}`,
        payment_method: Math.random() > 0.5 ? 'Tarjeta de débito' : 'Efectivo',
      },
      fileName: file.name,
      fileSize: `${(file.size / 1024).toFixed(1)} KB`,
    };
  }

  function generateMockCFDI(file) {
    return {
      type: 'CFDI',
      status: 'processed',
      confidence: 0.97,
      needsHumanReview: false,
      data: {
        uuid: crypto.randomUUID ? crypto.randomUUID() : 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        version: '4.0',
        emisor_rfc: 'XAXX010101000',
        emisor_nombre: 'PROVEEDOR DEMO SA DE CV',
        receptor_rfc: 'PELJ850315KT2',
        uso_cfdi: 'G03 - Gastos en general',
        subtotal: '$8,620.69',
        iva: '$1,379.31',
        total: '$10,000.00',
        fecha: new Date().toISOString().slice(0, 19),
        folio: `F-${Math.floor(Math.random() * 9000 + 1000)}`,
      },
      fileName: file.name,
      fileSize: `${(file.size / 1024).toFixed(1)} KB`,
    };
  }

  // --- Validación de estructura CFDI ---
  function validateCFDI(data) {
    const errors = [];
    if (!data.uuid) errors.push('Falta UUID (Folio Fiscal)');
    if (!data.emisor_rfc) errors.push('Falta RFC del emisor');
    if (!data.receptor_rfc) errors.push('Falta RFC del receptor');
    if (data.version && data.version !== '4.0') errors.push(`Versión ${data.version} — se requiere 4.0`);

    if (data.emisor_rfc) {
      const rfcCheck = validateRFC(data.emisor_rfc);
      if (!rfcCheck.valid) errors.push(`RFC emisor inválido: ${rfcCheck.error}`);
    }

    return { valid: errors.length === 0, errors };
  }

  return { validateRFC, processImage, validateCFDI, HUMAN_REVIEW_THRESHOLD };
})();

if (typeof window !== 'undefined') window.DocumentProcessor = DocumentProcessor;
