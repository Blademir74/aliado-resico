/**
 * ALIADO RESICO — Gemini Proxy v3.1 (Vertex AI Certificado)
 * Fix v3.1: Corrección de llaves de cierre + Retry Exponencial 3 intentos
 *
 * Variables de entorno requeridas en Vercel:
 *   VERTEX_PROJECT_ID, VERTEX_LOCATION, VERTEX_MODEL
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 *   SUPABASE_JWT_SECRET
 *   GEMINI_API_KEY  (fallback opcional)
 *   ALIADO_AI_DEBUG (opcional, 'true' para logs extendidos)
 */

import crypto from 'node:crypto';

export const config = { runtime: 'nodejs' };

// ── Constantes ─────────────────────────────────────────────────────────────
const VERTEX_MODEL     = process.env.VERTEX_MODEL    || 'gemini-2.0-flash-001';
const VERTEX_LOCATION  = process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_PROJECT_ID =
  process.env.VERTEX_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT || '';

const AI_STUDIO_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

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

// System prompt con reglas fiscales RESICO 2026 + Art. 113-F
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
  '- En RESICO PF el límite anual es $3,500,000 MXN (Art. 113-E LISR).',
  '- Alerta 80%: $2,800,000; 90%: $3,150,000; 94%: $3,290,000 MXN.',
  '- Art. 113-F LISR: Declaración anual OBLIGATORIA si salarios > $400,000 MXN ' +
    'O intereses reales > $100,000 MXN. Citar siempre este artículo.',
  '- Buzón Tributario inactivo: multa hasta $10,260 MXN (Art. 17-K CFF).',
  '- ISR RESICO: sobre ingresos brutos efectivamente cobrados, sin deducciones.',
  '- IVA: acreditable solo con CFDI válido y gasto indispensable.',
  '- Si faltan datos, usa solicitudDatoFaltante y no inventes hechos.',
].join('\n');

// ── Cache del token de Vertex AI (TTL 55 min) ──────────────────────────────
const _tokenCache = { token: null, expiresAt: 0 };

// ── Helpers CORS / respuesta ───────────────────────────────────────────────
function resolveOrigin(origin = '') {
  if (!origin) return ALLOWED_ORIGINS[0];
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
} // ← LLAVE CRÍTICA CORREGIDA

function setSecureHeaders(req, res) {
  const origin  = req.headers.origin || '';
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
} // ← LLAVE CRÍTICA CORREGIDA

function sendJson(res, status, payload, extraHeaders = {}) {
  Object.entries(extraHeaders).forEach(([k, v]) => res.setHeader(k, v));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
} // ← LLAVE CRÍTICA CORREGIDA

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  return null;
} // ← LLAVE CRÍTICA CORREGIDA

// ── Validación JWT de Supabase (HMAC-SHA256, sin dependencias) ─────────────
async function validateSupabaseJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;

  const jwtSecret = process.env.SUPABASE_JWT_SECRET || '';

  // Modo desarrollo sin secret (NUNCA en producción)
  if (!jwtSecret) {
    console.warn('[gemini-proxy] SUPABASE_JWT_SECRET no configurado. Verificación OFF.');
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return { uid: payload.sub || null, email: payload.email || null };
    } catch { return null; }
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Verificación HMAC-SHA256 en tiempo constante
    const key         = crypto.createHmac('sha256', jwtSecret);
    key.update(signingInput);
    const expectedSig = key.digest('base64url');

    const sigBuf      = Buffer.from(encodedSig,   'base64url');
    const expBuf      = Buffer.from(expectedSig,  'base64url');

    // Padding para timingSafeEqual (requiere misma longitud)
    if (sigBuf.length !== expBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role === 'service_role') return null; // Bloquear service_role

    return { uid: payload.sub || null, email: payload.email || null };
  } catch { return null; }
}

