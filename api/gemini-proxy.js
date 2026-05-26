// api/gemini-proxy.js — Vercel Edge Function v5.4
// ✅ Un único export default
// ✅ GEMINI_API_KEY solo en servidor (process.env)
// ✅ Verifica sesión Supabase si token presente
// ✅ Rate limit 100 req/hora por IP
export const config = { runtime: 'edge', regions: ['iad1'] };

const RATE = new Map();
const MAX = 100, WIN = 3_600_000;

function rateCheck(ip) {
  const now = Date.now();
  const r = RATE.get(ip) || { n: 0, reset: now + WIN };
  if (now > r.reset) { r.n = 1; r.reset = now + WIN; }
  else if (r.n >= MAX) return { ok: false };
  else r.n++;
  RATE.set(ip, r);
  return { ok: true, rem: MAX - r.n };
}

export default async function handler(req) {
  const ORIGINS = [
    'https://aliado-resico.vercel.app',
    'https://aliadoresico.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
  ];

  const origin  = req.headers.get('origin') || '';
  const allowed = ORIGINS.includes(origin);
  const cors    = allowed ? origin : ORIGINS[0];

  const h = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  cors,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST')   return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: h });

  // ── API Key — NUNCA llega al frontend ──────────────
  const key = process.env.GEMINI_API_KEY;
  if (!key) return new Response(JSON.stringify({
    error: 'GEMINI_API_KEY no configurada en el servidor',
    hint: 'Vercel Dashboard → Settings → Environment Variables → GEMINI_API_KEY',
  }), { status: 500, headers: h });

  // ── Verificación de sesión Supabase (opcional) ─────
  const authHeader = req.headers.get('authorization') || '';
  let userId = 'anon';

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const sbUrl = process.env.SUPABASE_URL || 'https://muwhpvdillphgkuwsaec.supabase.co';
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    if (sbKey) {
      try {
        const ur = await fetch(`${sbUrl}/auth/v1/user`, {
          headers: { Authorization: `Bearer ${token}`, apikey: sbKey },
        });
        if (ur.ok) { const ud = await ur.json(); userId = ud.id || 'auth'; }
      } catch(_) {}
    }
  }

  // ── Rate limit ─────────────────────────────────────
  const ip   = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rate = rateCheck(ip);
  h.set('X-RateLimit-Remaining', String(rate.rem ?? 0));
  if (!rate.ok) return new Response(JSON.stringify({
    error: 'Rate limit excedido. Máximo 100 solicitudes/hora.',
    code: 'RATE_LIMITED',
  }), { status: 429, headers: h });

  // ── Parseo del body ────────────────────────────────
  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Body JSON inválido' }), { status: 400, headers: h }); }

  if (!Array.isArray(body?.contents)) {
    return new Response(JSON.stringify({ error: 'Se requiere contents[]' }), { status: 400, headers: h });
  }

  // Limpiar campos incompatibles con Gemini API
  if (body.generationConfig) {
    delete body.generationConfig.responseMimeType;
    delete body.generationConfig.responseSchema;
  }
  delete body.system_instruction;
  delete body.systemInstruction;

  // ── Llamada a Gemini — server-side únicamente ──────
  const MODEL = 'gemini-1.5-flash';
  const URL   = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);

  try {
    const gr = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const data = await gr.json();
    if (!gr.ok) {
      const msgs = {
        400: 'Solicitud inválida para Gemini',
        401: 'GEMINI_API_KEY inválida — verifica en Vercel',
        403: 'Acceso denegado a Gemini API',
        429: 'Cuota de Gemini excedida — espera unos minutos',
        503: 'Gemini no disponible temporalmente',
      };
      return new Response(JSON.stringify({
        error: msgs[gr.status] || `Gemini ${gr.status}`,
        code: `GEMINI_${gr.status}`,
      }), { status: gr.status, headers: h });
    }

    return new Response(JSON.stringify({
      ...data,
      _meta: { proxy: '5.4', model: MODEL, user_id: userId, ts: new Date().toISOString() },
    }), { status: 200, headers: h });

  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Timeout 12s — Gemini tardó demasiado', code: 'TIMEOUT' }), { status: 504, headers: h });
    }
    return new Response(JSON.stringify({ error: 'Error de red hacia Gemini', code: 'NETWORK_ERROR' }), { status: 502, headers: h });
  }
}
