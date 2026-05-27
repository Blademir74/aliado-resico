// api/auth-callback.js — Vercel Serverless Function
// Maneja el redirect de confirmación de email de Supabase
// Supabase envía el usuario aquí después de confirmar su correo

export default function handler(req, res) {
  const { token_hash, type, next } = req.query;

  // Redirigir al frontend con los parámetros de Supabase
  // El cliente de Supabase los procesa automáticamente
  const baseUrl = 'https://aliado-resico.vercel.app';
  const redirectUrl = next || '/';

  if (token_hash && type) {
    // Pasar los parámetros al frontend para que supabase-js los consuma
    return res.redirect(
      302,
      `${baseUrl}${redirectUrl}?token_hash=${token_hash}&type=${type}`
    );
  }

  return res.redirect(302, baseUrl);
}