// ── Construcción de prompt ─────────────────────────────────────────────────
function buildPrompt(body) {
  const message = String(body?.message || '').trim();
  if (!message) return null;

  const ctx   = body?.context || {};
  const lines = [
    ctx?.userEmail   ? `Usuario: ${ctx.userEmail}` : '',
    ctx?.incomeYTD  != null ? `Ingresos acumulados: $${Number(ctx.incomeYTD || 0).toLocaleString('es-MX')} MXN` : '',
    ctx?.annualLimit != null ? `Límite anual: $${Number(ctx.annualLimit || 3500000).toLocaleString('es-MX')} MXN` : '',
    ctx?.riskLevel   ? `Nivel de riesgo: ${ctx.riskLevel}` : '',
    ctx?.isDemo      ? 'Modo: DEMO' : 'Modo: PRODUCCIÓN'
  ].filter(Boolean);

  return [
    'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
    JSON_CONTRACT,
    lines.length ? `Contexto fiscal:\n${lines.join('\n')}` : '',
    `Consulta: ${message}`
  ].filter(Boolean).join('\n\n');
}

// ── Parseo de respuesta Gemini ─────────────────────────────────────────────
function extractGeminiText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map(p => p?.text || '').join('\n').trim() || '';
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function extractJsonBlock(text) {
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function fallbackStructured(reason) {
  const base = {
    fundamentoLegal:       'Art. 113-E LISR (límite RESICO $3,500,000 MXN) y Art. 17-K CFF.',
    diferenciacionIsrIva:  'ISR RESICO: ingresos brutos cobrados sin deducción. IVA: CFDI válido.',
    accionConcreta:        'Monitorea ingresos, valida Buzón Tributario y conserva CFDI de gastos.',
    solicitudDatoFaltante: ''
  };
  if (reason === 'quota_exhausted') {
    return { ...base, respuestaFiscal: 'El servicio de IA alcanzó su cuota. Sistema en modo contingencia.' };
  }
  return { ...base, respuestaFiscal: 'La IA no está disponible. Sistema en modo contingencia fiscal.' };
}

function normalizeStructured(obj, fallbackText = '') {
  if (!obj || typeof obj !== 'object') {
    const base = fallbackStructured('empty_response');
    base.respuestaFiscal = fallbackText || base.respuestaFiscal;
    return base;
  }
  const n = {
    respuestaFiscal:       String(obj.respuestaFiscal       || obj.respuesta || '').trim(),
    fundamentoLegal:       String(obj.fundamentoLegal       || '').trim(),
    diferenciacionIsrIva:  String(obj.diferenciacionIsrIva  || '').trim(),
    accionConcreta:        String(obj.accionConcreta        || '').trim(),
    solicitudDatoFaltante: String(obj.solicitudDatoFaltante || '').trim()
  };
  if (!n.respuestaFiscal)      n.respuestaFiscal      = fallbackText || fallbackStructured('empty_response').respuestaFiscal;
  if (!n.fundamentoLegal)      n.fundamentoLegal      = 'Art. 113-E LISR y Art. 17-K CFF.';
  if (!n.diferenciacionIsrIva) n.diferenciacionIsrIva = 'ISR RESICO: ingresos brutos. IVA: CFDI válido y gasto indispensable.';
  if (!n.accionConcreta)       n.accionConcreta       = 'Confirma ingresos, Buzón Tributario y CFDI vigentes.';
  return n;
}

function parseStructuredModelOutput(text) {
  if (!text) return fallbackStructured('empty_response');
  const direct = safeJsonParse(text);
  if (direct) return normalizeStructured(direct, text);
  const block = extractJsonBlock(text);
  if (block) { const p = safeJsonParse(block); if (p) return normalizeStructured(p, text); }
  return normalizeStructured({ respuestaFiscal: text }, text);
}

function renderReply(s) {
  return [
    s.respuestaFiscal,
    s.fundamentoLegal       ? `Fundamento legal: ${s.fundamentoLegal}`       : '',
    s.diferenciacionIsrIva  ? `ISR vs IVA: ${s.diferenciacionIsrIva}`        : '',
    s.accionConcreta        ? `Acción concreta: ${s.accionConcreta}`         : '',
    s.solicitudDatoFaltante ? `Dato faltante: ${s.solicitudDatoFaltante}`   : ''
  ].filter(Boolean).join('\n\n').trim();
}

function fallbackPayload(reason, debug = {}, provider = 'fallback', model = null) {
  const s = fallbackStructured(reason);
  return {
    ok: true, is_fallback: true, fallback_reason: reason,
    provider, model, structured: s,
    respuestaFiscal: s.respuestaFiscal, fundamentoLegal: s.fundamentoLegal,
    diferenciacionIsrIva: s.diferenciacionIsrIva, accionConcreta: s.accionConcreta,
    solicitudDatoFaltante: s.solicitudDatoFaltante,
    reply: renderReply(s), debug, raw: null
  };
}

function mapUpstreamReason(status, data) {
  const code = data?.error?.code || status;
  if (code === 429) return 'quota_exhausted';
  if (code === 404) return 'model_unavailable';
  if (code === 401 || code === 403) return 'auth_error';
  if (code === 503) return 'service_unavailable';
  return 'api_error';
}

// ── Google OAuth2: Service Account → Access Token (cache 55 min) ───────────
function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function getServiceAccountEmail() {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL || '';
}

function getServiceAccountPrivateKey() {
  return (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n');
}

function canUseVertex() {
  return Boolean(
    VERTEX_PROJECT_ID && VERTEX_LOCATION &&
    getServiceAccountEmail() && getServiceAccountPrivateKey()
  );
}

async function getGoogleAccessToken() {
  const now = Date.now();
  if (_tokenCache.token && _tokenCache.expiresAt > now + 300_000) {
    return _tokenCache.token;
  }

  const clientEmail = getServiceAccountEmail();
  const privateKey  = getServiceAccountPrivateKey();
  if (!clientEmail || !privateKey) throw new Error('missing_service_account_credentials');

  const nowSec   = Math.floor(now / 1000);
  const header   = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss:   clientEmail,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   nowSec + 3600,
    iat:   nowSec
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claimSet))}`;
  const signer       = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  `${signingInput}.${signature}`
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || 'oauth_token_error');
  }

  _tokenCache.token     = data.access_token;
  _tokenCache.expiresAt = now + 55 * 60 * 1000; // 55 min
  return data.access_token;
}

// ── Payload Gemini ─────────────────────────────────────────────────────────
function buildGeminiPayload(prompt) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature:        0.2,
      topP:               0.9,
      maxOutputTokens:    900,
      responseMimeType:  'application/json'
    }
  };
}

// ── Retry Exponencial (3 intentos: 0ms, 1.2s, 3.6s) ──────────────────────
// Cubre picos de tráfico en cierres mensuales de facturación (días 15-17)
async function callWithRetry(doRequest) {
  const RETRYABLE = new Set([429, 503, 502, 504]);
  const DELAYS_MS = [0, 1200, 3600]; // backoff: inmediato → 1.2s → 3.6s

  let lastResult = null;

  for (let attempt = 0; attempt < DELAYS_MS.length; attempt++) {
    if (DELAYS_MS[attempt] > 0) {
      await new Promise(r => setTimeout(r, DELAYS_MS[attempt]));
    }

    try {
      const result = await doRequest();
      lastResult   = { ...result, retried: attempt > 0, attempts: attempt + 1 };

      if (result.status >= 200 && result.status < 300) return lastResult;
      if (!RETRYABLE.has(result.status)) return lastResult; // Error no retriable → salir ya
      // Retriable: continuar al siguiente intento
    } catch (err) {
      lastResult = {
        status: 503, data: {}, retried: attempt > 0,
        attempts: attempt + 1, provider: 'unknown', model: null,
        networkError: err?.message || 'network_error'
      };
      if (attempt === DELAYS_MS.length - 1) return lastResult;
    }
  }

  return lastResult ?? { status: 500, data: {}, retried: true, attempts: 3, provider: 'unknown', model: null };
}

// ── Proveedores de IA ──────────────────────────────────────────────────────
async function callVertex(prompt) {
  const accessToken = await getGoogleAccessToken();
  const endpoint =
    `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}` +
    `/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;

  return callWithRetry(async () => {
    const upstream = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body:    JSON.stringify(buildGeminiPayload(prompt))
    });
    const data = await upstream.json().catch(() => ({}));
    return { status: upstream.status, data, provider: 'vertex-ai', model: VERTEX_MODEL };
  });
}

