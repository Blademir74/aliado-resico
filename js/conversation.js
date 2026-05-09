/* ============================================
   ALIADO RESICO — Conversation Manager
   Auto-responses + Auditoría de Salud Fiscal
   v3.0 — Tabla ISR Art. 113-E LISR, e.firma Art. 17-D CFF
   ============================================ */

const ConversationManager = (() => {

  let auditCompleted = false;

  // =============================================
  // TABLA ISR RESICO — Art. 113-E LISR
  // Tasas sobre INGRESOS BRUTOS (sin deducciones)
  // =============================================
  const ISR_RATES_RESICO = [
    { lowerLimit: 0,          upperLimit: 25000,      rate: 1.00, label: 'Hasta $25,000' },
    { lowerLimit: 25000.01,   upperLimit: 50000,      rate: 1.10, label: 'De $25,000.01 a $50,000' },
    { lowerLimit: 50000.01,   upperLimit: 83333.33,   rate: 1.50, label: 'De $50,000.01 a $83,333.33' },
    { lowerLimit: 83333.34,   upperLimit: 208333.33,  rate: 2.00, label: 'De $83,333.34 a $208,333.33' },
    { lowerLimit: 208333.34,  upperLimit: 3500000,    rate: 2.50, label: 'De $208,333.34 en adelante' },
  ];

  const RESICO_INCOME_LIMIT = 3500000; // Límite anual Art. 113-E

  /**
   * Calcula ISR mensual según Art. 113-E LISR
   * @param {number} monthlyIncome - Ingresos brutos facturados del mes
   * @returns {object} { rate, amount, bracket, warning }
   */
  function calculateISR(monthlyIncome) {
    if (!monthlyIncome || monthlyIncome <= 0) {
      return { rate: 0, amount: 0, bracket: null, warning: null };
    }

    // Encontrar el bracket aplicable
    let applicableRate = ISR_RATES_RESICO[ISR_RATES_RESICO.length - 1]; // Default: tasa más alta
    for (const bracket of ISR_RATES_RESICO) {
      if (monthlyIncome >= bracket.lowerLimit && monthlyIncome <= bracket.upperLimit) {
        applicableRate = bracket;
        break;
      }
    }

    const isrAmount = monthlyIncome * (applicableRate.rate / 100);
    let warning = null;

    // Alerta de proximidad al límite mensual equivalente
    const monthlyLimit = RESICO_INCOME_LIMIT / 12; // ~$291,666
    if (monthlyIncome > monthlyLimit * 0.85) {
      warning = `⚠️ Ingreso mensual ($${monthlyIncome.toLocaleString('es-MX')}) supera el 85% del promedio mensual permitido. Riesgo de exceder $3,500,000 anuales.`;
    }

    return {
      rate: applicableRate.rate,
      amount: Math.round(isrAmount * 100) / 100,
      bracket: applicableRate.label,
      warning,
      formula: `$${monthlyIncome.toLocaleString('es-MX')} × ${applicableRate.rate}% = $${isrAmount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}`,
    };
  }

  /**
   * Evalúa salud fiscal del ingreso acumulado anual
   * @param {number} incomeYTD - Ingresos acumulados del año
   * @returns {object} { status, pct, alert }
   */
  function evaluateIncomeRisk(incomeYTD) {
    const pct = (incomeYTD / RESICO_INCOME_LIMIT) * 100;
    let status = 'safe';
    let alert = null;

    if (pct >= 100) {
      status = 'exceeded';
      alert = `🚨 CRÍTICO: Has EXCEDIDO el límite de $3,500,000 MXN ($${incomeYTD.toLocaleString('es-MX')}). El SAT procederá a expulsarte de RESICO automáticamente. Contacta a tu contador de inmediato.`;
    } else if (pct >= 90) {
      status = 'critical';
      alert = `🚨 URGENTE: Llevas $${incomeYTD.toLocaleString('es-MX')} (${pct.toFixed(1)}% del límite). Estás a $${(RESICO_INCOME_LIMIT - incomeYTD).toLocaleString('es-MX')} de ser expulsado de RESICO.`;
    } else if (pct >= 75) {
      status = 'warning';
      alert = `⚠️ ALERTA: Llevas $${incomeYTD.toLocaleString('es-MX')} (${pct.toFixed(1)}%). Monitorea tus ingresos para no exceder el límite anual.`;
    }

    return { status, pct: Math.round(pct * 10) / 10, alert, remaining: RESICO_INCOME_LIMIT - incomeYTD };
  }

  // =============================================
  // RESPONSE TEMPLATES
  // =============================================
  const RESPONSE_TEMPLATES = {
    CONSULTA_FISCAL: [
      "¡Buena pregunta! 📘 En RESICO, el ISR se calcula sobre tus **ingresos brutos facturados**, con tasas del 1% al 2.5% según Art. 113-E LISR:\n\n📊 **Tabla ISR RESICO (mensual):**\n• Hasta $25,000 → **1.00%**\n• $25,001 - $50,000 → **1.10%**\n• $50,001 - $83,333 → **1.50%**\n• $83,334 - $208,333 → **2.00%**\n• Más de $208,333 → **2.50%**\n\n⚠️ **Diferencia CRÍTICA:**\n• **ISR** = sobre ingresos brutos — **NO hay deducciones**\n• **IVA** = SÍ permite acreditamiento — la gestión de gastos es **INDISPENSABLE**\n\n📌 El límite anual es de **$3,500,000 MXN**. Si lo superas, el SAT te expulsa automáticamente.\n\n¿Necesitas que calculemos tu tasa actual?",
      "Sobre tu consulta fiscal: 📘\n\nEl RESICO aplica para personas físicas con actividad empresarial, servicios profesionales o arrendamiento (Art. 113-E LISR).\n\n⚠️ **Distinción QUIRÚRGICA que debes entender:**\n• **ISR:** Se paga sobre **ingresos brutos** — NO se deducen gastos para ISR\n• **IVA:** SÍ permite **acreditamiento** — necesitas facturas de gastos para reducir tu IVA a pagar\n\nEsto significa que un gasto con factura **NO reduce tu ISR** pero **SÍ reduce tu IVA**.\n\n¿Te gustaría que revisemos tu situación específica?",
    ],
    SOLICITUD_FACTURA: [
      "¡Perfecto! 📑 Para emitir tu CFDI 4.0, necesito:\n\n1️⃣ **RFC** del receptor\n2️⃣ **Razón social** (exacta como en constancia del SAT)\n3️⃣ **Régimen fiscal** del receptor\n4️⃣ **Código postal** del domicilio fiscal\n5️⃣ **Uso del CFDI** (G01, G03, etc.)\n6️⃣ **Monto y concepto**\n\n📌 **Nota RESICO:** El ISR de esta factura se calcula sobre el monto bruto (Art. 113-E LISR). No hay deducciones.\n\n¿Me proporcionas estos datos?",
    ],
    REGISTRO_GASTO: [
      "¡Recibido! 🧾 Voy a registrar tu gasto para **acreditamiento de IVA**.\n\n📌 **Regla RESICO fundamental (Art. 113-E LISR):**\n• Los gastos **NO** reducen tu ISR — se paga sobre ingresos brutos\n• Los gastos **SÍ** reducen tu **IVA a pagar** vía acreditamiento\n\nPor eso es **INDISPENSABLE** que gestiones tus gastos con factura. Verificaré:\n• ✅ Que el comprobante tenga tu RFC\n• ✅ Que sea un gasto estrictamente indispensable\n• ✅ Que el IVA esté desglosado correctamente\n\n¿El ticket incluye factura o necesitas solicitarla al proveedor?",
    ],
    REPORTE_PAGO: [
      "¡Gracias por tu pago! 💳 Lo registro en tu expediente.\n\n📋 Datos recibidos:\n• **Medio:** Transferencia/OXXO\n• **Estado:** Pendiente de verificación\n\nEn cuanto confirme la recepción, te envío tu acuse. ¿Necesitas algo más?",
    ],
    SALUD_FISCAL: [
      "🚨 **¡ALERTA CRÍTICA DE RIESGO!** 🚨\n\nDetecto incumplimientos administrativos graves.\n\n⚠️ **Consecuencias según el CFF:**\n1. **Buzón Tributario inactivo (Art. 17-K CFF):** Multas de $3,420 a $10,260 MXN + cancelación de sellos digitales\n2. **e.firma vencida (Art. 17-D CFF):** La e.firma tiene vigencia de **4 años**. Sin ella, NO puedes facturar ni presentar declaraciones\n3. **Expulsión de RESICO:** El SAT puede removerte del régimen sin derecho a regresar\n\n📌 El 40% de las expulsiones de RESICO son por incumplimientos administrativos, NO por exceder ingresos.\n\n¿Te agendo una cita urgente en el portal del SAT?",
    ],
    OTROS: [
      "¡Hola! 👋 Bienvenido a Aliado RESICO.\n\nSoy tu asistente contable especializado. Puedo ayudarte con:\n\n📘 Consultas fiscales y del SAT\n📑 Emisión de facturas CFDI 4.0\n🧾 Registro de gastos para acreditamiento de IVA\n💳 Reportes de pago\n\n¿En qué te puedo ayudar hoy?",
    ],
  };

  // =============================================
  // AUDITORÍA DE SALUD FISCAL (Art. 17-K CFF)
  // =============================================
  const FISCAL_HEALTH_AUDIT_MESSAGE = `🏥 **Auditoría de Salud Fiscal RESICO**

Antes de continuar, necesito verificar 3 puntos críticos:

1️⃣ **¿Tu Buzón Tributario está activo? (Art. 17-K CFF)**
   → Sin él, multas de $3,420 a $10,260 MXN y cancelación de sellos digitales.

2️⃣ **¿Tu e.firma (firma electrónica) está vigente? (Art. 17-D CFF)**
   → Vigencia: 4 años desde emisión. Sin ella no puedes facturar ni declarar.

3️⃣ **¿Tu Constancia de Situación Fiscal refleja RESICO?**
   → Verifica que tu régimen fiscal sea correcto.

📌 Responde "sí" o "no" a cada punto, o dime "necesito ayuda".

⚠️ **El 40% de las expulsiones de RESICO** son por incumplimientos administrativos.`;

  function shouldShowAudit() {
    if (auditCompleted) return false;
    const salud = Store.getSaludFiscal();
    if (!salud.lastAuditDate) return true;
    const daysSince = (Date.now() - new Date(salud.lastAuditDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 30;
  }

  function getAuditMessage() {
    auditCompleted = true;
    return FISCAL_HEALTH_AUDIT_MESSAGE;
  }

  function getAutoResponse(intent) {
    const templates = RESPONSE_TEMPLATES[intent] || RESPONSE_TEMPLATES.OTROS;
    return templates[Math.floor(Math.random() * templates.length)];
  }

  function formatTimestamp(date) {
    return (date || new Date()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  async function processMessage(text) {
    const classification = await IntentClassifier.classify(text);
    let response = getAutoResponse(classification.intent);

    if (classification.salud_fiscal_alerta) {
      response += `\n\n⚠️ **Alerta de Salud Fiscal:** ${classification.salud_fiscal_alerta}`;
    }
    if (classification.resico_context) {
      response += `\n\n📌 **Contexto RESICO:** ${classification.resico_context}`;
    }

    // Evaluar riesgo de ingresos y agregar alerta proactiva si aplica
    const incomeRisk = evaluateIncomeRisk(Store.getState().incomeYTD || 0);
    if (incomeRisk.alert && classification.intent !== 'OTROS') {
      response += `\n\n${incomeRisk.alert}`;
    }

    const conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      text,
      sender: 'Usuario',
      time: formatTimestamp(),
      intent: classification.intent,
      confidence: classification.confidence,
      keywords: classification.keywords_matched,
      explanation: classification.explanation,
      response,
      timestamp: Date.now(),
      source: classification.source || 'unknown',
    };

    Store.addConversation(conversation);

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

    return { conversation, response, classification };
  }

  return {
    processMessage, getAutoResponse, formatTimestamp,
    shouldShowAudit, getAuditMessage,
    calculateISR, evaluateIncomeRisk,
    ISR_RATES_RESICO, RESICO_INCOME_LIMIT,
  };
})();

if (typeof window !== 'undefined') window.ConversationManager = ConversationManager;
