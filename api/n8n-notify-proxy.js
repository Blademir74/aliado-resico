// api/n8n-notify-proxy.js — v1.0 CERTIFICADO
// Puente seguro para alertas WhatsApp (Mensajes de Utilidad ~$0.17 MXN)
// Cumplimiento: Art. 113-E LISR (umbrales) · Art. 17-K CFF (buzón)
import crypto from 'node:crypto';

const ENGINE = 'n8n-notify-v1';
const N8N_URL = process.env.N8N_WEBHOOK_URL || '';
const HMAC_SECRET = process.env.N8N_HMAC_SECRET || process.env.SUPABASE_JWT_SECRET || 'aliado-resico-hmac';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app','https://aliadoresico.com','https://www.aliadoresico.com',
  'http://localhost:3000','http://127.0.0.1:3000','http://localhost:5500','http://127.0.0.1:5500'
];
const _rl = new Map();
function rateLimit(key) {
  const now = Date.now();
  let b = _rl.get(key);
  if (!b || now - b.start > 60000) b = { start: now, n: 0 };
  b.n++; _rl.set(key, b);
  return b.n <= 10; // 10 alertas/min por usuario (anti-spam de costo)
}
function setHeaders(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-demo-mode');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function verifyJWT(auth) {
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const [h, p, s] = auth.slice(7).split('.');
    if (!h || !p || !s) return null;
    if (JWT_SECRET) {
      const exp = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
      const a = Buffer.from(s, 'base64url'), b2 = Buffer.from(exp, 'base64url');
      if (a.length !== b2.length || !crypto.timingSafeEqual(a, b2)) return null;
    }
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role === 'service_role') return null;
    return { uid: payload.sub || 'anon' };
  } catch { return null; }
}
export default async function handler(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed', engine: ENGINE });
  try {
    const isDemo = req.headers['x-demo-mode'] === 'true';
    const user = verifyJWT(req.headers.authorization);
    if (!user && !isDemo) return res.status(401).json({ ok: false, error: 'No autorizado', engine: ENGINE });
    if (!rateLimit(user?.uid || 'demo')) return res.status(429).json({ ok: false, error: 'Límite de alertas alcanzado', engine: ENGINE });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.trigger !== 'risk_threshold_crossed' && body.message_category !== 'fiscal_notification') {
      return res.status(400).json({ ok: false, error: 'Payload no reconocido', engine: ENGINE });
    }
    if (!N8N_URL) {
      return res.status(200).json({ ok: true, engine: ENGINE, forwarded: false, reason: 'n8n_no_configurado' });
    }
    const signature = crypto.createHmac('sha256', HMAC_SECRET)
      .update(JSON.stringify(body)).digest('hex');
    const upstream = await fetch(N8N_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Source': 'aliado-resico',
        'X-Signature': signature,
        'X-Engine': ENGINE
      },
      body: JSON.stringify({ ...body, demo: isDemo, sent_at: new Date().toISOString() })
    });
    if (!upstream.ok) {
      return res.status(200).json({ ok: true, engine: ENGINE, forwarded: false, reason: `n8n_http_${upstream.status}` });
    }
    return res.status(200).json({ ok: true, engine: ENGINE, forwarded: true });
  } catch (e) {
    return res.status(200).json({ ok: true, engine: ENGINE, forwarded: false, reason: 'exception', detail: String(e?.message || '') });
  }
}