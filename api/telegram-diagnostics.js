// api/telegram-diagnostics.js — INTERNO (CommonJS)
// Protegido con X-Admin-Token
'use strict';

module.exports = function handler(req, res) {
  const token    = req.headers['x-admin-token'] || req.query?.token || '';
  const expected = process.env.ADMIN_DIAGNOSTICS_TOKEN || '';

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    services: {
      gemini:   { configured: !!process.env.GEMINI_API_KEY },
      supabase: { configured: !!process.env.SUPABASE_URL   },
      telegram: { configured: !!process.env.ALIADO_TELEGRAM_BOT_TOKEN },
      n8n:      { configured: !!process.env.ALIADO_N8N_WEBHOOK_URL },
    },
  });
};
