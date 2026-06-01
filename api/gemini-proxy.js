export const config = {
  maxDuration: 30,
};

const RATE = new Map();
const MAX = 100;
const WIN = 3_600_000;

function rateCheck(ip) {
  const now = Date.now();
  const r = RATE.get(ip) || { n: 0, reset: now + WIN };
  if (now > r.reset) { r.n = 1; r.reset = now + WIN; }
  else if (r.n >= MAX) return { ok: false, rem: 0 };
  else r.n++;
  RATE.set(ip, r);
  return { ok: true, rem: MAX - r.n };
}

const INJECTION = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/gi,
  /you\s+are\s+now\s+(a\s+)?(?!Aliado)/gi,
  /new\s+instructions?\s*:/gi,
  /forget\s+(everything|all)/gi,
];

const ALLOWED = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

export default async function handler(req, res) {
  const origin = req.headers['origin'] || '';
  const allowed = ALLOWED.includes(origin);
  const cors = allowed ? origin : ALLOWED[0];

  res.setHeader('Access-Control-Allow-Origin', cors);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY no configurada en Vercel',
      hint: 'Dashboard → Settings → Environment Variables',
    });
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const rate = rateCheck(ip);
  res.setHeader('X-RateLimit-Remaining', String(rate.rem ?? 0));
  if (!rate.ok) return res.status(429).json({ error: 'Rate limit excedido (100 req/hora)' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'Body JSON inválido' }); }
  }

  if (!Array.isArray(body?.contents)) {
    return res.status(400).json({ error: 'Se requiere contents[]' });
  }

  if (body.generationConfig) {
    delete body.generationConfig.responseMimeType;
    delete body.generationConfig.responseSchema;
  }
  delete body.system_instruction;
  delete body.systemInstruction;

  if (body.contents?.[0]?.parts?.[0]?.text) {
    let txt = body.contents[0].parts[0].text;
    INJECTION.forEach(p => { txt = txt.replace(p, '[FILTERED]'); });
    body.contents[0].parts[0].text = txt.slice(0, 8000);
  }

  let userId = 'anon';
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) {
    const sbUrl = process.env.SUPABASE_URL || '';
    const sbKey = process.env.SUPABASE_ANON_KEY || '';
    if (sbUrl && sbKey) {
      try {
        const r = await fetch(`${sbUrl}/auth/v1/user`, {
          headers: { Authorization: auth, apikey: sbKey },
        });
        if (r.ok) { const u = await r.json(); userId = u.id || 'auth'; }
      } catch (_) {}
    }
  }

  const MODEL = 'gemini-1.5-flash';
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

  try {
    const gr = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });

    const data = await gr.json();

    if (!gr.ok) {
      const msgs = {
        400: 'Solicitud inválida para Gemini',
        401: 'GEMINI_API_KEY inválida',
        403: 'Acceso denegado',
        429: 'Cuota de Gemini excedida',
        503: 'Gemini no disponible',
      };
      return res.status(gr.status).json({
        error: msgs[gr.status] || `Gemini ${gr.status}`,
        code: `GEMINI_${gr.status}`,
      });
    }

    return res.status(200).json({
      ...data,
      _meta: { proxy: '7.0-ESM', model: MODEL, user_id: userId, ts: new Date().toISOString() },
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return res.status(504).json({ error: 'Timeout 12s', code: 'TIMEOUT' });
    }
    return res.status(502).json({ error: 'Error de red hacia Gemini', code: 'NETWORK_ERROR' });
  }
}