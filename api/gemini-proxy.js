import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

const AI_STUDIO_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const VERTEX_MODEL = process.env.VERTEX_MODEL || 'gemini-2.0-flash-001';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  '';

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

const JSON_CONTRACT = [
  'Responde SOLO JSON válido sin markdown ni texto extra.',
  'Usa exactamente estas llaves:',
  '{',
  '  "respuestaFiscal": "string",',
  '  "fundamentoLegal": "string",',
  '  "diferenciacionIsrIva": "string",',
  '  "accionConcreta": "string",',
  '  "solicitudDatoFaltante": "string opcional o vacío"',
  '}',
  'Reglas obligatorias:',
  '- Español mexicano claro.',
  '- Nunca respondas "Consulta recibida".',
  '- En RESICO PF el límite anual es $3,500,000 MXN.',
  '- Alerta 80%: $2,800,000 MXN; 90%: $3,150,000 MXN; 94%: $3,290,000 MXN.',
  '- Declaración anual obligatoria si salarios > $400,000 MXN o intereses reales > $100,000 MXN.',
  '- ISR RESICO: sobre ingresos brutos efectivamente cobrados, sin deducciones de gastos.',
  '- IVA: acreditable solo con CFDI válido y gasto indispensable para la actividad.',
  '- Si faltan datos, usa solicitudDatoFaltante y no inventes hechos.',
  '- Cita fundamento aplicable: Art. 113-E o 113-F LISR, Art. 17-K CFF u otro aplicable.'
].join('\n');

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
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function buildPrompt(body) {
  const message = String(body?.message || '').trim();
  if (!message) return null;

  const ctx = body?.context || {};
  const lines = [
    ctx?.userEmail ? `Usuario: ${ctx.userEmail}` : '',
    ctx?.incomeYTD != null ? `Ingresos acumulados actuales: $${Number(ctx.incomeYTD || 0).toLocaleString('es-MX')} MXN` : '',
    ctx?.annualLimit != null ? `Límite anual: $${Number(ctx.annualLimit || 3500000).toLocaleString('es-MX')} MXN` : '',
    ctx?.riskLevel ? `Nivel de riesgo actual: ${ctx.riskLevel}` : '',
    ctx?.isDemo ? 'Modo: DEMO' : 'Modo: PRODUCCIÓN'
  ].filter(Boolean);

  return [
    'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
    JSON_CONTRACT,
    '',
    lines.length ? `Contexto fiscal del usuario:\n${lines.join('\n')}` : '',
    '',
    `Consulta del usuario: ${message}`
  ].filter(Boolean).join('\n\n');
}

function renderReply(structured) {
  return [
    structured.respuestaFiscal || '',
    structured.fundamentoLegal ? `Fundamento legal: ${structured.fundamentoLegal}` : '',
    structured.diferenciacionIsrIva ? `ISR vs IVA: ${structured.diferenciacionIsrIva}` : '',
    structured.accionConcreta ? `Acción concreta: ${structured.accionConcreta}` : '',
    structured.solicitudDatoFaltante ? `Dato faltante: ${structured.solicitudDatoFaltante}` : ''
  ].filter(Boolean).join('\n\n').trim();
}

function fallbackStructured(reason) {
  if (reason === 'quota_exhausted') {
    return {
      respuestaFiscal: 'El servicio de IA está temporalmente limitado, pero tu consulta sí fue recibida y puede seguirse atendiendo con reglas fiscales base.',
      fundamentoLegal: 'Art. 113-E LISR para límite RESICO y Art. 17-K CFF para Buzón Tributario.',
      diferenciacionIsrIva: 'ISR RESICO se calcula sobre ingresos brutos efectivamente cobrados; el IVA solo se acredita con CFDI válido y gasto indispensable.',
      accionConcreta: 'Continúa capturando ingresos, valida tu Buzón Tributario y conserva CFDI de gastos para IVA.',
      solicitudDatoFaltante: ''
    };
  }

  return {
    respuestaFiscal: 'La IA no está disponible en este momento, pero la operación del sistema debe continuar con reglas fiscales base.',
    fundamentoLegal: 'Art. 113-E LISR y Art. 17-K CFF.',
    diferenciacionIsrIva: 'ISR RESICO: ingresos brutos cobrados, sin deducción de gastos. IVA: acreditamiento solo con CFDI válido y gasto indispensable.',
    accionConcreta: 'Monitorea tus ingresos acumulados, mantén activo el Buzón Tributario y conserva tus CFDI.',
    solicitudDatoFaltante: ''
  };
}

