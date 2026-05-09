/* ============================================
   ALIADO RESICO — Intent Classifier Engine
   Gemini 1.5 Flash + Local Fallback
   v3.0 — Sanitización, Proxy Serverless
   ============================================ */

const IntentClassifier = (() => {

  const classificationCache = new Map();
  const CACHE_MAX = 100;
  const CACHE_TTL = 5 * 60 * 1000;

  const SLANG_MAP = {
    'la chiva': 'el sat', 'el chivo': 'el sat', 'el chiva': 'el sat',
    'hacienda': 'el sat', 'el fisco': 'el sat',
    'timbrar': 'emitir cfdi', 'sellar': 'emitir cfdi', 'facturar': 'emitir cfdi',
    'recibito': 'ticket', 'notita': 'nota de venta',
    'deposité': 'transferencia', 'le deposité': 'transferencia',
    'le pagué': 'pago', 'ya pagué': 'pago', 'me cobran': 'saldo',
    'jalar': 'trabajar', 'chambear': 'trabajar',
    'lana': 'dinero', 'varo': 'dinero', 'baro': 'dinero', 'fierro': 'dinero',
  };

  const SYSTEM_PROMPT = `Eres un clasificador fiscal mexicano EXPERTO en RESICO. Clasifica mensajes de contribuyentes mexicanos.

FORMATO: Responde ÚNICAMENTE con JSON puro. Sin texto extra, sin markdown.

AUDITORÍA DE SALUD FISCAL: Si el usuario indica que no tiene e.firma vigente o Buzón Tributario activo, emite alerta en "salud_fiscal_alerta".

CATEGORÍAS (elige UNA):
1. CONSULTA_FISCAL — Preguntas sobre impuestos, régimen, tasas, obligaciones, SAT, declaraciones, e.firma, buzón tributario
2. SOLICITUD_FACTURA — Emitir, cancelar o modificar facturas CFDI 4.0, complementos de pago
3. REGISTRO_GASTO — Registro de gastos, tickets, recibos para acreditamiento de IVA
4. REPORTE_PAGO — Reportes de pagos, transferencias, depósitos, comprobantes bancarios
5. SALUD_FISCAL — Respuestas sobre Buzón Tributario o e.firma
6. OTROS — Saludos, despedidas, preguntas generales

CONTEXTO RESICO:
- ISR: Sobre INGRESOS BRUTOS facturados (1%-2.5%). NO hay deducciones para ISR.
- IVA: SÍ permite acreditamiento. Gestión de gastos es INDISPENSABLE.
- Límite anual: $3,500,000 MXN.

JERGA: "la chiva"/"el chivo" = SAT; "timbrar"/"sellar" = facturar; "lana"/"varo" = dinero; "chambear" = trabajar

CONFIANZA: Claro >= 0.90 | Slang 0.80-0.90 | Ambiguo 0.60-0.80 | Vago 0.40-0.60

Responde SOLO: {"intent":"CATEGORIA","confidence":0.95,"keywords_detected":["palabra1"],"explanation":"Razón","resico_context":"Nota o null","salud_fiscal_alerta":"Alerta o null"}`;

  function extractJSON(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    let cleaned = rawText.replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return cleaned.slice(start, end + 1);
  }

  async function classifyWithGemini(message) {
    // Sanitizar input antes de enviar a IA
    const sanitizedMessage = InputSanitizer.sanitizeForAI(message);
    if (!sanitizedMessage) throw new Error('Mensaje vacío después de sanitización');
    if (!AppConfig.isGeminiConfigured()) throw new Error('No Gemini API Key configurada');

    // Endpoint: proxy en producción, directo en desarrollo
    const endpoint = AppConfig.getGeminiEndpoint('gemini-2.5-flash');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: `Clasifica este mensaje:\n\n"${sanitizedMessage}"` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400, responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.error || `Gemini HTTP ${response.status}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate || candidate.finishReason === 'SAFETY') {
      throw new Error(`Gemini bloqueó la respuesta (motivo: ${candidate?.finishReason || 'UNKNOWN'})`);
    }

    const rawText = candidate.content?.parts?.[0]?.text;
    if (!rawText || typeof rawText !== 'string') throw new Error('Respuesta de Gemini vacía');

    const jsonString = extractJSON(rawText);
    if (!jsonString) {
      console.error('[Classifier] Raw Gemini response (no JSON found):', rawText);
      throw new Error('No se encontró JSON válido en la respuesta de Gemini');
    }

    let parsed;
    try { parsed = JSON.parse(jsonString); }
    catch (e) { throw new Error(`JSON inválido de Gemini: ${e.message}`); }

    const validIntents = ['CONSULTA_FISCAL', 'SOLICITUD_FACTURA', 'REGISTRO_GASTO', 'REPORTE_PAGO', 'SALUD_FISCAL', 'OTROS'];
    if (!validIntents.includes(parsed.intent)) parsed.intent = 'OTROS';

    return {
      intent: parsed.intent,
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      keywords_matched: parsed.keywords_detected || [],
      explanation: parsed.explanation || '',
      resico_context: parsed.resico_context || null,
      salud_fiscal_alerta: parsed.salud_fiscal_alerta || null,
      source: 'gemini',
    };
  }

  // =============================================
  // LOCAL CLASSIFIER — keyword fallback
  // =============================================
  const INTENT_KEYWORDS = {
    CONSULTA_FISCAL: [
      { word: 'resico', weight: 1.0 }, { word: 'régimen simplificado', weight: 1.0 },
      { word: 'régimen de confianza', weight: 1.0 }, { word: 'isr', weight: 0.9 },
      { word: 'impuesto sobre la renta', weight: 0.9 }, { word: 'tasa', weight: 0.6 },
      { word: 'límite de ingresos', weight: 1.0 }, { word: 'límite', weight: 0.4 },
      { word: 'el sat', weight: 0.8 }, { word: 'declaración', weight: 0.8 },
      { word: 'declarar', weight: 0.8 }, { word: 'anual', weight: 0.4 },
      { word: 'persona física', weight: 0.7 }, { word: 'actividad empresarial', weight: 0.7 },
      { word: 'darme de alta', weight: 0.7 }, { word: 'obligaciones', weight: 0.6 },
      { word: 'constancia', weight: 0.5 }, { word: 'e.firma', weight: 0.7 },
      { word: 'efirma', weight: 0.7 }, { word: 'carta invitación', weight: 0.8 },
      { word: 'buzón tributario', weight: 0.9 }, { word: 'buzón', weight: 0.5 },
      { word: 'régimen', weight: 0.5 }, { word: 'contribuyente', weight: 0.5 },
      { word: 'expulsar', weight: 0.6 }, { word: 'cuánto pago', weight: 0.7 },
      { word: 'cuánto me toca', weight: 0.7 }, { word: 'deducir', weight: 0.3 },
      { word: 'se puede deducir', weight: 0.5 },
    ],
    SOLICITUD_FACTURA: [
      { word: 'factura', weight: 0.9 }, { word: 'cfdi', weight: 1.0 },
      { word: 'cfdi 4.0', weight: 1.0 }, { word: 'emitir cfdi', weight: 1.0 },
      { word: 'emitir factura', weight: 1.0 }, { word: 'folio', weight: 0.6 },
      { word: 'timbrar', weight: 1.0 }, { word: 'cancelar factura', weight: 1.0 },
      { word: 'nota de crédito', weight: 0.9 }, { word: 'complemento de pago', weight: 1.0 },
      { word: 'rfc', weight: 0.5 }, { word: 'sellar', weight: 0.8 },
      { word: 'necesito factura', weight: 1.0 }, { word: 'me da su factura', weight: 1.0 },
      { word: 'facturación', weight: 0.9 },
    ],
    REGISTRO_GASTO: [
      { word: 'gasto', weight: 0.9 }, { word: 'ticket', weight: 0.9 },
      { word: 'recibo', weight: 0.7 }, { word: 'nota de consumo', weight: 0.8 },
      { word: 'deducción', weight: 0.7 }, { word: 'iva', weight: 0.6 },
      { word: 'acreditamiento', weight: 0.8 }, { word: 'compra', weight: 0.5 },
      { word: 'compré', weight: 0.7 }, { word: 'gasté', weight: 0.8 },
      { word: 'gasolina', weight: 0.6 }, { word: 'pemex', weight: 0.6 },
      { word: 'uber', weight: 0.5 }, { word: 'papelería', weight: 0.5 },
      { word: 'oficina', weight: 0.3 }, { word: 'luz', weight: 0.4 },
      { word: 'internet', weight: 0.4 }, { word: 'telmex', weight: 0.5 },
      { word: 'foto del ticket', weight: 0.9 }, { word: 'adjunto', weight: 0.4 },
    ],
    REPORTE_PAGO: [
      { word: 'pago', weight: 0.7 }, { word: 'transferencia', weight: 0.9 },
      { word: 'spei', weight: 1.0 }, { word: 'oxxo', weight: 0.9 },
      { word: 'depósito', weight: 0.8 }, { word: 'deposité', weight: 0.9 },
      { word: 'comprobante', weight: 0.8 }, { word: 'ficha', weight: 0.7 },
      { word: 'referencia', weight: 0.6 }, { word: 'liquidar', weight: 0.8 },
      { word: 'saldo pendiente', weight: 0.9 }, { word: 'mensualidad', weight: 0.7 },
      { word: 'abono', weight: 0.7 }, { word: 'cep', weight: 0.8 },
      { word: 'clabe', weight: 0.7 }, { word: 'te mando captura', weight: 0.8 },
      { word: 'ya pagué', weight: 0.8 },
    ],
    OTROS: [
      { word: 'hola', weight: 0.9 }, { word: 'buenos días', weight: 0.9 },
      { word: 'buenas tardes', weight: 0.9 }, { word: 'buenas noches', weight: 0.9 },
      { word: 'gracias', weight: 0.8 }, { word: 'adiós', weight: 0.8 },
      { word: 'bye', weight: 0.8 }, { word: 'a qué hora', weight: 0.7 },
      { word: 'dónde están', weight: 0.6 }, { word: 'cómo están', weight: 0.8 },
      { word: 'buen día', weight: 0.8 }, { word: 'ayuda', weight: 0.3 },
    ],
  };

  function preprocess(text) {
    let processed = text.toLowerCase().trim();
    for (const [slang, replacement] of Object.entries(SLANG_MAP)) {
      processed = processed.replace(new RegExp(slang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
    }
    return processed;
  }

  function scoreIntent(text, category) {
    const keywords = INTENT_KEYWORDS[category] || [];
    let totalScore = 0;
    const matched = [];
    for (const kw of keywords) {
      if (text.includes(kw.word)) { totalScore += kw.weight; matched.push(kw.word); }
    }
    return { score: totalScore, matched };
  }

  function classifyLocal(rawMessage) {
    if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return { intent: 'OTROS', confidence: 0, keywords_matched: [], explanation: 'Mensaje vacío', source: 'local' };
    }
    const processed = preprocess(rawMessage);
    const scores = {};
    const allMatched = {};
    for (const category of Object.keys(INTENT_KEYWORDS)) {
      const result = scoreIntent(processed, category);
      scores[category] = result.score;
      allMatched[category] = result.matched;
    }
    let bestIntent = 'OTROS', bestScore = 0, secondBestScore = 0;
    for (const [cat, score] of Object.entries(scores)) {
      if (score > bestScore) { secondBestScore = bestScore; bestScore = score; bestIntent = cat; }
      else if (score > secondBestScore) { secondBestScore = score; }
    }
    if (bestScore < 0.3) bestIntent = 'OTROS';
    let confidence;
    if (bestScore === 0) { confidence = 0.5; }
    else {
      const gap = bestScore - secondBestScore;
      const normalized = Math.min(bestScore / 3, 1);
      const gapBonus = Math.min(gap / 2, 0.3);
      confidence = Math.min(0.5 + normalized * 0.35 + gapBonus, 0.99);
    }
    const catConfig = window.CATEGORY_CONFIG?.[bestIntent] || {};
    const matchedWords = allMatched[bestIntent] || [];
    const explanation = bestScore < 0.3
      ? 'No se detectaron keywords fiscales. Clasificado como consulta general. (Modo Local)'
      : `Detectado como ${catConfig.label || bestIntent}: ${matchedWords.length} keyword(s), score ${bestScore.toFixed(2)}. (Modo Local)`;
    return {
      intent: bestIntent, confidence: Math.round(confidence * 100) / 100,
      keywords_matched: matchedWords, explanation,
      resico_context: null, salud_fiscal_alerta: null, source: 'local',
    };
  }

  async function classify(rawMessage) {
    if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return { intent: 'OTROS', confidence: 0, keywords_matched: [], explanation: 'Mensaje vacío', source: 'local' };
    }
    // Validar longitud máxima
    if (rawMessage.length > InputSanitizer.LIMITS.MAX_MESSAGE_LENGTH) {
      rawMessage = rawMessage.substring(0, InputSanitizer.LIMITS.MAX_MESSAGE_LENGTH);
    }
    const cacheKey = rawMessage.trim().toLowerCase();
    const cached = classificationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return { ...cached.result, source: cached.result.source + ' (cached)' };
    }
    if (AppConfig.isGeminiConfigured()) {
      try {
        const result = await classifyWithGemini(rawMessage);
        if (classificationCache.size >= CACHE_MAX) {
          const oldest = classificationCache.keys().next().value;
          classificationCache.delete(oldest);
        }
        classificationCache.set(cacheKey, { result, timestamp: Date.now() });
        return result;
      } catch (error) {
        console.warn('%c[Classifier] Gemini falló, usando clasificador local:', 'color:#f59e0b', error.message);
        const localResult = classifyLocal(rawMessage);
        localResult.explanation += ` (Gemini error: ${error.message})`;
        return localResult;
      }
    }
    return classifyLocal(rawMessage);
  }

  function runTestSuite() {
    const messages = window.MOCK_MESSAGES || [];
    let correct = 0;
    const results = [];
    for (const m of messages) {
      const result = classifyLocal(m.text);
      const pass = result.intent === m.expected;
      if (pass) correct++;
      results.push({ text: m.text, expected: m.expected, got: result.intent, pass, confidence: result.confidence });
    }
    const accuracy = messages.length ? (correct / messages.length * 100).toFixed(1) : 0;
    console.log(`%c[Classifier Test] Accuracy: ${accuracy}% (${correct}/${messages.length})`, 'color:#10b981;font-weight:bold');
    return { accuracy: parseFloat(accuracy), correct, total: messages.length, results };
  }

  return { classify, classifyLocal, preprocess, runTestSuite, SLANG_MAP };
})();

if (typeof window !== 'undefined') window.IntentClassifier = IntentClassifier;
