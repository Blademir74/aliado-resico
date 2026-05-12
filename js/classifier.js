/* ============================================
   ALIADO RESICO — Intent Classifier Engine
   Gemini 1.5 Flash + Local Fallback
   v2.2 — Parser Blindado, Endpoint Estable
   ============================================ */

const IntentClassifier = (() => {

  // --- Cache para clasificaciones recientes ---
  const classificationCache = new Map();
  const CACHE_MAX = 100;
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  // --- Slang Map (referencia en prompt + fallback local) ---
  const SLANG_MAP = {
    'la chiva': 'el sat',
    'el chivo': 'el sat',
    'el chiva': 'el sat',
    'hacienda': 'el sat',
    'el fisco': 'el sat',
    'timbrar': 'emitir cfdi',
    'sellar': 'emitir cfdi',
    'facturar': 'emitir cfdi',
    'recibito': 'ticket',
    'notita': 'nota de venta',
    'deposité': 'transferencia',
    'le deposité': 'transferencia',
    'le pagué': 'pago',
    'ya pagué': 'pago',
    'me cobran': 'saldo',
    'jalar': 'trabajar',
    'chambear': 'trabajar',
    'lana': 'dinero',
    'varo': 'dinero',
    'baro': 'dinero',
    'fierro': 'dinero',
  };

  // --- System Prompt (Strict Mode) ---
  const SYSTEM_PROMPT = `Eres un clasificador fiscal mexicano EXPERTO en el Régimen Simplificado de Confianza (RESICO). Tu trabajo es clasificar mensajes de contribuyentes mexicanos con máxima precisión.

INSTRUCCIÓN CRÍTICA DE FORMATO:
Responde ÚNICAMENTE con el objeto JSON. NINGÚN texto antes o después. NINGÚN bloque de código markdown. NINGÚN preámbulo como "Aquí tienes" o "Claro". SOLO el JSON puro.

AUDITORÍA DE SALUD FISCAL:
Si el usuario indica que no tiene e.firma vigente o Buzón Tributario activo, emite una alerta en "salud_fiscal_alerta".

CATEGORÍAS — elige exactamente UNA:
1. CONSULTA_FISCAL — Preguntas sobre impuestos, régimen, tasas, obligaciones, SAT, declaraciones, e.firma, buzón tributario, constancia de situación fiscal
2. SOLICITUD_FACTURA — Solicitudes para emitir, cancelar o modificar facturas CFDI 4.0, complementos de pago, notas de crédito
3. REGISTRO_GASTO — Registro de gastos, tickets, recibos, notas de consumo para acreditamiento de IVA
4. REPORTE_PAGO — Reportes de pagos realizados, transferencias, depósitos OXXO, SPEI, comprobantes bancarios
5. SALUD_FISCAL — Respuestas directas sobre Buzón Tributario o e.firma (ej. "no los tengo", "sí, todo bien", "se me venció")
6. OTROS — Saludos, despedidas, preguntas generales no fiscales, conversación casual

CONTEXTO RESICO CRÍTICO:
- ISR: Se paga estrictamente sobre INGRESOS BRUTOS facturados (1%-2.5%). NO hay deducciones para ISR.
- IVA: SÍ permite acreditamiento. La gestión de gastos con factura es INDISPENSABLE para acreditar IVA.
- Límite anual: $3,500,000 MXN — excederlo causa expulsión del régimen.
- Buzón Tributario inactivo: sanciones y posible expulsión.
- e.firma vencida: imposibilidad de facturar o presentar declaraciones.

JERGA FISCAL MEXICANA:
- "la chiva", "el chivo" = el SAT
- "timbrar", "sellar" = emitir factura CFDI
- "lana", "varo", "baro", "fierro" = dinero
- "chambear", "jalar" = trabajar
- "recibito", "notita" = ticket o nota de venta
- "deposité", "le deposité" = transferencia bancaria

REGLAS DE CONFIANZA:
- Mensaje claro sin ambigüedad → confidence >= 0.90
- Slang entendible → confidence 0.80-0.90
- Ambigüedad entre 2 categorías → confidence 0.60-0.80
- Mensaje muy corto o vago → confidence 0.40-0.60

Esquema de respuesta obligatorio (SOLO esto, sin nada más):
{"intent":"CATEGORIA","confidence":0.95,"keywords_detected":["palabra1"],"explanation":"Breve razón","resico_context":"Nota ISR/IVA relevante o null","salud_fiscal_alerta":"Alerta de riesgo si aplica o null"}`;

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

  // --- Llamada a Gemini API ---
  async function classifyWithGemini(message) {
    const key = AppConfig.getGeminiKey();
    if (!key) throw new Error('No Gemini API Key configurada');

    // Endpoint estable — gemini-1.5-flash (no gemini-flash-latest)
    const response = await fetch('/api/gemini-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + '\\n\\nMensaje a clasificar: "' + sanitizedMessage + '"' }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Gemini HTTP ${response.status}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];

    if (!candidate || candidate.finishReason === 'SAFETY') {
      throw new Error(`Gemini bloqueó la respuesta (motivo: ${candidate?.finishReason || 'UNKNOWN'})`);
    }

    const rawText = candidate.content?.parts?.[0]?.text;
    if (!rawText || typeof rawText !== 'string') throw new Error('Respuesta de Gemini vacía');

    // Parser blindado: tolera preámbulos y markdown
    const jsonString = extractJSON(rawText);
    if (!jsonString) {
      console.error('[Classifier] Raw Gemini response (no JSON found):', rawText);
      throw new Error('No se encontró JSON válido en la respuesta de Gemini');
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      console.error('[Classifier] JSON parse failed. Extracted string:', jsonString);
      throw new Error(`JSON inválido de Gemini: ${e.message}`);
    }

    const validIntents = ['CONSULTA_FISCAL', 'SOLICITUD_FACTURA', 'REGISTRO_GASTO', 'REPORTE_PAGO', 'SALUD_FISCAL', 'OTROS'];
    if (!validIntents.includes(parsed.intent)) {
      parsed.intent = 'OTROS';
    }

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
  // CLASIFICADOR LOCAL — fallback por keywords
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
      { word: 'timbrar', weight: 1.0 }, { word: 'emitir cfdi', weight: 1.0 },
      { word: 'cancelar factura', weight: 1.0 }, { word: 'nota de crédito', weight: 0.9 },
      { word: 'complemento de pago', weight: 1.0 }, { word: 'rfc', weight: 0.5 },
      { word: 'sellar', weight: 0.8 }, { word: 'necesito factura', weight: 1.0 },
      { word: 'me da su factura', weight: 1.0 }, { word: 'facturación', weight: 0.9 },
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
      if (text.includes(kw.word)) {
        totalScore += kw.weight;
        matched.push(kw.word);
      }
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

    let bestIntent = 'OTROS';
    let bestScore = 0;
    let secondBestScore = 0;

    for (const [cat, score] of Object.entries(scores)) {
      if (score > bestScore) {
        secondBestScore = bestScore;
        bestScore = score;
        bestIntent = cat;
      } else if (score > secondBestScore) {
        secondBestScore = score;
      }
    }

    if (bestScore < 0.3) bestIntent = 'OTROS';

    let confidence;
    if (bestScore === 0) {
      confidence = 0.5;
    } else {
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
      intent: bestIntent,
      confidence: Math.round(confidence * 100) / 100,
      keywords_matched: matchedWords,
      explanation,
      resico_context: null,
      salud_fiscal_alerta: null,
      source: 'local',
    };
  }

  // =============================================
  // CLASSIFY — enruta a Gemini o Local
  // =============================================
  async function classify(rawMessage) {
    if (!rawMessage || typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
      return { intent: 'OTROS', confidence: 0, keywords_matched: [], explanation: 'Mensaje vacío', source: 'local' };
    }

    const cacheKey = rawMessage.trim().toLowerCase();
    const cached = classificationCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
      return { ...cached.result, source: cached.result.source + ' (cached)' };
    }

    if (AppConfig.isGeminiConfigured()) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const result = await classifyWithGemini(rawMessage);
        clearTimeout(timeoutId);

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
    results.filter(r => !r.pass).forEach(r => {
      console.warn(`  FAIL: "${r.text.slice(0, 50)}..." → expected ${r.expected}, got ${r.got}`);
    });

    return { accuracy: parseFloat(accuracy), correct, total: messages.length, results };
  }

  return { classify, classifyLocal, preprocess, runTestSuite, SLANG_MAP };
})();

if (typeof window !== 'undefined') window.IntentClassifier = IntentClassifier;