function fallbackPayload(reason, debug = {}, provider = 'fallback', model = null) {
  const structured = fallbackStructured(reason);
  return {
    ok: true,
    is_fallback: true,
    fallback_reason: reason,
    provider,
    model,
    structured,
    respuestaFiscal: structured.respuestaFiscal,
    fundamentoLegal: structured.fundamentoLegal,
    diferenciacionIsrIva: structured.diferenciacionIsrIva,
    accionConcreta: structured.accionConcreta,
    solicitudDatoFaltante: structured.solicitudDatoFaltante,
    reply: renderReply(structured),
    debug,
    raw: null
  };
}

function extractGeminiText(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('\n')
      .trim() || ''
  );
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonBlock(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeStructured(obj, fallbackText = '') {
  if (!obj || typeof obj !== 'object') {
    const base = fallbackStructured('empty_response');
    base.respuestaFiscal = fallbackText || base.respuestaFiscal;
    return base;
  }

  const normalized = {
    respuestaFiscal: String(
      obj.respuestaFiscal ||
      obj.respuesta_fiscal ||
      obj.respuesta ||
      obj.reply ||
      ''
    ).trim(),
    fundamentoLegal: String(
      obj.fundamentoLegal ||
      obj.fundamento_legal ||
      obj.fundamento ||
      ''
    ).trim(),
    diferenciacionIsrIva: String(
      obj.diferenciacionIsrIva ||
      obj.diferenciacion_ISR_IVA ||
      obj.isrVsIva ||
      ''
    ).trim(),
    accionConcreta: String(
      obj.accionConcreta ||
      obj.accion_concreta ||
      obj.accion ||
      ''
    ).trim(),
    solicitudDatoFaltante: String(
      obj.solicitudDatoFaltante ||
      obj.solicitud_dato_faltante ||
      ''
    ).trim()
  };

  if (!normalized.respuestaFiscal) {
    normalized.respuestaFiscal = fallbackText || fallbackStructured('empty_response').respuestaFiscal;
  }

  if (!normalized.fundamentoLegal) {
    normalized.fundamentoLegal = 'Art. 113-E LISR y, en su caso, Art. 17-K CFF.';
  }

  if (!normalized.diferenciacionIsrIva) {
    normalized.diferenciacionIsrIva =
      'ISR RESICO: sobre ingresos brutos cobrados, sin deducción de gastos. IVA: acreditamiento solo con CFDI válido y gasto indispensable.';
  }

  if (!normalized.accionConcreta) {
    normalized.accionConcreta = 'Confirma tus ingresos acumulados, tu Buzón Tributario y tus CFDI vigentes.';
  }

  return normalized;
}

function parseStructuredModelOutput(text) {
  if (!text) return fallbackStructured('empty_response');

  const direct = safeJsonParse(text);
  if (direct) return normalizeStructured(direct, text);

  const block = extractJsonBlock(text);
  if (block) {
    const parsed = safeJsonParse(block);
    if (parsed) return normalizeStructured(parsed, text);
  }

  return normalizeStructured({ respuestaFiscal: text }, text);
}

function mapUpstreamReason(status, data) {
  const code = data?.error?.code || status;
  if (code === 429) return 'quota_exhausted';
  if (code === 404) return 'model_unavailable';
  if (code === 401 || code === 403) return 'auth_error';
  if (code === 503) return 'service_unavailable';
  return 'api_error';
}

async function callWithRetry(doRequest) {
  const RETRY_DELAY_MS = 1200;

  for (let attempt = 0; attempt <= 1; attempt++) {
    const result = await doRequest();
    const status = result?.status || 500;

    if (status >= 200 && status < 300) {
      return { ...result, retried: attempt > 0 };
    }

    if ((status === 429 || status === 503) && attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      continue;
    }

    return { ...result, retried: attempt > 0 };
  }

  return { status: 500, data: {}, retried: false };
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getServiceAccountEmail() {
  return (
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    ''
  );
}

function getServiceAccountPrivateKey() {
  return (
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ||
    process.env.GOOGLE_PRIVATE_KEY ||
    ''
  ).replace(/\\n/g, '\n');
}

function canUseVertex() {
  return Boolean(
    VERTEX_PROJECT_ID &&
    VERTEX_LOCATION &&
    getServiceAccountEmail() &&
    getServiceAccountPrivateKey()
  );
}

async function getGoogleAccessToken() {
  const clientEmail = getServiceAccountEmail();
  const privateKey = getServiceAccountPrivateKey();

  if (!clientEmail || !privateKey) {
    throw new Error('missing_service_account_credentials');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedClaimSet = base64url(JSON.stringify(claimSet));
  const signingInput = `${encodedHeader}.${encodedClaimSet}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const assertion = `${signingInput}.${signature}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || 'oauth_token_error');
  }

  return data.access_token;
}

function buildGeminiPayload(prompt) {
  return {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 900,
      responseMimeType: 'application/json'
    }
  };
}

