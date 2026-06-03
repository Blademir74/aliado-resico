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

const ALLOWED = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// ⬇️ Vercel lee esta propiedad para extender el tiempo máximo
module.exports.maxDuration = 30;

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const cors = ALLOWED.includes(origin) ? origin : ALLOWED[0];

  res.setHeader('Access-Control-Allow-Origin', cors);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'GEMINI_API_KEY missing' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const rate = rateCheck(ip);
  if (!rate.ok) return res.status(429).json({ error: 'Rate limit exceeded' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }

  const MODEL = 'gemini-1.5-flash';
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const gr = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await gr.json();
    if (!gr.ok) return res.status(gr.status).json({ error: `Gemini ${gr.status}` });
    return res.status(200).json(data);
  } catch (e) {
    console.error('Proxy error:', e);
    return res.status(502).json({ error: 'Network error' });
  }
};
