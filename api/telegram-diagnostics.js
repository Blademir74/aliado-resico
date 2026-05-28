// api/telegram-diagnostics.js — INTERNO
// Protegido con token secreto — no accesible públicamente
// Solo para admin con X-Admin-Token correcto

export default async function handler(req, res) {
  // AUTH: requiere header secreto
  const adminToken = req.headers['x-admin-token'] || req.query?.token;
  const expected   = process.env.ADMIN_DIAGNOSTICS_TOKEN;

  if (!expected || adminToken !== expected) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const diagnostics = {
    timestamp: new Date().toISOString(),
    version: '2.5',
    telegram: { configured: !!process.env.ALIADO_TELEGRAM_BOT_TOKEN },
    n8n:      { configured: !!process.env.ALIADO_N8N_WEBHOOK_URL },
    gemini:   { configured: !!process.env.GEMINI_API_KEY },
    supabase: { configured: !!process.env.SUPABASE_URL },
  };

  return res.status(200).json({ ok: true, diagnostics });
}