async function callAiStudio(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('missing_gemini_api_key');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${AI_STUDIO_MODEL}:generateContent?key=${apiKey}`;
  const payload = buildGeminiPayload(prompt);

  return callWithRetry(async () => {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json().catch(() => ({}));
    return { status: upstream.status, data, provider: 'ai-studio', model: AI_STUDIO_MODEL };
  });
}

async function callVertex(prompt) {
  const accessToken = await getGoogleAccessToken();
  const endpoint =
    `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}` +
    `/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;

  const payload = buildGeminiPayload(prompt);

  return callWithRetry(async () => {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json().catch(() => ({}));
    return { status: upstream.status, data, provider: 'vertex-ai', model: VERTEX_MODEL };
  });
}

async function callProvider(prompt) {
  if (canUseVertex()) {
    try {
      return await callVertex(prompt);
    } catch (err) {
      if (process.env.GEMINI_API_KEY) {
        return await callAiStudio(prompt);
      }
      throw err;
    }
  }

  return await callAiStudio(prompt);
}

export default async function handler(req, res) {
  setSecureHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  const origin = req.headers.origin || '';
  if (origin && !resolveOrigin(origin)) {
    sendJson(res, 403, { ok: false, error: 'Origin no autorizado' });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    sendJson(res, 400, { ok: false, error: 'Body inválido: se espera JSON.' });
    return;
  }

  const prompt = buildPrompt(body);
  if (!prompt) {
    sendJson(res, 400, { ok: false, error: 'Falta message.' });
    return;
  }

  const debugEnabled = process.env.ALIADO_AI_DEBUG === 'true';
  const messageNormalized = normalizeText(body?.message || '');

  if (['hola', 'buenas', 'buen dia', 'buen día', 'gracias', 'ok', 'okay'].includes(messageNormalized)) {
    const structured = {
      respuestaFiscal: 'Estoy listo para ayudarte con tu operación fiscal RESICO 2026.',
      fundamentoLegal: 'Orientación general de cumplimiento RESICO 2026.',
      diferenciacionIsrIva: 'ISR RESICO: ingresos brutos cobrados. IVA: acreditamiento con CFDI válido y gasto indispensable.',
      accionConcreta: 'Escribe tu consulta específica sobre ISR, IVA, CFDI, e.firma o declaración anual.',
      solicitudDatoFaltante: ''
    };

    sendJson(
      res,
      200,
      {
        ok: true,
        is_fallback: false,
        fallback_reason: null,
        provider: 'local-fastpath',
        model: 'none',
        structured,
        respuestaFiscal: structured.respuestaFiscal,
        fundamentoLegal: structured.fundamentoLegal,
        diferenciacionIsrIva: structured.diferenciacionIsrIva,
        accionConcreta: structured.accionConcreta,
        solicitudDatoFaltante: structured.solicitudDatoFaltante,
        reply: renderReply(structured),
        debug: debugEnabled ? { fastPath: true } : undefined,
        raw: null
      },
      {
        'x-aliado-ai-status': 'ok',
        'x-aliado-provider': 'local-fastpath'
      }
    );
    return;
  }

  try {
    const result = await callProvider(prompt);
    const { status, data, retried, provider, model } = result;

    if (!(status >= 200 && status < 300)) {
      const reason = mapUpstreamReason(status, data);
      const payload = fallbackPayload(
        reason,
        debugEnabled ? { upstream_status: status, upstream_data: data, retried } : {},
        provider,
        model
      );

      sendJson(res, 200, payload, {
        'x-aliado-ai-status': 'fallback',
        'x-aliado-fallback-reason': reason,
        'x-aliado-provider': provider
      });
      return;
    }

    const rawText = extractGeminiText(data);
    const structured = parseStructuredModelOutput(rawText);

    const payload = {
      ok: true,
      is_fallback: false,
      fallback_reason: null,
      provider,
      model,
      structured,
      respuestaFiscal: structured.respuestaFiscal,
      fundamentoLegal: structured.fundamentoLegal,
      diferenciacionIsrIva: structured.diferenciacionIsrIva,
      accionConcreta: structured.accionConcreta,
      solicitudDatoFaltante: structured.solicitudDatoFaltante,
      reply: renderReply(structured),
      debug: debugEnabled ? { upstream_status: status, retried } : undefined,
      raw: data
    };

    sendJson(res, 200, payload, {
      'x-aliado-ai-status': 'ok',
      'x-aliado-provider': provider
    });
  } catch (err) {
    const payload = fallbackPayload(
      'network_error',
      debugEnabled ? { error_message: err?.message || 'unknown_network_error' } : {},
      'proxy',
      null
    );

    sendJson(res, 200, payload, {
      'x-aliado-ai-status': 'fallback',
      'x-aliado-fallback-reason': 'network_error',
      'x-aliado-provider': 'proxy'
    });
  }
}