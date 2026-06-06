/* ════════════════════════════════════════════════
   ALIADO RESICO — Intent Classifier v4.0
   Nueva categoría: DEVOLUCION_SALDO_A_FAVOR
   Corrección: Art. 113-F LISR (declaración anual)
   Art. 17-K CFF — pérdida de plazos legales
   ════════════════════════════════════════════════ */
const IntentClassifier = (() => {
  const CACHE = new Map();
  const CACHE_MAX = 100, CACHE_TTL = 5 * 60 * 1000;
  let proxyOffline = false;

  // Slang mexicano → término fiscal formal
  const SLANG_MAP = {
    'la chiva': 'el sat', 'el chivo': 'el sat', 'hacienda': 'el sat',
    'timbrar': 'emitir cfdi', 'sellar': 'emitir cfdi', 'facturar': 'emitir cfdi',
    'recibito': 'ticket', 'notita': 'nota de venta',
    'deposité': 'transferencia', 'me cayó': 'recibí pago',
    'lana': 'dinero', 'varo': 'dinero', 'chambear': 'trabajar',
    'me devuelvan': 'devolución', 'me regresen': 'devolución',
    'saldo a favor': 'saldo a favor',
  };

function checkAnnualObligation(userHasMixedIncome) {
  // userHasMixedIncome: true/false/null (null = no se sabe aún)
  if (userHasMixedIncome === true) {
    return {
      obligated: true,
      message: "📋 **SÍ debes presentar declaración anual** (Art. 113-F LISR 2026). Porque tienes ingresos por salarios >$400k, intereses, dividendos o plataformas digitales. Plazo: 30 de abril. Omisión genera multas y afecta tu opinión de cumplimiento."
    };
  } else if (userHasMixedIncome === false) {
    return {
      obligated: false,
      message: "✅ **No estás obligado a presentar declaración anual** (Art. 113-F LISR 2026). Al solo tener ingresos por RESICO y haber cumplido con tus pagos mensuales, estás exento. Recuerda mantener tu buzón activo y tus CFDI en orden."
    };
  } else {
    return {
      obligated: null,
      message: "Para saber si estás obligado a la declaración anual, necesito saber: ¿Recibiste ingresos por **salarios superiores a $400,000 anuales**, **intereses reales**, **dividendos**, **arrendamiento** o **plataformas digitales** (Uber, Didi, Mercado Libre, etc.)? Responde sí o no."
    };
  }
}


 // ─── SYSTEM PROMPT v5.0 (RESICO 2026) ──────────
  const SYSTEM_PROMPT = `Eres un clasificador fiscal mexicano EXPERTO en RESICO 2026.
INSTRUCCIÓN CRÍTICA: Responde ÚNICAMENTE con JSON válido. NINGÚN texto extra. NINGÚN markdown.

CATEGORÍAS (elige exactamente UNA):
CONSULTA_FISCAL | SOLICITUD_FACTURA | REGISTRO_GASTO | REPORTE_PAGO | SALUD_FISCAL | DEVOLUCION_SALDO_A_FAVOR | OTROS

══════════════════════════════════════════════════
CONTEXTO RESICO — LISR 2026
══════════════════════════════════════════════════

Art. 113-E LISR — Régimen Simplificado de Confianza:
• ISR: Se paga sobre INGRESOS EFECTIVAMENTE COBRADOS (tasas 1%–2.5% mensual). SIN deducciones personales.
• IVA: SÍ permite acreditamiento. Requiere CFDI 4.0 válido con RFC correcto del proveedor.
• Límite anual: $3,500,000 MXN. Al rebasarlo, expulsión automática al Régimen General (tasas hasta 35%).

Art. 113-F LISR — Declaración Anual RESICO 2026:
• Las personas físicas que únicamente obtengan ingresos por RESICO y cumplan puntualmente con pagos mensuales están EXENTAS de presentar declaración anual.
• En cambio, quienes tengan ingresos MIXTOS (salarios superiores a $400,000 anuales, intereses reales, arrendamiento, ingresos por plataformas digitales, dividendos, etc.) SÍ están obligados a presentar declaración anual en abril.
• La omisión de la anual cuando es obligatoria genera multas y afecta la opinión de cumplimiento.

Art. 113-F LISR — Declaración Anual RESICO 2026:
• Las personas físicas que únicamente obtengan ingresos por RESICO y cumplan puntualmente con pagos mensuales están EXENTAS de presentar declaración anual.
• En cambio, quienes tengan ingresos MIXTOS (salarios superiores a $400,000 anuales, intereses reales, arrendamiento, ingresos por plataformas digitales, dividendos, etc.) SÍ están obligados a presentar declaración anual en abril.
• Si el usuario pregunta “¿Tengo que hacer declaración anual?” y NO menciona ingresos mixtos, el clasificador debe devolver annual_obligation: "ask_mixed_income".
*/
══════════════════════════════════════════════════
DEVOLUCIÓN DE SALDO A FAVOR — CATEGORÍA NUEVA
══════════════════════════════════════════════════
Aplica cuando el usuario pregunta sobre:
• "Me sale saldo a favor", "¿puedo pedir devolución?", "me retuvieron más ISR del que debo"
• "Tengo saldo a favor de IVA", "¿cómo tramito la devolución en el SAT?"
• Compensación de saldos, devolución automática, buzón SAT devoluciones

Respuesta correcta: SÍ puede haber saldo a favor en RESICO, principalmente cuando:
1. Clientes PM retuvieron ISR (10% o 1.25%) y el total retenido supera el ISR calculado.
2. Hubo pagos provisionales excedentes.
3. Saldo a favor de IVA por gastos acreditables mayores al IVA trasladado.

ADVERTENCIA OBLIGATORIA: Para tramitar devolución, el contribuyente debe:
1. Tener Buzón Tributario ACTIVO (Art. 17-K CFF — sin esto el SAT no puede notificar).
2. Declaraciones mensuales al corriente (sin omisiones).
3. e.firma vigente para firmar la solicitud.
4. Estar libre de requerimientos o auditorías activas.

══════════════════════════════════════════════════
SALUD FISCAL — CFF
══════════════════════════════════════════════════
Art. 17-K CFF — Buzón Tributario:
• Obligación de mantenerlo ACTIVO y revisarlo periódicamente.
• CRÍTICO: Ignorar mensajes en el buzón puede causar PÉRDIDA DE PLAZOS LEGALES para impugnar, corregir o contestar requerimientos.
• Multa por incumplimiento: hasta $10,260 MXN (según supuesto y actualización normativa).
• PÉRDIDA DE PLAZO: Si el SAT notifica por buzón y el contribuyente no lo lee, el plazo corre igual. Puede perder el derecho a aclarar o impugnar.

Art. 86-C CFF — Reincidencia:
• Si el contribuyente ya fue multado por buzón y reinicide, la multa puede duplicarse.
• El SAT lleva registro de infracciones. No asumas que el SAT no trackea.

Art. 17-D CFF — e.firma:
• Vigencia máxima 4 años. Sin e.firma vigente: bloqueo total de CFDI y declaraciones.

══════════════════════════════════════════════════
REGLAS DE ALERTA AUTOMÁTICA
══════════════════════════════════════════════════
1. Buzón inactivo / "no tengo buzón":
   → "⚠️ Art. 17-K CFF: Multa hasta $10,260 MXN. MÁS GRAVE: Si el SAT te notificó y no lo leíste, perdiste el plazo para impugnar. Activa tu buzón HOY en sat.gob.mx"

2. Ingresos ≥ $3,150,000 MXN:
   → "🚨 90% del límite RESICO (Art. 113-E LISR). Al rebasar $3.5M, cambio automático a Régimen General con tasas hasta 35%. Monitorea tus ingresos."

3. Devolución sin regularización:
   → "✅ SÍ puedes pedir devolución, PERO primero verifica: buzón activo, declaraciones al corriente, e.firma vigente y sin requerimientos pendientes."

4. Declaración anual:
   → "📋 RESICO SÍ tiene declaración anual (Art. 113-F LISR). Se presenta en abril. Es simplificada, sin deducciones personales, pero es OBLIGATORIA."

JERGA MEXICANA: "la chiva"=SAT, "timbrar"=emitir CFDI, "lana"=dinero, "recibito"=ticket, "me devuelvan"=devolución

ESQUEMA DE RESPUESTA (SOLO JSON — ningún texto adicional):
{"intent":"CATEGORIA","confidence":0.95,"keywords_detected":["k1","k2"],"explanation":"razón breve","resico_context":"nota fiscal relevante o null","salud_fiscal_alerta":"alerta o null"}`;

  // ─── PARSER JSON BLINDADO ─────────────────────────
  function extractJSON(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = raw.replace(/`(?:json)?\s*([\s\S]*?)`/gi, '$1').trim();
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    return (start !== -1 && end > start) ? cleaned.slice(start, end + 1) : null;
  }

  // ─── LLAMADA AL PROXY (sin API key en frontend) ───
  async function classifyWithProxy(message) {
    const sanitized = window.InputSanitizer?.sanitizeForAI ? window.InputSanitizer.sanitizeForAI(message) : message;
    const safe = sanitized.replace(/["\\\n]/g, ' ').slice(0, 1500);
    const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
    const token   = session?.data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const r = await fetch('/api/gemini-proxy', {
      method: 'POST', headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${SYSTEM_PROMPT}\n\nMensaje del contribuyente: "${safe}"` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 350 },
      }),
    });

    if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || `Proxy HTTP ${r.status}`); }
    const data = await r.json();
    const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Respuesta vacía del proxy');

    const jsonStr = extractJSON(raw);
    if (!jsonStr) throw new Error('JSON no encontrado en respuesta');

    const p = JSON.parse(jsonStr);
    const VALID = ['CONSULTA_FISCAL','SOLICITUD_FACTURA','REGISTRO_GASTO','REPORTE_PAGO','SALUD_FISCAL','DEVOLUCION_SALDO_A_FAVOR','OTROS'];

    return {
      intent:              VALID.includes(p.intent) ? p.intent : 'OTROS',
      confidence:          Math.max(0, Math.min(1, p.confidence || 0.5)),
      keywords_matched:    p.keywords_detected || [],
      explanation:         p.explanation || '',
      resico_context:      p.resico_context || null,
      salud_fiscal_alerta: p.salud_fiscal_alerta || null,
      source: 'gemini_proxy',
      _meta: data._meta,
    };
  }

  // ─── FALLBACK LOCAL ───────────────────────────────
  const KEYWORDS = {
    CONSULTA_FISCAL: [
      {w:'resico',weight:1.0},{w:'isr',weight:.9},{w:'declaración',weight:.8},
      {w:'régimen',weight:.7},{w:'límite',weight:.6},{w:'tasa',weight:.6},
      {w:'anual',weight:.7},{w:'mensual',weight:.6},{w:'113-e',weight:1.0},
      {w:'113-f',weight:1.0},{w:'art.',weight:.4},
    ],
    SOLICITUD_FACTURA: [
      {w:'factura',weight:.9},{w:'cfdi',weight:1.0},{w:'timbrar',weight:1.0},
      {w:'rfc',weight:.5},{w:'cancelar',weight:.8},{w:'receptor',weight:.7},
      {w:'expediente',weight:.6},{w:'folio',weight:.7},
    ],
    REGISTRO_GASTO: [
      {w:'gasto',weight:.9},{w:'ticket',weight:.9},{w:'iva',weight:.6},
      {w:'deducir',weight:.5},{w:'compra',weight:.5},{w:'factura de',weight:.6},
      {w:'acreditamiento',weight:.8},{w:'acreditar',weight:.8},
    ],
    REPORTE_PAGO: [
      {w:'pago',weight:.7},{w:'transferencia',weight:.9},{w:'oxxo',weight:.9},
      {w:'deposité',weight:.9},{w:'comprobante',weight:.8},{w:'cobré',weight:.9},
      {w:'me pagaron',weight:.9},{w:'ingreso',weight:.7},
    ],
    SALUD_FISCAL: [
      {w:'buzón',weight:.9},{w:'efirma',weight:.9},{w:'e.firma',weight:.9},
      {w:'vencida',weight:.7},{w:'multa',weight:.8},{w:'sat',weight:.5},
      {w:'plazo',weight:.6},{w:'requerimiento',weight:.8},{w:'notificación',weight:.7},
    ],
    DEVOLUCION_SALDO_A_FAVOR: [
      {w:'devolución',weight:1.0},{w:'saldo a favor',weight:1.0},
      {w:'me devuelvan',weight:1.0},{w:'me regresen',weight:.9},
      {w:'compensación',weight:.8},{w:'retención',weight:.6},
      {w:'retenido',weight:.7},{w:'exceso',weight:.6},
      {w:'sobrepago',weight:.9},{w:'me retuvieron',weight:.9},
    ],
    OTROS: [{w:'hola',weight:.9},{w:'gracias',weight:.8},{w:'ayuda',weight:.3}],
  };

  // Respuestas locales enriquecidas por intención
  const LOCAL_RESPONSES = {
    CONSULTA_FISCAL: {
      ctx: 'ISR RESICO: sobre ingresos cobrados, tasa 1%–2.5% mensual, sin deducciones (Art. 113-E LISR). Declaración anual OBLIGATORIA en abril (Art. 113-F LISR).',
    },
    SOLICITUD_FACTURA: {
      ctx: 'CFDI 4.0: incluye RFC receptor, régimen fiscal, código postal, descripción del servicio y forma de pago. Cancela dentro de los plazos permitidos.',
    },
    REGISTRO_GASTO: {
      ctx: 'Para acreditar IVA: CFDI 4.0 válido con tu RFC y gasto estrictamente indispensable (Art. 5 LIVA). El ISR RESICO NO permite deducir este gasto.',
    },
    REPORTE_PAGO: {
      ctx: 'Registra el cobro en tu control de ingresos RESICO. Recuerda: el ISR se calcula sobre ingresos efectivamente cobrados, no devengados.',
    },
    SALUD_FISCAL: {
      ctx: 'Buzón Tributario: ACTÍVALO. Si el SAT te notificó y no lo leíste, el plazo corre igual — puedes perder el derecho a impugnar (Art. 17-K CFF).',
      alerta: '⚠️ Multa hasta $10,260 MXN por buzón inactivo. PÉRDIDA DE PLAZOS LEGALES si ignoras notificaciones SAT (Art. 17-K CFF).',
    },
    DEVOLUCION_SALDO_A_FAVOR: {
      ctx: 'SÍ puedes tener saldo a favor en RESICO (retenciones de clientes PM, IVA acreditable). Pero ANTES de solicitarlo: buzón activo, declaraciones al corriente, e.firma vigente y sin requerimientos.',
      alerta: '✅ Devolución posible, pero requiere regularización previa. Un requerimiento activo puede bloquear tu trámite.',
    },
    OTROS: { ctx: null },
  };

  function classifyLocal(raw) {
    if (!raw?.trim()) return { intent:'OTROS', confidence:0, keywords_matched:[], explanation:'Mensaje vacío', source:'local' };
    const text = raw.toLowerCase();
    let best = 'OTROS', bestScore = 0, matched = [];

    for (const [cat, kws] of Object.entries(KEYWORDS)) {
      let score = 0, m = [];
      for (const kw of kws) if (text.includes(kw.w)) { score += kw.weight; m.push(kw.w); }
      if (score > bestScore) { bestScore = score; best = cat; matched = m; }
    }

    const intent  = bestScore < 0.3 ? 'OTROS' : best;
    const lr      = LOCAL_RESPONSES[intent] || LOCAL_RESPONSES.OTROS;

    return {
      intent,
      confidence:          Math.min(0.88, 0.42 + bestScore * 0.1),
      keywords_matched:    matched,
      explanation:         `Clasificación local: ${intent}`,
      resico_context:      lr.ctx || null,
      salud_fiscal_alerta: lr.alerta || null,
      source: 'local',
    };
  }

  // ─── CLASIFICADOR PRINCIPAL ───────────────────────
  async function classify(message) {
    const key    = message.trim().toLowerCase();
    const cached = CACHE.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return { ...cached.res, source: 'cached' };

    try {
      const res = await classifyWithProxy(message);
      
      // Si estaba offline y ahora funciona, la conexión se ha restablecido
      if (proxyOffline) {
        proxyOffline = false;
        res.connection_restored = true;
      }
      
      if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
      CACHE.set(key, { res, ts: Date.now() });
      return res;
    } catch(e) {
      proxyOffline = true;
      console.warn('[Classifier] Proxy → fallback local:', e.message);
      const local = classifyLocal(message);
      local.explanation += ` (offline: ${e.message.slice(0,60)})`;
      return local;
    }
  }

  return { classify, classifyLocal, SLANG_MAP, getProxyOffline: () => proxyOffline, setProxyOffline: (v) => { proxyOffline = v; } };
})();
if (typeof window !== 'undefined') window.IntentClassifier = IntentClassifier;
