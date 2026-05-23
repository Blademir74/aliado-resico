/* ============================================
ALIADO RESICO — Intent Classifier Engine v3.0
✅ Proxy-Only | Fiscal Compliance | JSON Strict
Cumplimiento: CFF Art. 17-K, 86-C | LISR Art. 113-E
============================================ */
const IntentClassifier = (() => {
  const classificationCache = new Map();
  const CACHE_MAX = 100;
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  // 🗣️ Slang Map (referencia en prompt + fallback local)
  const SLANG_MAP = {
    'la chiva': 'el sat', 'el chivo': 'el sat', 'hacienda': 'el sat',
    'timbrar': 'emitir cfdi', 'sellar': 'emitir cfdi', 'facturar': 'emitir cfdi',
    'recibito': 'ticket', 'notita': 'nota de venta', 'deposité': 'transferencia',
    'lana': 'dinero', 'varo': 'dinero', 'chambear': 'trabajar'
  };

  // 🧠 SYSTEM PROMPT — Cumplimiento Fiscal Integrado
  const SYSTEM_PROMPT = `Eres un clasificador fiscal mexicano EXPERTO en RESICO.
INSTRUCCIÓN CRÍTICA: Responde ÚNICAMENTE con JSON válido. NINGÚN texto extra. NINGÚN markdown.

CATEGORÍAS (elige exactamente UNA):
CONSULTA_FISCAL | SOLICITUD_FACTURA | REGISTRO_GASTO | REPORTE_PAGO | SALUD_FISCAL | OTROS

CONTEXTO RESICO (Art. 113-E LISR):
• ISR: Se paga sobre INGRESOS BRUTOS facturados (tasas 1%-2.5%). NO hay deducciones para ISR.
• IVA: SÍ permite acreditamiento. Requiere gastos con factura CFDI 4.0 válida.
• Límite anual: $3,500,000 MXN. Excederlo causa expulsión automática al Régimen de Actividad Empresarial (tasas hasta 35%).
• Alerta temprana: $3,150,000 MXN (90%) = RIESGO_EXPULSION.

AUDITORÍA DE SALUD FISCAL (CFF Art. 17-K, 86-C):
• Buzón Tributario inactivo: Multa inmediata $3,420-$10,260 MXN (Art. 17-K CFF).
• Reincidencia: La multa puede DUPLICARSE hasta $20,520 MXN (Art. 86-C, fracción II, CFF).
• e.firma vencida: Vigencia máxima 4 años (Art. 17-D CFF). Sin e.firma vigente NO se puede facturar ni declarar.

REGLAS DE ALERTA:
1. Si usuario menciona "buzón inactivo", "no tengo buzón", "no me llega": 
   → salud_fiscal_alerta: "⚠️ Multa $10,260 MXN (Art. 17-K CFF). Reincidencia duplica multa (Art. 86-C CFF). Active su buzón en sat.gob.mx"
2. Si usuario reporta ingresos ≥ $3,150,000 MXN:
   → salud_fiscal_alerta: "🚨 RIESGO_EXPULSION (Art. 113-E LISR). Al rebasar $3.5M, el SAT lo pasará automáticamente al Régimen General con tasas hasta 35%."
3. Si usuario menciona "e.firma vencida" o fecha >4 años:
   → salud_fiscal_alerta: "🔒 e.firma vencida (Art. 17-D CFF). Bloqueo total de facturación y declaraciones. Renueve en sat.gob.mx con CURP y datos biométricos."

JERGA MEXICANA: "la chiva"=SAT, "timbrar"=emitir CFDI, "lana"=dinero, "recibito"=ticket

ESQUEMA DE RESPUESTA OBLIGATORIO (SOLO JSON, sin texto adicional):
{"intent":"CATEGORIA","confidence":0.95,"keywords_detected":["k1"],"explanation":"breve razón","resico_context":"nota ISR/IVA o null","salud_fiscal_alerta":"alerta o null"}`;

  // 🔐 Parser blindado para extraer JSON de respuestas de Gemini
  function extractJSON(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const cleaned = rawText.replace(/`(?:json)?\s*([\s\S]*?)`/gi, '$1').trim();
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    return (start !== -1 && end > start) ? cleaned.slice(start, end + 1) : null;
  }

  // 🌐 Llamada al proxy server-side (NUNCA directo a Gemini)
  async function classifyWithProxy(message) {
    // ✅ Sanitización de entrada
    const sanitizedMessage = message.replace(/["\\]/g, '').slice(0, 1500);
    
    const response = await fetch('/api/gemini-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SYSTEM_PROMPT + '\n\nMensaje: "' + sanitizedMessage + '"' }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Proxy HTTP ${response.status}`);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Respuesta vacía del proxy');

    const jsonString = extractJSON(rawText);
    if (!jsonString) throw new Error('No JSON válido en respuesta');

    const parsed = JSON.parse(jsonString);
    const validIntents = ['CONSULTA_FISCAL','SOLICITUD_FACTURA','REGISTRO_GASTO','REPORTE_PAGO','SALUD_FISCAL','OTROS'];
    
    return {
      intent: validIntents.includes(parsed.intent) ? parsed.intent : 'OTROS',
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
      keywords_matched: parsed.keywords_detected || [],
      explanation: parsed.explanation || '',
      resico_context: parsed.resico_context || null,
      salud_fiscal_alerta: parsed.salud_fiscal_alerta || null,
      source: 'gemini_proxy',
      _meta: data._meta // Para debugging en desarrollo
    };
  }

  // 🔄 Fallback local corregido (typos eliminados)
  const INTENT_KEYWORDS = {
    CONSULTA_FISCAL: [
      { word: 'resico', weight: 1.0 }, { word: 'isr', weight: 0.9 }, { word: 'declaración', weight: 0.8 },
      { word: 'buzón tributario', weight: 0.9 }, { word: 'e.firma', weight: 0.7 }, { word: 'límite', weight: 0.6 }
    ],
    SOLICITUD_FACTURA: [
      { word: 'factura', weight: 0.9 }, { word: 'cfdi', weight: 1.0 }, { word: 'timbrar', weight: 1.0 },
      { word: 'rfc', weight: 0.5 }, { word: 'cancelar', weight: 0.8 }
    ],
    REGISTRO_GASTO: [
      { word: 'gasto', weight: 0.9 }, { word: 'ticket', weight: 0.9 }, { word: 'iva', weight: 0.6 },
      { word: 'deducir', weight: 0.5 }, { word: 'compra', weight: 0.5 }
    ],
    REPORTE_PAGO: [
      { word: 'pago', weight: 0.7 }, { word: 'transferencia', weight: 0.9 }, { word: 'oxxo', weight: 0.9 },
      { word: 'deposité', weight: 0.9 }, { word: 'comprobante', weight: 0.8 }
    ],
    SALUD_FISCAL: [
      { word: 'buzón', weight: 0.9 }, { word: 'efirma', weight: 0.9 }, { word: 'vencida', weight: 0.7 },
      { word: 'multa', weight: 0.8 }, { word: 'sat', weight: 0.5 }
    ],
    OTROS: [{ word: 'hola', weight: 0.9 }, { word: 'gracias', weight: 0.8 }]
  };

  function classifyLocal(raw) {
    if (!raw?.trim()) return { intent: 'OTROS', confidence: 0, keywords_matched: [], explanation: 'Mensaje vacío', source: 'local' };
    const text = raw.toLowerCase();
    let best = 'OTROS', bestScore = 0, matched = [];
    
    for (const [cat, kws] of Object.entries(INTENT_KEYWORDS)) {
      let score = 0, m = [];
      for (const kw of kws) if (text.includes(kw.word)) { score += kw.weight; m.push(kw.word); }
      if (score > bestScore) { bestScore = score; best = cat; matched = m; }
    }
    
    return {
      intent: bestScore < 0.3 ? 'OTROS' : best,
      confidence: Math.min(0.9, 0.4 + bestScore * 0.1),
      keywords_matched: matched,
      explanation: `Clasificación local: ${best}`,
      resico_context: null, 
      salud_fiscal_alerta: null, 
      source: 'local'
    };
  }

  // 🎯 Función principal de clasificación
  async function classify(message) {
    const key = message.trim().toLowerCase();
    const cached = classificationCache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return { ...cached.res, source: 'cached' };

    try {
      const res = await classifyWithProxy(message);
      if (classificationCache.size >= CACHE_MAX) classificationCache.delete(classificationCache.keys().next().value);
      classificationCache.set(key, { res, ts: Date.now() });
      return res;
    } catch (e) {
      console.warn('[Classifier] Proxy falló → fallback local:', e.message);
      const local = classifyLocal(message);
      local.explanation += ` (Proxy error: ${e.message})`;
      return local;
    }
  }

  return { classify, classifyLocal, SLANG_MAP };
})();
if (typeof window !== 'undefined') window.IntentClassifier = IntentClassifier;