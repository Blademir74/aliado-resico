// ============================================
// ALIADO RESICO — Secure Config Endpoint
// Vercel Serverless Function
// Expone SOLO claves públicas (Supabase URL/anon key)
// NUNCA expone Gemini key — se usa via /api/gemini-proxy
// ============================================

export default function handler(req, res) {
  // --- CORS: Solo aceptar del dominio autorizado ---
  const allowedOrigin = process.env.ALIADO_ALLOWED_ORIGIN || '*';
  const origin = req.headers.origin || '';

  if (allowedOrigin !== '*' && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Expose ONLY public-safe config ---
  const config = {
    supabaseUrl: process.env.ALIADO_SUPABASE_URL || '',
    supabaseAnonKey: process.env.ALIADO_SUPABASE_ANON_KEY || '',
    webhookUrl: process.env.ALIADO_WEBHOOK_URL || '',
    // Gemini key is NEVER exposed — use /api/gemini-proxy instead
    geminiConfigured: !!process.env.ALIADO_GEMINI_KEY,
    environment: 'production',
  };

  // Validate that required vars are set
  const missing = [];
  if (!config.supabaseUrl) missing.push('ALIADO_SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('ALIADO_SUPABASE_ANON_KEY');
  if (!process.env.ALIADO_GEMINI_KEY) missing.push('ALIADO_GEMINI_KEY');

  if (missing.length > 0) {
    console.warn(`[Config API] Missing env vars: ${missing.join(', ')}`);
  }

  return res.status(200).json({
    ok: true,
    config,
    warnings: missing.length > 0 ? `Missing: ${missing.join(', ')}` : null,
  });
}
