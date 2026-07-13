export default async function handler(_req, res) {
  // Configurar CORS para que el frontend pueda leer la respuesta
  res.setHeader('Access-Control-Allow-Origin', '*');
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