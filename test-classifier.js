const fs = require('fs');

const API_KEY = process.env.GEMINI_API_KEY || ''; // NUNCA hardcodear keys;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${API_KEY}`;

const SYSTEM_PROMPT = `Eres un clasificador fiscal mexicano EXPERTO en el Régimen Simplificado de Confianza (RESICO). Tu trabajo es clasificar mensajes de contribuyentes mexicanos con máxima precisión.

CATEGORÍAS (elige exactamente UNA):
1. CONSULTA_FISCAL — Preguntas sobre impuestos, régimen, tasas, obligaciones, SAT, declaraciones, e.firma, buzón tributario, constancia de situación fiscal
2. SOLICITUD_FACTURA — Solicitudes para emitir, cancelar o modificar facturas CFDI 4.0, complementos de pago, notas de crédito
3. REGISTRO_GASTO — Registro de gastos, tickets, recibos, notas de consumo para acreditamiento de IVA
4. REPORTE_PAGO — Reportes de pagos realizados, transferencias, depósitos OXXO, SPEI, comprobantes bancarios
5. SALUD_FISCAL — Respuestas directas a la Auditoría de Salud Fiscal indicando si tienen o no Buzón Tributario o e.firma (ej. "no los tengo", "sí, todo bien", "no", "se me venció").
6. OTROS — Saludos, despedidas, preguntas generales no fiscales, conversación casual

CONTEXTO RESICO CRÍTICO:
- ISR: Se paga sobre INGRESOS BRUTOS (1%-2.5%), NO hay deducciones personales
- IVA: SÍ permite acreditamiento de gastos con factura — la gestión de gastos es INDISPENSABLE para IVA
- Límite anual: $3,500,000 MXN — excederlo causa EXPULSIÓN del régimen
- Buzón Tributario: DEBE estar activo — su inactividad causa sanciones y posible expulsión
- e.firma: DEBE estar vigente — sin ella no se pueden emitir facturas ni presentar declaraciones

JERGA FISCAL MEXICANA (muy importante):
- "la chiva", "el chivo" = el SAT (Servicio de Administración Tributaria)
- "timbrar", "sellar" = emitir factura CFDI
- "lana", "varo", "baro", "fierro" = dinero
- "chambear", "jalar" = trabajar
- "recibito", "notita" = ticket o nota de venta
- "deposité", "le deposité" = hizo una transferencia bancaria

REGLAS DE CONFIANZA:
- Si el mensaje es claro y sin ambigüedad → confidence >= 0.90
- Si hay slang pero se entiende la intención → confidence 0.80-0.90
- Si hay ambigüedad entre 2 categorías → confidence 0.60-0.80
- Si el mensaje es muy corto o vago → confidence 0.40-0.60

Responde EXCLUSIVAMENTE con el objeto JSON y nada más. NO uses markdown, NO incluyas backticks (\`\`\`json) y NO escribas texto introductorio como "Aquí está el JSON".
{
  "intent": "CATEGORIA_AQUI",
  "confidence": 0.95,
  "keywords_detected": ["palabra1", "palabra2"],
  "explanation": "Explicación breve de por qué se clasificó así",
  "resico_context": "Nota relevante sobre ISR/IVA si aplica, o null",
  "salud_fiscal_alerta": "Si detectas que el usuario podría tener un riesgo fiscal (buzón inactivo, e.firma vencida, cerca del límite), incluye una alerta breve. Si no aplica, null"
}`;

