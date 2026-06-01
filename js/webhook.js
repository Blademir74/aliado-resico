/* ============================================
   ALIADO RESICO — Webhook Bridge (n8n + Telegram)
   v3.0 — Rate Limiting por usuario, Sanitización
   ============================================ */

const WebhookBridge = (() => {

  // =============================================
  // RATE LIMITING POR USUARIO (30 msgs/min/usuario)
  // =============================================
  const RATE_LIMIT = 30;
  const RATE_WINDOW = 60 * 1000; // 1 minute
  const userRateLimits = new Map(); // Map<userId, number[]>

  // Cooldown exponencial para abusadores
  const abuseCooldowns = new Map(); // Map<userId, { count, until }>
  const ABUSE_THRESHOLD = 3; // Exceder rate limit 3 veces → cooldown

  // Retry config
  const MAX_RETRIES = 3;
  const BASE_DELAY = 1000;

  // =============================================
  // WHATSAPP MESSAGE TEMPLATES
  // =============================================
  const WA_TEMPLATES = {
    cobro_recordatorio: {
      type: 'utility', name: 'cobro_recordatorio_resico', language: 'es_MX',
      template: '🔔 Recordatorio de pago\n\nHola {{1}}, tienes un saldo pendiente de ${{2}} MXN.\n\nFecha límite: {{3}}\nReferencia: {{4}}\n\n¿Ya realizaste tu pago? Responde con tu comprobante.',
    },
    confirmacion_factura: {
      type: 'utility', name: 'confirmacion_factura_cfdi', language: 'es_MX',
      template: '✅ Factura emitida\n\nHola {{1}}, tu CFDI 4.0 ha sido timbrado exitosamente.\n\nFolio: {{2}}\nTotal: ${{3}} MXN\nFecha: {{4}}\n\n📄 Descarga tu factura en el portal.',
    },
    confirmacion_pago: {
      type: 'utility', name: 'confirmacion_pago_recibido', language: 'es_MX',
      template: '💰 Pago recibido\n\nHola {{1}}, confirmamos la recepción de tu pago.\n\nMonto: ${{2}} MXN\nReferencia: {{3}}\nFecha: {{4}}\n\nGracias por tu puntualidad. 🙌',
    },
    alerta_fiscal: {
      type: 'utility', name: 'alerta_fiscal_resico', language: 'es_MX',
      template: '⚠️ Alerta Fiscal RESICO\n\nHola {{1}}, detectamos lo siguiente:\n\n{{2}}\n\nTe recomendamos atenderlo a la brevedad para evitar sanciones. ¿Necesitas ayuda?',
    },
    declaracion_recordatorio: {
      type: 'utility', name: 'declaracion_mensual_resico', language: 'es_MX',
      template: '📅 Recordatorio de Declaración\n\nHola {{1}}, la fecha límite para tu declaración mensual de {{2}} es el {{3}}.\n\nISR estimado: ${{4}} MXN ({{5}}% sobre ingresos)\nIVA: Revisa tu acreditamiento de gastos.\n\n¿Necesitas ayuda para prepararla?',
    },
    bienvenida: {
      type: 'marketing', name: 'bienvenida_aliado_resico', language: 'es_MX',
      template: '🧠 ¡Bienvenido a Aliado RESICO!\n\nSoy tu asistente contable inteligente. Puedo ayudarte con:\n\n📘 Consultas fiscales\n📑 Facturación CFDI 4.0\n🧾 Registro de gastos\n💳 Reportes de pago\n\n¿En qué te puedo ayudar?',
    },
  };

  // =============================================
  // RATE LIMITING POR USUARIO
  // =============================================
  function checkRateLimit(userId) {
    const key = userId || 'global';
    const now = Date.now();

    // Check cooldown for abusers
    const cooldown = abuseCooldowns.get(key);
    if (cooldown && now < cooldown.until) {
      const waitSec = Math.ceil((cooldown.until - now) / 1000);
      console.warn(`[Webhook] 🚫 Usuario ${key} en cooldown — ${waitSec}s restantes`);
      return {
        allowed: false,
        reason: 'cooldown',
        remaining: 0,
        retryAfter: waitSec,
      };
    }

    // Initialize user log if not exists
    if (!userRateLimits.has(key)) {
      userRateLimits.set(key, []);
    }

    const timestamps = userRateLimits.get(key);

    // Clean old entries
    while (timestamps.length > 0 && now - timestamps[0] > RATE_WINDOW) {
      timestamps.shift();
    }

    if (timestamps.length >= RATE_LIMIT) {
      // Track abuse
      const abuse = abuseCooldowns.get(key) || { count: 0, until: 0 };
      abuse.count++;

      if (abuse.count >= ABUSE_THRESHOLD) {
        // Exponential cooldown: 1min, 2min, 4min, 8min...
        const cooldownMs = Math.min(60000 * Math.pow(2, abuse.count - ABUSE_THRESHOLD), 480000);
        abuse.until = now + cooldownMs;
        abuseCooldowns.set(key, abuse);
        console.warn(`[Webhook] 🚨 Cooldown exponencial para ${key}: ${cooldownMs / 1000}s (abuso #${abuse.count})`);
      } else {
        abuseCooldowns.set(key, abuse);
      }

      return {
        allowed: false,
        reason: 'rate_limited',
        remaining: 0,
        retryAfter: Math.ceil((timestamps[0] + RATE_WINDOW - now) / 1000),
      };
    }

    timestamps.push(now);
    return {
      allowed: true,
      remaining: RATE_LIMIT - timestamps.length,
    };
  }

  // =============================================
  // SEND TO n8n WEBHOOK
  // =============================================
  async function sendToN8N(payload, retryCount = 0) {
    const webhookUrl = AppConfig.getWebhookUrl();
    if (!webhookUrl) {
      console.info('[Webhook] Webhook no configurado. Envío omitido.');
      return { sent: false, reason: 'not_configured' };
    }

    // Validate payload size
    const sizeCheck = InputSanitizer.validatePayloadSize(payload);
    if (!sizeCheck.valid) {
      console.warn(`[Webhook] Payload too large: ${sizeCheck.error}`);
      return { sent: false, reason: 'payload_too_large', error: sizeCheck.error };
    }

    // Rate limit check (global for outbound)
    const rateCheck = checkRateLimit('outbound_global');
    if (!rateCheck.allowed) {
      console.warn(`[Webhook] Rate limited — ${rateCheck.reason}`);
      return { sent: false, reason: rateCheck.reason, retryAfter: rateCheck.retryAfter };
    }

    const fullPayload = {
      source: 'aliado_resico',
      version: '3.0',
      timestamp: new Date().toISOString(),
      ...payload,
    };

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'aliado-resico',
          'X-Version': '3.0',
        },
        body: JSON.stringify(fullPayload),
      });

      if (response.ok) {
        console.log('%c[Webhook] ✅ Sent to n8n', 'color:#10b981');
        return { sent: true, status: response.status };
      }

      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        const delay = BASE_DELAY * Math.pow(2, retryCount);
        console.warn(`[Webhook] Server error ${response.status}, retrying in ${delay}ms (${retryCount + 1}/${MAX_RETRIES})`);
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
      console.error('[Webhook] Failed after retries:', error.message);
      return { sent: false, error: error.message };
    }
  }

  // =============================================
  // RECEIVE FROM WEBHOOK (Telegram incoming)
  // =============================================
  async function receiveFromWebhook(data) {
    const msg = data.message || data;
    const message = msg.text || msg.caption || '';
    const chatId = String(msg.chat?.id || msg.from?.id || 'unknown');
    const messageId = msg.message_id || `tg-${Date.now()}`;

    // Per-user rate limiting
    const rateCheck = checkRateLimit(chatId);
    if (!rateCheck.allowed) {
      console.warn(`[Webhook] Usuario ${chatId} rate-limited: ${rateCheck.reason}`);
      return {
        processed: false,
        reason: rateCheck.reason,
        retryAfter: rateCheck.retryAfter,
        rateLimitRemaining: 0,
      };
    }

    const hasPhoto = msg.photo && msg.photo.length > 0;
    const fileId = hasPhoto ? msg.photo[msg.photo.length - 1].file_id : null;

    if (!message && !hasPhoto) return { processed: false, reason: 'empty_message' };

    // Sanitize incoming message
    const sanitizedMessage = InputSanitizer.sanitizeText(message);

    // Classify the message
    const classification = await IntentClassifier.classify(sanitizedMessage);
    const response = ConversationManager.getAutoResponse(classification.intent);

    const conversation = {
      id: `webhook-${messageId}`,
      text: hasPhoto ? (sanitizedMessage || '[IMAGEN ADJUNTA]') : sanitizedMessage,
      sender: chatId,
      time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      intent: classification.intent,
      confidence: classification.confidence,
      keywords: classification.keywords_matched,
      explanation: classification.explanation,
      response,
      timestamp: Date.now(),
      source: 'telegram',
      metadata: { chatId, messageId, fileId },
    };

    Store.addConversation(conversation);

    const templateType = getResponseTemplateType(classification.intent);

    return {
      processed: true,
      conversation,
      response: formatTelegramResponse(classification, response),
      templateType,
      classification,
      rateLimitRemaining: rateCheck.remaining,
    };
  }

  // =============================================
  // TELEGRAM RESPONSE FORMATTING
  // =============================================
  function formatTelegramResponse(classification, response) {
    let tgResponse = response
      .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
      .replace(/<br\s*\/?>/g, '\n');

    if (classification.salud_fiscal_alerta) {
      tgResponse += `\n\n⚠️ **Alerta de Salud Fiscal:**\n${classification.salud_fiscal_alerta}`;
    }
    if (classification.resico_context) {
      tgResponse += `\n\n📌 *${classification.resico_context}*`;
    }
    return tgResponse;
  }

  function getResponseTemplateType(intent) {
    const utilityIntents = {
      'REPORTE_PAGO': 'confirmacion_pago',
      'SOLICITUD_FACTURA': 'confirmacion_factura',
      'CONSULTA_FISCAL': 'alerta_fiscal',
      'REGISTRO_GASTO': 'alerta_fiscal',
    };
    return {
      templateName: utilityIntents[intent] || null,
      type: utilityIntents[intent] ? 'utility' : 'session',
      estimatedCostMXN: utilityIntents[intent] ? 0.17 : 0,
    };
  }

  async function sendProactiveMessage(templateKey, params) {
    const template = WA_TEMPLATES[templateKey];
    if (!template) return { sent: false, reason: 'unknown_template' };
    return sendToN8N({
      action: 'send_template',
      template: { name: template.name, language: template.language, type: template.type, parameters: params },
      cost_category: template.type,
    });
  }

  function getTemplates() { return { ...WA_TEMPLATES }; }
  function getTemplateCosts() {
    return Object.entries(WA_TEMPLATES).map(([key, t]) => ({
      key, name: t.name, type: t.type, costMXN: t.type === 'utility' ? 0.17 : 0.55,
    }));
  }

  return {
    sendToN8N, receiveFromWebhook, formatTelegramResponse,
    sendProactiveMessage, getTemplates, getTemplateCosts, getResponseTemplateType,
  };
})();

if (typeof window !== 'undefined') window.WebhookBridge = WebhookBridge;
