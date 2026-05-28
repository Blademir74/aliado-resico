// api/config.js — Vercel Edge Function v6.3
// Entrega credenciales públicas (anon key) al frontend
// NUNCA expone: GEMINI_API_KEY, SERVICE_ROLE_KEY, tokens internos
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const ALLOWED_ORIGIN = process.env.ALIADO_ALLOWED_ORIGIN || 'https://aliado-resico.vercel.app';
  const origin = req.headers.get('origin') || '';

  // Solo dominios autorizados
  const isAllowed = origin === ALLOWED_ORIGIN
    || origin === 'http://localhost:3000'
    || origin === 'http://127.0.0.1:3000'
    || origin === 'http://localhost:5500';

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin':  isAllowed ? origin : ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'Cache-Control': 'public, max-age=300', // 5 min — anon key no cambia seguido
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  // Supabase anon key es PÚBLICA por diseño — RLS protege los datos
  // Lo que NUNCA debe salir: SERVICE_ROLE_KEY, GEMINI_API_KEY
  const supabaseUrl     = process.env.SUPABASE_URL || process.env.ALIADO_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.ALIADO_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY no configuradas en Vercel',
    }), { status: 503, headers });
  }

  return new Response(JSON.stringify({
    ok: true,
    config: {
      supabaseUrl,
      supabaseAnonKey,
      geminiConfigured: !!process.env.GEMINI_API_KEY, // Solo bool, no la key
      env: process.env.NODE_ENV || 'production',
    },
  }), { status: 200, headers });
}