const messages = [
  // Bloque 1: Consultas y Slang
  "¿Cuánto es lo máximo que puedo ganar en RESICO sin que me saquen?",
  "La chiva me mandó un correo al buzón, ¿qué hago?",
  "¿Si gano 3 millones al año todavía entro en este régimen?",
  "Oye, ¿tengo que declarar cada mes o es cada año?",
  "El fisco me está buscando por una declaración de 2023.",
  "¿Qué pasa si me paso del límite de los 3.5 millones?",
  // Bloque 2: Facturación y Timbrado
  "Quiero timbrar una factura de 10 mil pesos más IVA.",
  "Hazme un CFDI para un cliente que me pagó ayer.",
  "¿Me puedes generar una factura para el RFC: ABC123456T1?",
  "Necesito emitir un recibo de honorarios urgente.",
  "Oye, mi cliente quiere factura 4.0, ¿ya la manejas?",
  "Quiero facturar una venta, pero no tengo los datos completos.",
  // Bloque 3: Gastos e IVA
  "Te mando este ticket de la gasolina para deducir el IVA.",
  "Gasté 500 pesos en papelería, ¿esto cuenta para mis gastos?",
  "Tengo una nota de venta de una comida, ¿me sirve?",
  "Acabo de comprar una laptop para la oficina, aquí está el PDF.",
  "¿Si estoy en RESICO puedo deducir mi renta?",
  "Pagué la luz del local, te mando la foto.",
  // Bloque 4: Pagos y Cobranza
  "Ya te mandé el varo por transferencia, aquí está el comprobante.",
  "Fui al OXXO a depositar, te paso la foto del ticket.",
  "Liquidado el saldo de este mes, confírmame porfa.",
  "Te mando la captura de pantalla de mi app del banco.",
  "¿A qué cuenta te deposito lo de mis impuestos?",
  "Ya quedó el pago, valídame el folio por favor.",
  // Bloque 5: Casos de Borde y Auditoría
  "Hola, buenas tardes, ¿quién eres?",
  "No tengo mi e.firma, ¿todavía puedo estar en RESICO?",
  "Gracias por la ayuda, me salvaste de la multa.",
  "Adiós, hablamos luego.",
  "Quiero saber si mi Buzón Tributario está bien.",
  "¿Qué servicios ofreces para mi negocio?"
];

async function classifyWithGemini(message) {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: `Clasifica este mensaje:\n\n"${message}"` }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 800,
          responseMimeType: 'application/json',
        }
      })
    });

    if (!response.ok) {
        const errText = await response.text();
        return { error: `HTTP ${response.status} - ${errText}` };
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    
    if (!candidate || candidate.finishReason === 'SAFETY') {
      return { error: `Bloqueo de seguridad o respuesta vacía (FinishReason: ${candidate?.finishReason || 'UNKNOWN'})` };
    }

    const text = candidate.content?.parts?.[0]?.text;
    
    if (!text) {
      return { error: 'Respuesta vacía de Gemini (sin candidatos o contenido)' };
    }

    // Extractor seguro de JSON (regex multilínea)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { error: `No se encontró JSON en respuesta: ${text.substring(0, 100)}...` };
    
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      return { error: `Error de parseo JSON: ${e.message} en: ${match[0].substring(0, 50)}...` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

async function runTests() {
  console.log("Iniciando pruebas de estrés (30 mensajes)...\n");
  let resultsMarkdown = "# Resultados de Prueba de Estrés: Clasificador Gemini 1.5 Flash\n\n";
  resultsMarkdown += "| Mensaje | Intent | Confianza | Alerta Salud / Contexto | Keywords |\n";
  resultsMarkdown += "|---|---|---|---|---|\n";

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    process.stdout.write(`[${i+1}/30] Probando: "${msg.substring(0, 30)}..." `);
    const result = await classifyWithGemini(msg);
    
    if (result.error) {
      console.log(`❌ Error: ${result.error}`);
      resultsMarkdown += `| "${msg}" | ERROR | N/A | ${result.error} | N/A |\n`;
    } else {
      console.log(`✅ ${result.intent} (${result.confidence})`);
      const alert = result.salud_fiscal_alerta || result.resico_context || "Ninguna";
      const keywords = (result.keywords_detected || []).join(", ");
      resultsMarkdown += `| "${msg}" | **${result.intent}** | ${result.confidence} | ${alert} | ${keywords} |\n`;
    }
    
    if (result.error && result.error.includes('429')) {
      console.log(`\n⚠️ LÍMITE DIARIO ALCANZADO: Tu API Key gratuita tiene un límite estricto de 20 peticiones por día. Prueba pausada.`);
      resultsMarkdown += `\n> **Nota:** La prueba se detuvo aquí porque se alcanzó el límite diario de 20 peticiones gratuitas en Google AI Studio.\n`;
      break;
    }

    // Pausa de 20 segundos (obligatoria para evitar 429 en free tier con 3 RPM)
    await new Promise(r => setTimeout(r, 20000));
  }

  fs.writeFileSync('test_results.md', resultsMarkdown, 'utf-8');
  console.log("\nPruebas completadas. Resultados guardados en test_results.md");
}

runTests();
