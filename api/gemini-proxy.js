/* ================================================
   ALIADO RESICO — Proxy Serverless
   Ruta: /api/gemini-proxy.js
   Propósito: Ocultar GEMINI_API_KEY del frontend
   Runtime: Node.js 22.x (Vercel)
   ================================================ */

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

export default async function handler(req, res) {
  /* Solo POST */
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  /* API Key desde variables de entorno de Vercel — nunca del frontend */
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY no configurada en Vercel' });
  }

  /* Validación básica del body */
  const { contents, generationConfig } = req.body || {};
  if (!contents || !Array.isArray(contents)) {
    return res.status(400).json({ error: 'Body inválido: falta contents[]' });
  }

  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: generationConfig || {
          temperature: 0.1,
          maxOutputTokens: 350,
        },
      }),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({
        error: data?.error?.message || `Gemini API error ${geminiRes.status}`,
      });
    }

    /* Agregar metadata de trazabilidad */
    data._meta = {
      model: 'gemini-1.5-flash',
      ts: new Date().toISOString(),
      proxy: 'vercel-serverless',
    };

    return res.status(200).json(data);

  } catch (err) {
    console.error('[gemini-proxy] Error:', err.message);
    return res.status(502).json({ error: `Proxy error: ${err.message}` });
  }
}