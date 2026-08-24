// api/auth-callback.js — Vercel Serverless (ESM)
// Maneja el redirect de confirmación de email de Supabase
// FIX FASE 0.5: Validación de Open Redirect

export default function handler(req, res) {
  const { token_hash, type, next } = req.query;
  const base = 'https://aliado-resico.vercel.app';

  // FIX FASE 0.5: Validar que `next` sea una ruta interna segura
  // Debe empezar con '/' y NO contener '//' ni protocolos externos
  let safeNext = null;
  if (next && typeof next === 'string') {
    const trimmed = next.trim();
    if (
      trimmed.startsWith('/') &&
      !trimmed.startsWith('//') &&
      !trimmed.includes('://') &&
      !trimmed.includes('\\')
    ) {
      safeNext = trimmed;
    }
  }

  if (token_hash && type) {
    const dest = safeNext ? `${base}${safeNext}` : base;
    const sep = dest.includes('?') ? '&' : '?';
    return res.redirect(302, `${dest}${sep}token_hash=${encodeURIComponent(token_hash)}&type=${encodeURIComponent(type)}`);
  }
  return res.redirect(302, base);
}