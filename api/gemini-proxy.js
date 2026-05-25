// api/gemini-proxy.js — Vercel Edge Function v5.3
// ✅ API Key NUNCA sale del servidor
// ✅ Verifica sesión Supabase antes de procesar (opcional si token presente)
// ✅ Un único export default — sin duplicados
export const config = { runtime: 'edge', regions: ['iad1'] };

const RATE = new Map();
const MAX_RPH = 100, WINDOW = 3_600_000;

function rateCheck(ip) {
  const now = Date.now();
  const r = RATE.get(ip) || { n: 0, reset: now + WINDOW };
  if (now > r.reset) { r.n = 1; r.reset = now + WINDOW; }
  else if (r.n >= MAX_RPH) return { ok: false };
  else r.n++;
  RATE.set(ip, r);
  return { ok: true, remaining: MAX_RPH - r.n };
}

export default async function handler(req) {
  const ORIGINS = [
    'https://aliado-resico.vercel.app',
    'https://aliadoresico.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ];

  const origin  = req.headers.get('origin') || '';
  const allowed = ORIGINS.includes(origin);

  const h = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  allowed ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST')   return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: h });

  // ── API Key desde variable de entorno del servidor ──────────
  const key = process.env.GEMINI_API_KEY;
  if (!key) return new Response(JSON.stringify({
    error: 'GEMINI_API_KEY no configurada',
    hint: 'Vercel Dashboard → Settings → Environment Variables → GEMINI_API_KEY',
  }), { status: 500, headers: h });

  // ── Verificación de sesión Supabase (si se envía token) ──────
  const authHeader = req.headers.get('authorization');
  let userId = 'anonymous';

  if (authHeader?.startsWith('Bearer ')) {
    const token   = authHeader.split(' ')[1];
    const sbUrl   = process.env.SUPABASE_URL   || 'https://muwhpvdillphgkuwsaec.supabase.co';
    const sbKey   = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (sbKey) {
      try {
        const userRes = await fetch(`${sbUrl}/auth/v1/user`, {
          headers: { 'Authorization': `Bearer ${token}`, 'apikey': sbKey },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          userId = userData.id || 'authenticated';
        }
      } catch(_) {}
    }
  }

  // ── Rate limiting por IP ─────────────────────────────────────
  const ip   = req.headers.get('x-forwarded-for')?.split(',')[0] || 'anon';
  const rate = rateCheck(ip);
  if (!rate.ok) return new Response(JSON.stringify({ error: 'Rate limit excedido (100 req/hora)' }), { status: 429, headers: h });
  h.set('X-RateLimit-Remaining', String(rate.remaining));

  // ── Parseo y validación del body ─────────────────────────────
  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Body JSON inválido' }), { status: 400, headers: h }); }

  if (!Array.isArray(body?.contents)) {
    return new Response(JSON.stringify({ error: 'Se requiere contents[]' }), { status: 400, headers: h });
  }

  // Sanitizar campos incompatibles con Gemini API
  if (body.generationConfig) {
    delete body.generationConfig.responseMimeType;
    delete body.generationConfig.responseSchema;
  }
  delete body.system_instruction;
  delete body.systemInstruction;

  // ── Llamada a Gemini (server-side) ───────────────────────────
  const MODEL = 'gemini-1.5-flash';
  const URL   = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);

  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await r.json();

    if (!r.ok) {
      const msgs = { 400:'Solicitud inválida', 401:'Auth fallida', 403:'Acceso denegado', 429:'Cuota excedida', 503:'Servicio no disponible' };
      return new Response(JSON.stringify({ error: msgs[r.status]||`Gemini ${r.status}`, code:`GEMINI_${r.status}` }), { status: r.status, headers: h });
    }

    return new Response(JSON.stringify({
      ...data,
      _meta: { proxy: '5.3', model: MODEL, user_id: userId, ts: new Date().toISOString() },
    }), { status: 200, headers: h });

  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') return new Response(JSON.stringify({ error: 'Timeout 12s', code:'TIMEOUT' }), { status: 504, headers: h });
    return new Response(JSON.stringify({ error: 'Error de red', code:'NETWORK_ERROR' }), { status: 502, headers: h });
  }
}
