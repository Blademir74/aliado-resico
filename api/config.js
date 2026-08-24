export default async function handler(_req, res) {
  // Configurar CORS para que el frontend pueda leer la respuesta
  // FIX FASE 0.6: Whitelist de orígenes en lugar de CORS abierto
  const ALLOWED_ORIGINS = [
    'https://aliado-resico.vercel.app',
    'https://aliadoresico.com',
    'https://www.aliadoresico.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ];
  const origin = _req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Manejar preflight
  if (_req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Devolver configuración desde variables de entorno
  return res.status(200).json({
    ok: true,
    config: {
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      geminiConfigured: !!process.env.GEMINI_API_KEY
    }
  });
}