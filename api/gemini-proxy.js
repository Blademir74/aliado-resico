// api/gemini-proxy.js — Aliado RESICO 2026
// VERSIÓN PRODUCCIÓN ESTABLE
// El proxy NO valida JWT aquí — la autenticación la maneja Supabase RLS en el frontend.
// El proxy es un secreto de backend: la GEMINI_API_KEY nunca se expone al cliente.

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// CORS: Lista blanca de orígenes permitidos
const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'https://www.aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:5501',
  'http://127.0.0.1:5501'
];

// Prompt de sistema — RESICO 2026 con formato JSON estructurado
// FIX: El bot ya NO responde "Consulta recibida" — devuelve análisis fiscal accionable
const SYSTEM_TEXT = [
  'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
  'Responde SIEMPRE en español mexicano, claro y accionable.',
  '',
  'FORMATO OBLIGATORIO DE RESPUESTA (texto plano, no JSON, fácil de leer):',
  '📋 RESPUESTA FISCAL:',
  '[Respuesta directa a la consulta del usuario]',
  '',
  '⚖️ FUNDAMENTO LEGAL:',
  '[Artículo exacto: LISR Art. 113-E/F, CFF Art. 17-K, RMF vigente u otro aplicable]',
  '',
  '💡 ISR vs IVA:',
  '• ISR RESICO: tasa fija sobre ingresos BRUTOS efectivamente cobrados, SIN deducciones de gastos.',
  '• IVA: SOLO acreditable con CFDI válido de proveedor y gasto INDISPENSABLE para la actividad.',
  '',
  '✅ ACCIÓN CONCRETA:',
  '[Paso específico que el usuario debe hacer HOY]',
  '',
  'REGLAS ABSOLUTAS (nunca omitir ni contradecir):',
  '- Límite anual RESICO PF: $3,500,000 MXN (Art. 113-E LISR).',
  '- Umbrales de alerta: 80% = $2,800,000 MXN (preventivo), 90% = $3,150,000 MXN (riesgo alto), 94% = $3,290,000 MXN (expulsión inminente).',
  '- Buzón Tributario inactivo: multa hasta $10,260 MXN (Art. 17-K CFF) + pérdida de plazos legales.',
  '- Declaración Anual OBLIGATORIA si: salarios > $400,000 MXN O intereses reales > $100,000 MXN (Art. 113-F LISR).',
  '- ISR RESICO: sin deducción de gastos, solo sobre ingresos brutos cobrados.',
  '- IVA acreditable: requiere CFDI 4.0 válido, gasto indispensable y timbrado correcto.',
  '- Si faltan datos para concluir: solicita el dato específico antes de dar un dictamen.',
  '- NUNCA decir "Consulta recibida" como respuesta — siempre dar análisis de valor.',
  '- NUNCA inventar montos, fechas ni artículos que no existan en la LISR o CFF vigente 2026.'
].join('\n');

// ── Utilidades ───────────────────────────────────────────────

function resolveOrigin(origin = '') {
  if (!origin) return ALLOWED_ORIGINS[0];
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function setSecureHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowed = resolveOrigin(origin);
  if (allowed) {
    res.setHeader('Access-Control-Allow-Origin', allowed);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function sendJson(res, status, payload, headers = {}) {
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(payload));
}

function extractReply(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('\n')
      .trim() || ''
  );
}

function fallbackPayload(reason, hint, debug = {}) {
  const reply =
    hint ||
    '📋 RESPUESTA FISCAL:\nEn RESICO 2026 el ISR se aplica sobre ingresos brutos cobrados (sin deducciones). El límite anual es $3,500,000 MXN. La IA no está disponible en este momento.\n\n⚖️ FUNDAMENTO LEGAL:\nArt. 113-E LISR — Régimen Simplificado de Confianza.\n\n💡 ISR vs IVA:\n• ISR RESICO: tasa fija sobre ingresos BRUTOS, sin deducciones.\n• IVA: acreditable SOLO con CFDI válido y gasto indispensable.\n\n✅ ACCIÓN CONCRETA:\nVerifica tu Buzón Tributario activo (Art. 17-K CFF) y monitorea tus ingresos acumulados.';
  return {
    ok: true,
    is_fallback: true,
    fallback_reason: reason,
    reply,
    source: 'gemini-proxy',
    model: GEMINI_MODEL,
    debug,
    raw: {
      candidates: [
        {
          content: { parts: [{ text: reply }] },
          finishReason: 'FALLBACK'
        }
      ]
    }
  };
}

