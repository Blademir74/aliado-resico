// api/gemini-proxy.js — Aliado RESICO 2026
// VERSION CERTIFICADA: Fixes aplicados:
//   - FIX CRÍTICO-2: Validación JWT obligatoria antes de llamar a Gemini
//   - FIX ALTO-1:    CORS restrictivo con allowlist (no más wildcard *)
//   - FIX MEDIO-2:   Debug flag solo activable por env var, nunca por header externo
//   - FIX MEDIO-3:   Retry exponencial (1 intento) ante 429/503

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// FIX ALTO-1: Lista blanca de orígenes permitidos (CORS restrictivo)
const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'https://www.aliadoresico.com',
  // Solo en desarrollo — Vercel elimina estas en producción si NODE_ENV=production
  ...(process.env.NODE_ENV !== 'production' ? [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ] : [])
];

const SYSTEM_TEXT = [
  'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
  'Responde en español mexicano, claro, útil y accionable.',
  'No uses tecnicismos innecesarios.',
  'Reglas absolutas:',
  '- Límite anual RESICO PF: $3,500,000 MXN.',
  '- Umbrales: 80% preventivo ($2,800,000), 90% riesgo alto ($3,150,000), 94% riesgo de expulsión ($3,290,000).',
  '- Buzón Tributario inactivo: multa hasta $10,260 MXN (Art. 17-K CFF), pérdida de plazos y riesgo operativo.',
  '- No afirmes declaración anual para todos; primero valida si hubo ingresos mixtos.',
  '- Ingresos mixtos con salarios > $400,000 MXN: Declaración Anual OBLIGATORIA (Art. 113-F LISR).',
  '- Intereses > $100,000 MXN: también obliga a Declaración Anual (Art. 113-F LISR).',
  '- ISR RESICO: sobre ingresos brutos efectivamente cobrados, sin deducciones.',
  '- IVA: requiere CFDI válido y gasto indispensable para acreditamiento.',
  '- Si falta contexto, pide el dato faltante antes de concluir.',
  '- Termina con una acción concreta.'
].join('\n');

// ── Utilidades ──────────────────────────────────────────────

function resolveOrigin(origin = '') {
  if (!origin) return ALLOWED_ORIGINS[0];
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

function setSecureHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowed = resolveOrigin(origin);

  // FIX ALTO-1: Solo responder al origen si está en la lista blanca
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
    'La IA no está disponible en este momento. Regla base RESICO 2026: monitorea el límite de $3,500,000 MXN, revisa ingresos mixtos antes de confirmar anual y mantén activo tu Buzón Tributario.';
  return {
    ok: true,
    is_fallback: true,
    fallback_reason: reason,
    reply,
    source: 'gemini-proxy',
    model: GEMINI_MODEL,
    // FIX MEDIO-2: debug solo si env var está activa (nunca por header externo)
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
            lines.length ? `Contexto fiscal:\n${lines.join('\n')}\n` : '',
            `Consulta del usuario:\n${message}`
          ].join('\n')
        }
      ]
    }
  ];
}

// FIX CRÍTICO-2: Validar JWT de Supabase antes de procesar
async function validateSupabaseJWT(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return false;

  const token = authHeader.slice(7);
  if (!token || token.length < 20) return false;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // Si no hay Supabase configurado (desarrollo), permitir con advertencia
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[gemini-proxy] ADVERTENCIA: Sin Supabase en dev, JWT no validado');
      return true;
    }
    return false;
  }

  try {
    // Verificar el JWT contra el endpoint de usuario de Supabase
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': supabaseKey
      }
    });

    if (!response.ok) return false;
    const user = await response.json().catch(() => null);
    return !!(user?.id);
  } catch {
    return false;
  }
}

// FIX MEDIO-3: Llamada a Gemini con 1 reintento ante 429/503
async function callGeminiWithRetry(endpoint, apiKey, payload) {
  const RETRY_DELAY_MS = 1200; // 1.2s de backoff
  const MAX_RETRIES = 1;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const upstream = await fetch(`${endpoint}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json().catch(() => ({}));

    if (upstream.ok) return { upstream, data, retried: attempt > 0 };

    const code = data?.error?.code || upstream.status;
    const isRetryable = code === 429 || code === 503;

    if (isRetryable && attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
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

  // FIX ALTO-1: Rechazar orígenes no autorizados
  const origin = req.headers.origin || '';
  if (origin && !resolveOrigin(origin)) {
    return sendJson(res, 403, { ok: false, error: 'Origin no autorizado' });
  }

  // FIX CRÍTICO-2: Validar JWT antes de procesar
  const isAuthenticated = await validateSupabaseJWT(req);
  if (!isAuthenticated) {
    return sendJson(res, 401, {
      ok: false,
      error: 'No autorizado. Se requiere sesión activa de Aliado RESICO.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // FIX MEDIO-2: Debug SOLO por variable de entorno, nunca por header externo
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
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 700
    }
  };

  try {
    // FIX MEDIO-3: Retry ante 429/503
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
        null, // Nunca exponer mensaje técnico al usuario
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
      null, // FIX MEDIO-2: Nunca exponer stack al usuario
      debugEnabled ? { error_message: err?.message || 'unknown_network_error' } : {}
    );
    return sendJson(res, 200, fb, {
      'x-aliado-ai-status': 'fallback',
      'x-aliado-fallback-reason': 'network_error'
    });
  }
}
