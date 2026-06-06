/* ============================================
   ALIADO RESICO — Webhook Bridge v4.0
   - Optimización de costos: Mensajes de Utilidad
   - Incluye metadatos fiscales (RFC, Art. 17-K)
   - Rate limiting y retry exponencial
   ============================================ */

const WebhookBridge = (() => {

  const RATE_LIMIT = 30;
  const RATE_WINDOW = 60 * 1000;
  const userRateLimits = new Map();
  const abuseCooldowns = new Map();
  const ABUSE_THRESHOLD = 3;
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000;

  // =============================================
  // RATE LIMITING
  // =============================================
  function checkRateLimit(userId) {
    const key = userId || 'global';
    const now = Date.now();

    const cooldown = abuseCooldowns.get(key);
    if (cooldown && now < cooldown.until) {
      const waitSec = Math.ceil((cooldown.until - now) / 1000);
      console.warn(`[Webhook] 🚫 Usuario ${key} en cooldown — ${waitSec}s`);
      return { allowed: false, reason: 'cooldown', retryAfter: waitSec };
    }

    if (!userRateLimits.has(key)) userRateLimits.set(key, []);
    const timestamps = userRateLimits.get(key);
    while (timestamps.length && now - timestamps[0] > RATE_WINDOW) timestamps.shift();

    if (timestamps.length >= RATE_LIMIT) {
      const abuse = abuseCooldowns.get(key) || { count: 0, until: 0 };
      abuse.count++;
      if (abuse.count >= ABUSE_THRESHOLD) {
        const cooldownMs = Math.min(60000 * Math.pow(2, abuse.count - ABUSE_THRESHOLD), 480000);
        abuse.until = now + cooldownMs;
        abuseCooldowns.set(key, abuse);
      } else abuseCooldowns.set(key, abuse);
      return { allowed: false, reason: 'rate_limited', retryAfter: Math.ceil((timestamps[0] + RATE_WINDOW - now) / 1000) };
    }

    timestamps.push(now);
    return { allowed: true, remaining: RATE_LIMIT - timestamps.length };
  }

  // =============================================
  // OBTENER METADATOS FISCALES DEL USUARIO (RFC, estado salud)
  // =============================================
  async function getFiscalMetadata(userId) {
    if (!window.Store) return { rfc: null, saludFiscal: null };
    const salud = Store.getSaludFiscal();
    // Intentar obtener RFC desde Store (si se ha registrado)
    const rfc = Store.getState()?.userRfc || null;
    return {
      rfc,
      saludFiscal: {
        buzonActivo: salud.buzonTributarioActivo,
        efirmaVigente: salud.eFirmaVigente,
        alertLevel: salud.alertLevel,
      },
      hasCompletedAudit: salud.buzonTributarioActivo === true && salud.eFirmaVigente === true,
    };
  }

  // =============================================
  // ENVÍO A n8n CON CATEGORIZACIÓN DE COSTO
  // =============================================
  async function sendToN8N(payload, retryCount = 0) {
    const webhookUrl = AppConfig.getWebhookUrl();
    if (!webhookUrl) {
      console.info('[Webhook] Webhook no configurado. Envío omitido.');
      return { sent: false, reason: 'not_configured' };
    }

    const sizeCheck = InputSanitizer.validatePayloadSize(payload);
    if (!sizeCheck.valid) return { sent: false, reason: 'payload_too_large' };

    const rateCheck = checkRateLimit('outbound_global');
    if (!rateCheck.allowed) return { sent: false, reason: rateCheck.reason, retryAfter: rateCheck.retryAfter };

    // Determinar tipo de mensaje para optimizar costo (Utility vs Marketing)
    const messageType = payload.message_category === 'fiscal_notification' ? 'utility' : 'session';
    const estimatedCost = messageType === 'utility' ? 0.17 : 0.55;

    const fullPayload = {
      source: 'aliado_resico',
      version: '4.0',
      timestamp: new Date().toISOString(),
      message_category: messageType,
      estimated_cost_mxn: estimatedCost,
      ...payload,
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Source': 'aliado-resico', 'X-Version': '4.0' },
        body: JSON.stringify(fullPayload),
      });

      if (response.ok) {
        console.log(`%c[Webhook] ✅ Enviado a n8n (${messageType}, $${estimatedCost} MXN)`, 'color:#10b981');
        return { sent: true, status: response.status, cost: estimatedCost };
      }

      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        await new Promise(r => setTimeout(r, delay));
        return sendToN8N(payload, retryCount + 1);
      }
      return { sent: false, status: response.status };
    } catch (error) {
      if (retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        await new Promise(r => setTimeout(r, delay));
        return sendToN8N(payload, retryCount + 1);
      }
      console.error('[Webhook] Error tras reintentos:', error.message);
      return { sent: false, error: error.message };
    }
  }

  // =============================================
  // RECEPCIÓN Y ENVÍO AUTOMÁTICO DE CADA CONVERSACIÓN
  // =============================================
  async function receiveFromWebhook(data) {
    const msg = data.message || data;
    const message = msg.text || msg.caption || '';
    const chatId = String(msg.chat?.id || msg.from?.id || 'unknown');
    const messageId = msg.message_id || `tg-${Date.now()}`;

    const rateCheck = checkRateLimit(chatId);
    if (!rateCheck.allowed) return { processed: false, reason: rateCheck.reason, retryAfter: rateCheck.retryAfter };

    const sanitizedMessage = InputSanitizer.sanitizeText(message);
    const classification = await IntentClassifier.classify(sanitizedMessage);
    const response = ConversationManager.getAutoResponse(classification.intent);

    // Obtener metadatos fiscales del usuario (si está autenticado)
    let fiscalMetadata = { rfc: null, saludFiscal: null, hasCompletedAudit: false };
    if (window.APP_STATE?.supabase) {
      const { data: { user } } = await window.APP_STATE.supabase.auth.getUser();
      if (user) fiscalMetadata = await getFiscalMetadata(user.id);
    }

    const conversation = {
      id: `webhook-${messageId}`,
      text: sanitizedMessage,
      sender: chatId,
      time: new Date().toLocaleTimeString('es-MX'),
      intent: classification.intent,
      confidence: classification.confidence,
      keywords: classification.keywords_matched,
      explanation: classification.explanation,
      response,
      timestamp: Date.now(),
      source: 'telegram',
      metadata: { chatId, messageId, fiscalMetadata }, // Incluye RFC y salud fiscal
    };

    Store.addConversation(conversation);

    // Enviar clasificación a n8n con categoría fiscal_notification → Utility
    const n8nPayload = {
      action: 'new_conversation',
      message_category: 'fiscal_notification', // Clave para que n8n use plantilla Utility
      conversation: {
        id: conversation.id,
        text: conversation.text,
        intent: conversation.intent,
        confidence: conversation.confidence,
        timestamp: conversation.timestamp,
      },
      user: {
        chat_id: chatId,
        rfc: fiscalMetadata.rfc,
        salud_fiscal: fiscalMetadata.saludFiscal,
        auditoria_completada: fiscalMetadata.hasCompletedAudit,
      },
      classification: {
        intent: classification.intent,
        confidence: classification.confidence,
        keywords: classification.keywords_matched,
        explanation: classification.explanation,
        resico_context: classification.resico_context,
        salud_fiscal_alerta: classification.salud_fiscal_alerta,
      },
    };

    await sendToN8N(n8nPayload); // No bloquea la respuesta

    const templateType = getResponseTemplateType(classification.intent);
    return {
      processed: true,
      conversation,
      response: formatTelegramResponse(classification, response),
      templateType,
      classification,
      rateLimitRemaining: rateCheck.remaining,
      fiscal_metadata_sent: true,
    };
  }

  // =============================================
  // FORMATEO PARA TELEGRAM
  // =============================================
  function formatTelegramResponse(classification, response) {
    let tgResponse = response
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<br\s*\/?>/g, '\n');
    if (classification.salud_fiscal_alerta) tgResponse += `\n\n⚠️ **Alerta de Salud Fiscal:**\n${classification.salud_fiscal_alerta}`;
    if (classification.resico_context) tgResponse += `\n\n📌 *${classification.resico_context}*`;
    return tgResponse;
  }

  function getResponseTemplateType(intent) {
    const utilityIntents = ['REPORTE_PAGO', 'SOLICITUD_FACTURA', 'CONSULTA_FISCAL', 'REGISTRO_GASTO', 'SALUD_FISCAL', 'DEVOLUCION_SALDO_A_FAVOR'];
    return {
      templateName: utilityIntents.includes(intent) ? 'fiscal_response' : null,
      type: utilityIntents.includes(intent) ? 'utility' : 'session',
      estimatedCostMXN: utilityIntents.includes(intent) ? 0.17 : 0.55,
    };
  }

  return {
    sendToN8N,
    receiveFromWebhook,
    formatTelegramResponse,
    getResponseTemplateType,
    getFiscalMetadata,
  };
})();

if (typeof window !== 'undefined') window.WebhookBridge = WebhookBridge;