function buildContents(body) {
  if (Array.isArray(body?.contents) && body.contents.length) return body.contents;

  const message = String(body?.message || '').trim();
  if (!message) return null;

  const ctx = body?.context || {};
  const lines = [
    ctx?.userEmail ? `Usuario: ${ctx.userEmail}` : '',
    ctx?.incomeYTD != null ? `Ingresos acumulados: $${Number(ctx.incomeYTD).toLocaleString('es-MX')} MXN` : '',
    ctx?.annualLimit != null ? `Límite anual: $${Number(ctx.annualLimit).toLocaleString('es-MX')} MXN` : '',
    ctx?.riskLevel ? `Nivel de riesgo: ${ctx.riskLevel}` : '',
    ctx?.isDemo ? 'Modo: DEMO' : 'Modo: CUENTA REAL'
  ].filter(Boolean);

  return [
    {
      role: 'user',
      parts: [
        {
          text: [
            lines.length ? `Contexto fiscal del usuario:\n${lines.join('\n')}\n` : '',
            `Consulta: ${message}`
          ].join('\n')
        }
      ]
    }
  ];
}

// Retry único ante 429 / 503
async function callGeminiWithRetry(endpoint, apiKey, payload) {
  const RETRY_DELAY_MS = 1200;

  for (let attempt = 0; attempt <= 1; attempt++) {
    const upstream = await fetch(`${endpoint}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json().catch(() => ({}));

    if (upstream.ok) return { upstream, data, retried: attempt > 0 };

    const code = data?.error?.code || upstream.status;
    if ((code === 429 || code === 503) && attempt === 0) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }

    return { upstream, data, retried: attempt > 0 };
  }
}

// ── Handler principal ────────────────────────────────────────

export default async function handler(req, res) {
  setSecureHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  // CORS check — rechazar orígenes no autorizados en producción
  const origin = req.headers.origin || '';
  if (origin && !resolveOrigin(origin)) {
    return sendJson(res, 403, { ok: false, error: 'Origin no autorizado' });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // Debug solo por variable de entorno
  const debugEnabled = process.env.ALIADO_AI_DEBUG === 'true';

  if (!apiKey) {
    const payload = fallbackPayload('missing_api_key', null, { env: 'GEMINI_API_KEY absent' });
    return sendJson(res, 200, payload, {
      'x-aliado-ai-status': 'fallback',
      'x-aliado-fallback-reason': 'missing_api_key'
    });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : null;
  if (!body) {
    return sendJson(res, 400, { ok: false, error: 'Body inválido: se espera JSON.' });
  }

  const contents = buildContents(body);
  if (!contents) {
    return sendJson(res, 400, { ok: false, error: 'Falta message o contents.' });
  }

  const payload = {
    contents,
    system_instruction: {
      parts: [{ text: SYSTEM_TEXT }]
    },
    generationConfig: {
      temperature: 0.30,
      topP: 0.9,
      maxOutputTokens: 900
    }
  };

  try {
    const { upstream, data, retried } = await callGeminiWithRetry(
      GEMINI_ENDPOINT,
      apiKey,
      payload
    );

    if (!upstream.ok) {
      const code = data?.error?.code || upstream.status;
      const message = data?.error?.message || `HTTP ${upstream.status}`;
      const reason =
        code === 429 ? 'quota_exhausted' :
        code === 404 ? 'model_unavailable' :
        code === 503 ? 'service_unavailable' :
        'api_error';

      const fb = fallbackPayload(
        reason,
        null,
        debugEnabled ? { upstream_status: upstream.status, upstream_code: code, upstream_message: message, retried } : {}
      );
      return sendJson(res, 200, fb, {
        'x-aliado-ai-status': 'fallback',
        'x-aliado-fallback-reason': reason
      });
    }

    const reply = extractReply(data);
    if (!reply) {
      const fb = fallbackPayload('empty_response', null, { upstream_status: upstream.status });
      return sendJson(res, 200, fb, {
        'x-aliado-ai-status': 'fallback',
        'x-aliado-fallback-reason': 'empty_response'
      });
    }

    return sendJson(
      res,
      200,
      {
        ok: true,
        is_fallback: false,
        fallback_reason: null,
        reply,
        source: 'gemini-proxy',
        model: GEMINI_MODEL,
        debug: debugEnabled ? { upstream_status: upstream.status, retried } : undefined,
        raw: data
      },
      {
        'x-aliado-ai-status': 'ok'
      }
    );
  } catch (err) {
    const fb = fallbackPayload(
      'network_error',
      null,
      debugEnabled ? { error_message: err?.message || 'unknown_network_error' } : {}
    );
    return sendJson(res, 200, fb, {
      'x-aliado-ai-status': 'fallback',
      'x-aliado-fallback-reason': 'network_error'
    });
  }
}
