// api/config.js — Vercel Serverless (CommonJS)
'use strict';

const ALLOWED = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
];

module.exports = async function handler(req, res) {
  const origin  = req.headers['origin'] || '';
  const allowed = ALLOWED.includes(origin);

  res.setHeader('Access-Control-Allow-Origin',  allowed ? origin : ALLOWED[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary',                   'Origin');
  res.setHeader('Cache-Control',          'public, max-age=300');
  res.setHeader('Content-Type',           'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options',        'DENY');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl     = process.env.SUPABASE_URL      || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(503).json({
      ok: false,
      error: 'SUPABASE_URL y SUPABASE_ANON_KEY no configuradas en Vercel',
    });
  }

  return res.status(200).json({
    ok: true,
    config: {
      supabaseUrl,
      supabaseAnonKey,
      geminiConfigured: !!process.env.GEMINI_API_KEY,
      env: 'production',
    },
  });
};