async function callAiStudio(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('missing_gemini_api_key');
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${AI_STUDIO_MODEL}:generateContent?key=${apiKey}`;

  return callWithRetry(async () => {
    const upstream = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(buildGeminiPayload(prompt))
    });
    const data = await upstream.json().catch(() => ({}));
    return { status: upstream.status, data, provider: 'ai-studio', model: AI_STUDIO_MODEL };
  });
}

// Orden: Vertex AI → AI Studio (fallback cuota)
async function callProvider(prompt) {
  if (canUseVertex()) {
    try { return await callVertex(prompt); }
    catch (err) {
      console.warn('[gemini-proxy] Vertex falló, intentando AI Studio:', err?.message);
      if (process.env.GEMINI_API_KEY) return await callAiStudio(prompt);
      throw err;
    }
  }
  return await callAiStudio(prompt);
}

// ── Fast-path para saludos (sin cuota de IA) ──────────────────────────────
function normalizeText(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

const FAST_PATH_GREETINGS = new Set(['hola', 'buenas', 'buen dia', 'buen día', 'gracias', 'ok', 'okay']);

// ── Handler principal ──────────────────────────────────────────────────────
export default async function handler(req, res) {
  setSecureHeaders(req, res);

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    return;
  }

  // Validar origen
  const origin = req.headers.origin || '';
  if (origin && !resolveOrigin(origin)) {
    sendJson(res, 403, { ok: false, error: 'Origin no autorizado' });
    return;
  }

  // ── SEGURIDAD: JWT de Supabase obligatorio ─────────────────────────────
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const jwtUser    = await validateSupabaseJWT(authHeader);

  if (!jwtUser?.uid) {
    sendJson(res, 401, {
      ok:    false,
      error: 'No autorizado. Se requiere sesión activa de Supabase.',
      code:  'jwt_required'
    });
    return;
  }

  const body = parseBody(req);
  if (!body) { sendJson(res, 400, { ok: false, error: 'Body inválido: se espera JSON.' }); return; }

  const prompt = buildPrompt(body);
  if (!prompt) { sendJson(res, 400, { ok: false, error: 'Falta message.' }); return; }

  const debugEnabled      = process.env.ALIADO_AI_DEBUG === 'true';
  const messageNormalized = normalizeText(body?.message || '');
  const AUDIT_HEADERS     = { 'x-aliado-uid': jwtUser.uid };

  // Fast-path saludos
  if (FAST_PATH_GREETINGS.has(messageNormalized)) {
    const s = {
      respuestaFiscal:       'Estoy listo para ayudarte con tu operación fiscal RESICO 2026.',
      fundamentoLegal:       'Orientación general RESICO 2026.',
      diferenciacionIsrIva:  'ISR RESICO: ingresos brutos cobrados. IVA: acreditamiento con CFDI válido.',
      accionConcreta:        'Escribe tu consulta sobre ISR, IVA, CFDI, e.firma o declaración anual.',
      solicitudDatoFaltante: ''
    };
    sendJson(res, 200, {
      ok: true, is_fallback: false, fallback_reason: null,
      provider: 'local-fastpath', model: 'none', structured: s,
      ...s, reply: renderReply(s),
      debug: debugEnabled ? { fastPath: true } : undefined, raw: null
    }, { 'x-aliado-ai-status': 'ok', 'x-aliado-provider': 'local-fastpath', ...AUDIT_HEADERS });
    return;
  }

  // Llamada al proveedor de IA
  try {
    const result = await callProvider(prompt);
    const { status, data, retried, attempts, provider, model } = result;

    if (!(status >= 200 && status < 300)) {
      const reason  = mapUpstreamReason(status, data);
      const payload = fallbackPayload(
        reason,
        debugEnabled ? { upstream_status: status, upstream_data: data, retried, attempts } : {},
        provider, model
      );
      sendJson(res, 200, payload, {
        'x-aliado-ai-status':       'fallback',
        'x-aliado-fallback-reason': reason,
        'x-aliado-provider':        provider,
        ...AUDIT_HEADERS
      });
      return;
    }

    const rawText   = extractGeminiText(data);
    const structured = parseStructuredModelOutput(rawText);

    sendJson(res, 200, {
      ok: true, is_fallback: false, fallback_reason: null,
      provider, model, structured,
      ...structured,
      reply: renderReply(structured),
      debug: debugEnabled ? { upstream_status: status, retried, attempts } : undefined,
      raw:   data
    }, { 'x-aliado-ai-status': 'ok', 'x-aliado-provider': provider, ...AUDIT_HEADERS });

  } catch (err) {
    const payload = fallbackPayload(
      'network_error',
      debugEnabled ? { error_message: err?.message || 'unknown' } : {},
      'proxy', null
    );
    sendJson(res, 200, payload, {
      'x-aliado-ai-status':       'fallback',
      'x-aliado-fallback-reason': 'network_error',
      'x-aliado-provider':        'proxy',
      ...AUDIT_HEADERS
    });
  }
}