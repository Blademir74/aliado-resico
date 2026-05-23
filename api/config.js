// api/config.js (Vercel Serverless)
export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const allowed = process.env.ALIADO_ALLOWED_ORIGIN || 'https://aliado-resico.vercel.app';
  
  if (origin && origin !== allowed && process.env.NODE_ENV === 'production') {
    return new Response(JSON.stringify({ error: 'Origin no autorizado' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const headers = new Headers({
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  return new Response(JSON.stringify({
    ok: true,
    config: {
      supabaseUrl: process.env.ALIADO_SUPABASE_URL || '',
      supabaseAnonKey: process.env.ALIADO_SUPABASE_ANON_KEY || '',
      environment: process.env.NODE_ENV || 'development',
      geminiConfigured: !!process.env.GEMINI_API_KEY
    }
  }), { status: 200, headers });
}