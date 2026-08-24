/* ============================================
   ALIADO RESICO — Conversation Manager v3.1
   Fix: declaración doble de `conversation`
   Fix: annual_obligation handler implementado
   Fix: window.ConversationManager garantizado
   Art. 113-E LISR / Art. 17-D CFF / Art. 17-K CFF
   ============================================ */

const ConversationManager = (() => {

  let auditCompleted = false;
  let _awaitingAnnualAnswer = false;  // estado del wizard de declaración anual

 // ── FIX FASE 2.1: Tabla ISR RESICO oficial anual 2026 (RMF 2026) ─────────
const ISR_RATES_RESICO = [
  { lowerLimit: 0,          upperLimit: 300000,     rate: 1.00, label: 'Hasta $300,000 anuales' },
  { lowerLimit: 300000.01,  upperLimit: 600000,     rate: 1.10, label: 'De $300,000.01 a $600,000' },
  { lowerLimit: 600000.01,  upperLimit: 1000000,    rate: 1.50, label: 'De $600,000.01 a $1,000,000' },
  { lowerLimit: 1000000.01, upperLimit: 2500000,    rate: 2.00, label: 'De $1,000,000.01 a $2,500,000' },
  { lowerLimit: 2500000.01, upperLimit: 3500000,    rate: 2.50, label: 'De $2,500,000.01 a $3,500,000' },
];

  const RESICO_INCOME_LIMIT = 3_500_000;

  // ── FIX FASE 2.1.B: calculateISR ahora acepta ingreso anual ───────────────
function calculateISR(annualIncome) {
  if (!annualIncome || annualIncome <= 0) return { rate: 0, amount: 0, bracket: null, warning: null };
  
  let applicableRate = ISR_RATES_RESICO[ISR_RATES_RESICO.length - 1];
  for (const bracket of ISR_RATES_RESICO) {
    if (annualIncome >= bracket.lowerLimit && annualIncome <= bracket.upperLimit) {
      applicableRate = bracket;
      break;
    }
  }
  
  const isrAmount = annualIncome * (applicableRate.rate / 100);
  const monthlyIncome = annualIncome / 12;
  const monthlyLimit = RESICO_INCOME_LIMIT / 12;
  
  const warning = monthlyIncome > monthlyLimit * 0.85
    ? `⚠️ Ingreso mensual promedio ($${monthlyIncome.toLocaleString('es-MX')}) supera el 85% del promedio mensual. Riesgo de exceder $3,500,000 anuales (Art. 113-E LISR).`
    : null;
  
  return {
    rate: applicableRate.rate,
    amount: Math.round(isrAmount * 100) / 100,
    bracket: applicableRate.label,
    warning,
    formula: `$${annualIncome.toLocaleString('es-MX')} × ${applicableRate.rate}% = $${isrAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} anuales`,
  };
}

  function evaluateIncomeRisk(incomeYTD) {
    const pct = (incomeYTD / RESICO_INCOME_LIMIT) * 100;
    let status = 'safe', alert = null;
    if (pct >= 100) {
      status = 'exceeded';
      alert = `🚨 CRÍTICO: Excediste el límite de $3,500,000 MXN. El SAT iniciará tu expulsión de RESICO (Art. 113-E LISR). Contacta a tu contador.`;
    } else if (pct >= 94) {
      status = 'expulsion';
      alert = `🚨 RIESGO DE EXPULSIÓN: Llevas $${incomeYTD.toLocaleString('es-MX')} (${pct.toFixed(1)}%). A $${(RESICO_INCOME_LIMIT - incomeYTD).toLocaleString('es-MX')} del límite. El SAT puede migrarte a Actividad Empresarial automáticamente.`;
    } else if (pct >= 90) {
      status = 'critical';
      alert = `🚨 URGENTE: Llevas $${incomeYTD.toLocaleString('es-MX')} (${pct.toFixed(1)}% del límite anual). Planifica reducir ingresos o prepara la transición de régimen.`;
    } else if (pct >= 80) {
      status = 'warning';
      alert = `⚠️ ALERTA: Llevas $${incomeYTD.toLocaleString('es-MX')} (${pct.toFixed(1)}%). Monitorea tus ingresos para no exceder $3,500,000 MXN anuales.`;
    }
    return { status, pct: Math.round(pct * 10) / 10, alert, remaining: RESICO_INCOME_LIMIT - incomeYTD };
  }

  /* ── Plantillas de respuesta ── */
  const RESPONSE_TEMPLATES = {
    CONSULTA_FISCAL: [
      "📘 En RESICO, el ISR se calcula sobre tus **ingresos brutos facturados**, con tasas del 1% al 2.5% (Art. 113-E LISR):\n\n• Hasta $25,000 → 1.00%\n• $25,001 - $50,000 → 1.10%\n• $50,001 - $83,333 → 1.50%\n• $83,334 - $208,333 → 2.00%\n• Más de $208,333 → 2.50%\n\n**Diferencia crítica ISR vs IVA:**\n• ISR = sobre ingresos brutos, sin deducciones\n• IVA = sí permite acreditamiento con gastos indispensables\n\nLímite anual: **$3,500,000 MXN**. Si lo superas, el SAT te migra a Actividad Empresarial.\n\n⚠️ Sin e.firma vigente (Art. 17-D CFF) no puedes emitir facturas ni presentar declaraciones.\n\n¿Calculamos tu tasa actual?",
    ],
    SOLICITUD_FACTURA: [
      "📑 Para emitir tu CFDI 4.0 necesito:\n\n1. RFC del receptor\n2. Razón social exacta\n3. Régimen fiscal del receptor\n4. Código postal del domicilio fiscal\n5. Uso del CFDI (G01, G03, etc.)\n6. Monto y concepto\n\n⚠️ El ISR se calcula sobre el monto bruto (Art. 113-E LISR), sin deducciones.\n⚠️ Si tu e.firma está vencida (Art. 17-D CFF), no es posible timbrar el CFDI.\n\n¿Me proporcionas los datos?",
    ],
    REGISTRO_GASTO: [
      "🧾 Registrando tu gasto para **acreditamiento de IVA**.\n\n**Regla RESICO (Art. 113-E LISR):**\n• Los gastos NO reducen tu ISR — se paga sobre ingresos brutos\n• Los gastos SÍ reducen tu IVA a pagar vía acreditamiento\n\nPor eso gestionar tus facturas de gasto es indispensable. Verificaré:\n• Que el comprobante tenga tu RFC\n• Que sea un gasto estrictamente indispensable\n• Que el IVA esté desglosado correctamente\n\n¿El ticket incluye factura?",
    ],
    REPORTE_PAGO: [
      "💳 Pago registrado en tu expediente. Pendiente de verificación. Te envío el acuse al confirmar la recepción.",
    ],
    SALUD_FISCAL: [
      "🏥 **Alertas de cumplimiento:**\n\n1. **Buzón Tributario inactivo (Art. 17-K CFF):** Multa de hasta **$10,260 MXN** + cancelación de sellos digitales. En caso de reincidencia la multa se duplica (Art. 86-C CFF).\n\n2. **e.firma vencida (Art. 17-D CFF):** Vigencia de 4 años. Sin ella no puedes facturar ni presentar declaraciones.\n\n3. **Expulsión de RESICO:** El SAT puede removerte sin derecho a regresar si acumulas incumplimientos.\n\n¿Agendo revisión urgente en sat.gob.mx?",
    ],
    OTROS: [
      "👋 Bienvenido a Aliado RESICO. Puedo ayudarte con:\n\n📘 Consultas fiscales\n📑 Emisión de CFDI 4.0\n🧾 Registro de gastos para acreditamiento de IVA\n💳 Reportes de pago\n\n¿En qué te ayudo?",
    ],
  };

  /* ── Respuesta para declaración anual ── */
  const ANNUAL_WIZARD_QUESTION =
    "📋 **Asistente de Declaración Anual (Art. 113-F LISR)**\n\n¿Tuviste durante el año ingresos distintos a RESICO?\n\n• Salarios superiores a $400,000 MXN\n• Intereses bancarios\n• Dividendos\n\nResponde **sí** o **no** para determinar si debes presentar declaración anual en abril.";

  function checkAnnualObligation(hasMixedIncome) {
    if (hasMixedIncome) {
      return "📋 **Resultado:** Tienes la **obligación de presentar declaración anual** en abril (Art. 113-F LISR) porque tuviste ingresos mixtos o superiores a $400,000 en otras fuentes.\n\n¿Quieres que revisemos los montos?";
    }
    return "📋 **Resultado:** Si tus únicos ingresos fueron por RESICO y cumples las condiciones del Art. 113-F LISR, estás **exento de presentar declaración anual**.\n\nSigue monitoreando tu límite de $3,500,000 MXN anuales.";
  }

  /* ── Auditoría de Salud Fiscal ── */
  const FISCAL_HEALTH_AUDIT_MESSAGE =
    "🏥 **Auditoría de Salud Fiscal RESICO**\n\nAntes de continuar verifico 3 puntos críticos:\n\n1️⃣ **¿Tu Buzón Tributario está activo? (Art. 17-K CFF)**\n   Sin él: multas de $3,420 a $10,260 MXN y cancelación de sellos.\n\n2️⃣ **¿Tu e.firma está vigente? (Art. 17-D CFF)**\n   Vigencia: 4 años. Sin ella no puedes facturar ni declarar.\n\n3️⃣ **¿Tu Constancia de Situación Fiscal refleja RESICO?**\n\nResponde sí o no a cada punto.";

  function shouldShowAudit() {
    if (auditCompleted) return false;
    const salud = Store.getSaludFiscal();
    if (!salud.lastAuditDate) return true;
    const daysSince = (Date.now() - new Date(salud.lastAuditDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 30;
  }

  function getAuditMessage() { auditCompleted = true; return FISCAL_HEALTH_AUDIT_MESSAGE; }

  function getAutoResponse(intent) {
    const templates = RESPONSE_TEMPLATES[intent] || RESPONSE_TEMPLATES.OTROS;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  function formatTimestamp(date) {
    return (date || new Date()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  /* ── processMessage — sin declaración doble ── */
  async function processMessage(text) {

    /* Interceptar respuesta al wizard de declaración anual */
    if (_awaitingAnnualAnswer) {
      _awaitingAnnualAnswer = false;
      const lower = text.toLowerCase().trim();
      const hasMixed = lower.startsWith('s') || lower === 'yes';
      const annualResponse = checkAnnualObligation(hasMixed);

      const annualConv = {
        id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text,
        sender: 'Usuario',
        time: formatTimestamp(),
        intent: 'CONSULTA_FISCAL',
        confidence: 100,
        keywords: ['declaración anual', 'art. 113-f'],
        explanation: 'Respuesta al wizard de obligación anual',
        response: annualResponse,
        timestamp: Date.now(),
        source: 'wizard',
        is_fiscal_audit_completed: false,
      };

      try { Store.addConversation(annualConv); } catch (e) { console.warn('[Conv] addConversation:', e.message); }
      return { conversation: annualConv, response: annualResponse, classification: { intent: 'CONSULTA_FISCAL', confidence: 100 } };
    }

    /* Clasificación normal */
    let classification;
    try {
      classification = await IntentClassifier.classify(text);
    } catch (e) {
      console.warn('[Conv] classify error:', e.message);
      classification = { intent: 'OTROS', confidence: 50, keywords_matched: [], explanation: 'Clasificación local', source: 'fallback' };
    }

    let response = getAutoResponse(classification.intent);

    /* Activar wizard de declaración anual */
    if (classification.annual_obligation === 'ask_mixed_income') {
      _awaitingAnnualAnswer = true;
      response = ANNUAL_WIZARD_QUESTION;
    }

    /* Complementos contextuales */
    if (classification.salud_fiscal_alerta) {
      response += `\n\n⚠️ **Alerta de Salud Fiscal:** ${classification.salud_fiscal_alerta}`;
    }
    if (classification.resico_context) {
      response += `\n\n📌 **Contexto RESICO:** ${classification.resico_context}`;
    }
    if (classification.connection_restored) {
      response += `\n\n🔄 **Conexión restablecida.**\n• Monitor activo (Art. 113-E LISR): límite $3.5 MDP\n• Buzón inactivo: multa de $10,260 MXN (Art. 17-K CFF)\n• Reincidencia: duplica la multa (Art. 86-C CFF)\n• Declaración anual: abril (Art. 113-F LISR)`;
    }
    if (classification.intent === 'SALUD_FISCAL') {
      response += "\n\n⚠️ Multa por buzón inactivo: hasta $10,260 MXN (Art. 17-K CFF). Actívalo en sat.gob.mx.";
    }

    /* Alerta proactiva de ingresos */
    const incomeRisk = evaluateIncomeRisk(Store.getState().incomeYTD || 0);
    if (incomeRisk.alert && classification.intent !== 'OTROS') {
      response += `\n\n${incomeRisk.alert}`;
    }

    /* Una sola declaración de conversation */
    const conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      sender: 'Usuario',
      time: formatTimestamp(),
      intent: classification.intent,
      confidence: classification.confidence,
      keywords: classification.keywords_matched || [],
      explanation: classification.explanation || '',
      response,
      timestamp: Date.now(),
      source: classification.source || 'unknown',
      is_fiscal_audit_completed: false,
    };

    try {
      Store.addConversation(conversation);
    } catch (e) {
      console.warn('[Conv] Store.addConversation falló:', e.message);
    }

    try {
      WebhookBridge.sendToN8N({
        action: 'message_classified',
        message: text,
        classification: {
          intent: classification.intent,
          confidence: classification.confidence,
          keywords: classification.keywords_matched,
        },
        response,
        templateType: WebhookBridge.getResponseTemplateType(classification.intent),
      }).catch(() => {});
    } catch { /* webhook opcional */ }

    return { conversation, response, classification };
  }

  return {
    processMessage, getAutoResponse, formatTimestamp,
    shouldShowAudit, getAuditMessage,
    calculateISR, evaluateIncomeRisk,
    ISR_RATES_RESICO, RESICO_INCOME_LIMIT,
  };
})();

/* Exposición global garantizada */
window.ConversationManager = ConversationManager;