// api/auth-callback.js — Vercel Serverless (CommonJS)
// Maneja el redirect de confirmación de email de Supabase
'use strict';

module.exports = function handler(req, res) {
  const { token_hash, type, next } = req.query;
  const base = 'https://aliado-resico.vercel.app';

  if (token_hash && type) {
    const dest = next ? `${base}${next}` : base;
    const sep  = dest.includes('?') ? '&' : '?';
    return res.redirect(302, `${dest}${sep}token_hash=${token_hash}&type=${type}`);
  }

  return res.redirect(302, base);
};
