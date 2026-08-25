// api/config.js — v3.0 AUDITADO
// Única fuente de configuración pública. Contrato EXACTO que exigen
// js/config.js y js/init-db.js: { ok:true, config:{ supabaseUrl, supabaseAnonKey } }
const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app', 'https://aliadoresico.com',
  'https://www.aliadoresico.com', 'http://localhost:3000',
  'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'
];

export default function handler(req, res) {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  // ── Lectura directa de las variables que YA tienes en Vercel ──────────
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  return res.status(200).json({
    ok: true,
    config: {
      supabaseUrl,                                  // ← contrato config.js
      supabaseAnonKey,                              // ← contrato config.js
      geminiConfigured: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
      webhookUrl: process.env.N8N_WEBHOOK_URL || '',
      alegraConfigured: !!(process.env.ALEGRA_API_TOKEN && process.env.ALEGRA_API_BASE),
      environment: 'production'
    }
    // ⚠️ NUNCA exponer aquí: SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET,
    //    GEMINI_API_KEY, ALEGRA_API_TOKEN, GOOGLE_SERVICE_ACCOUNT_*
  });
}