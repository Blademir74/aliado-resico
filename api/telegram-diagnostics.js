// ============================================
// ALIADO RESICO — Telegram + n8n Diagnostics
// Vercel Serverless Function v2.5
// Valida TELEGRAM_BOT_TOKEN → N8N_WEBHOOK_URL
// Asegura webhook de PRODUCCIÓN (no "Test")
// ============================================

export default async function handler(req, res) {
  // --- CORS ---
  const allowedOrigin = process.env.ALIADO_ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Source');

  if (req.method === 'OPTIONS') return res.status(204).end();

  // =============================================
  // DIAGNÓSTICO COMPLETO DE CONECTIVIDAD
  // =============================================
  const diagnostics = {
    timestamp: new Date().toISOString(),
    version: '2.5',
    telegram: { status: 'unknown', botInfo: null, webhookInfo: null, errors: [] },
    n8n: { status: 'unknown', webhookUrl: null, isProduction: null, errors: [] },
    overall: 'pending',
  };

  // --- 1. Validate Telegram Bot Token ---
  const botToken = process.env.ALIADO_TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    diagnostics.telegram.status = 'error';
    diagnostics.telegram.errors.push('ALIADO_TELEGRAM_BOT_TOKEN no está configurado en variables de entorno de Vercel');
  } else {
    // 1a. Verificar que el token sea válido con getMe
    try {
      const getMeRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
      const getMeData = await getMeRes.json();

      if (getMeData.ok) {
        diagnostics.telegram.status = 'connected';
        diagnostics.telegram.botInfo = {
          id: getMeData.result.id,
          is_bot: getMeData.result.is_bot,
          first_name: getMeData.result.first_name,
          username: getMeData.result.username,
          can_join_groups: getMeData.result.can_join_groups,
          can_read_all_group_messages: getMeData.result.can_read_all_group_messages,
          supports_inline_queries: getMeData.result.supports_inline_queries,
        };
      } else {
        diagnostics.telegram.status = 'invalid_token';
        diagnostics.telegram.errors.push(`Telegram API rechazó el token: ${getMeData.description || 'Unknown error'}`);
      }
    } catch (err) {
      diagnostics.telegram.status = 'network_error';
      diagnostics.telegram.errors.push(`No se pudo conectar a Telegram API: ${err.message}`);
    }

    // 1b. Verificar el webhook configurado en Telegram
    try {
      const webhookInfoRes = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
      const webhookInfoData = await webhookInfoRes.json();

      if (webhookInfoData.ok) {
        const info = webhookInfoData.result;
        diagnostics.telegram.webhookInfo = {
          url: info.url || '(no webhook set)',
          has_custom_certificate: info.has_custom_certificate,
          pending_update_count: info.pending_update_count,
          last_error_date: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
          last_error_message: info.last_error_message || null,
          max_connections: info.max_connections,
          allowed_updates: info.allowed_updates || [],
        };

        // Verificar que el webhook apunte al lugar correcto
        if (!info.url) {
          diagnostics.telegram.errors.push('⚠️ No hay webhook configurado en Telegram. El bot no recibirá mensajes.');
        } else if (info.last_error_message) {
          diagnostics.telegram.errors.push(`⚠️ Último error del webhook: ${info.last_error_message} (${new Date(info.last_error_date * 1000).toISOString()})`);
        }

        if (info.pending_update_count > 0) {
          diagnostics.telegram.errors.push(`ℹ️ Hay ${info.pending_update_count} actualizaciones pendientes sin procesar`);
        }
      }
    } catch (err) {
      diagnostics.telegram.errors.push(`No se pudo obtener info del webhook: ${err.message}`);
    }
  }

  // --- 2. Validate n8n Webhook URL ---
  const webhookUrl = process.env.ALIADO_WEBHOOK_URL || process.env.ALIADO_N8N_WEBHOOK_URL;
  if (!webhookUrl) {
    diagnostics.n8n.status = 'error';
    diagnostics.n8n.errors.push('ALIADO_WEBHOOK_URL (o ALIADO_N8N_WEBHOOK_URL) no está configurado en variables de entorno de Vercel');
  } else {
    diagnostics.n8n.webhookUrl = webhookUrl.replace(/\/[^\/]+$/, '/***'); // Ocultar ID del webhook en respuesta

    // 2a. Verificar que sea URL de PRODUCCIÓN (no "Test")
    const isTestUrl = webhookUrl.includes('/webhook-test/') || webhookUrl.includes('/test/');
    diagnostics.n8n.isProduction = !isTestUrl;

    if (isTestUrl) {
      diagnostics.n8n.status = 'warning';
      diagnostics.n8n.errors.push(
        '🚨 CRÍTICO: Estás usando la URL de PRUEBA (webhook-test). ' +
        'Esta URL SOLO funciona cuando el workflow está abierto en n8n. ' +
        'Cambia a la URL de PRODUCCIÓN (/webhook/) para disponibilidad 24/7.'
      );
      diagnostics.n8n.fix = 'En n8n, activa el workflow (toggle ON), luego copia la URL de "Production" del nodo Webhook.';
    }

    // 2b. Test de conectividad al webhook
    try {
      const testPayload = {
        test: true,
        source: 'aliado_resico_diagnostics',
        version: '2.5',
        timestamp: new Date().toISOString(),
        action: 'connectivity_check',
      };

      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Source': 'aliado-resico-diagnostics',
          'X-Version': '2.5',
        },
        body: JSON.stringify(testPayload),
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (webhookRes.ok) {
        diagnostics.n8n.status = isTestUrl ? 'warning' : 'connected';
        diagnostics.n8n.responseStatus = webhookRes.status;
      } else {
        diagnostics.n8n.status = 'error';
        diagnostics.n8n.responseStatus = webhookRes.status;
        diagnostics.n8n.errors.push(
          `n8n respondió con HTTP ${webhookRes.status}. ` +
          (webhookRes.status === 404 ? 'Verifica que el workflow esté ACTIVO (toggle ON).' :
           webhookRes.status === 500 ? 'Error interno en n8n. Revisa los logs del workflow.' :
           'Verifica la URL del webhook.')
        );
      }
    } catch (err) {
      diagnostics.n8n.status = 'unreachable';
      diagnostics.n8n.errors.push(
        `No se pudo conectar al webhook: ${err.message}. ` +
        'Verifica que n8n esté encendido y el workflow esté activo.'
      );
    }
  }

  // --- 3. Verificar consistencia Telegram Webhook → n8n ---
  if (diagnostics.telegram.webhookInfo?.url && webhookUrl) {
    const telegramWebhookUrl = diagnostics.telegram.webhookInfo.url;

    // Si Telegram tiene un webhook configurado, verificar que apunte a n8n
    if (telegramWebhookUrl && !telegramWebhookUrl.includes('n8n') && !telegramWebhookUrl.includes('webhook')) {
      diagnostics.n8n.errors.push(
        '⚠️ El webhook de Telegram NO parece apuntar a n8n. ' +
        'Asegúrate de que el nodo "Telegram Trigger" en n8n esté configurado correctamente.'
      );
    }
  }

  // --- 4. Setup: Registrar webhook de Telegram si se pide ---
  if (req.method === 'POST' && req.body?.action === 'setup_webhook') {
    const n8nWebhookForTelegram = req.body.telegram_webhook_url || webhookUrl;
    if (botToken && n8nWebhookForTelegram) {
      try {
        const setWebhookRes = await fetch(
          `https://api.telegram.org/bot${botToken}/setWebhook`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: n8nWebhookForTelegram,
              allowed_updates: ['message', 'callback_query'],
              drop_pending_updates: req.body.drop_pending || false,
            }),
          }
        );
        const setResult = await setWebhookRes.json();
        diagnostics.setup = {
          action: 'setWebhook',
          success: setResult.ok,
          description: setResult.description,
          url_set: n8nWebhookForTelegram.replace(/\/[^\/]+$/, '/***'),
        };
      } catch (err) {
        diagnostics.setup = {
          action: 'setWebhook',
          success: false,
          error: err.message,
        };
      }
    } else {
      diagnostics.setup = {
        action: 'setWebhook',
        success: false,
        error: 'Faltan ALIADO_TELEGRAM_BOT_TOKEN o telegram_webhook_url en el body',
      };
    }
  }

  // --- Overall Status ---
  const telegramOk = diagnostics.telegram.status === 'connected';
  const n8nOk = diagnostics.n8n.status === 'connected';

  if (telegramOk && n8nOk) {
    diagnostics.overall = 'healthy';
  } else if (telegramOk || n8nOk) {
    diagnostics.overall = 'partial';
  } else {
    diagnostics.overall = 'down';
  }

  // --- Production Checklist ---
  diagnostics.checklist = {
    telegram_token_valid: diagnostics.telegram.status === 'connected',
    telegram_webhook_set: !!diagnostics.telegram.webhookInfo?.url && diagnostics.telegram.webhookInfo.url !== '(no webhook set)',
    n8n_webhook_reachable: diagnostics.n8n.status === 'connected' || diagnostics.n8n.status === 'warning',
    n8n_is_production_url: diagnostics.n8n.isProduction === true,
    no_pending_errors: diagnostics.telegram.errors.length === 0 && diagnostics.n8n.errors.length === 0,
  };

  const httpStatus = diagnostics.overall === 'healthy' ? 200 : diagnostics.overall === 'partial' ? 207 : 503;
  return res.status(httpStatus).json(diagnostics);
}
