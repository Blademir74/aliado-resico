/* ================================================
   ALIADO RESICO — Proxy Serverless v3.0
   Archivo: api/gemini-proxy.js
   Runtime: Node.js 22.x — ESM (package.json: "type":"module")
   Modelo: gemini-2.0-flash (vigente 2026, v1beta)
   ================================================ */

export default async function handler(req, res) {

  // CORS — cubre el pre-flight que el browser envía antes del POST
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('[gemini-proxy] GEMINI_API_KEY no configurada en Vercel Environment Variables');
    return res.status(500).json({ error: 'Búnker de llaves no configurado en Vercel.' });
  }

  // gemini-1.5-flash deprecado en v1 y v1beta — modelo vigente: gemini-2.0-flash
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  // Validación mínima del body para evitar llamadas vacías a Google
  if (!req.body?.contents || !Array.isArray(req.body.contents)) {
    return res.status(400).json({ error: 'Body inválido: contents[] requerido.' });
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (data.error) {
      console.error('[gemini-proxy] Error de Google:', data.error.message);
      return res.status(response.status).json({ error: data.error.message });
    }

    // Validar que la respuesta contenga texto antes de devolverla al clasificador
    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('[gemini-proxy] Respuesta sin texto:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini no devolvió texto en la respuesta.' });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[gemini-proxy] Error de red:', err.message);
    return res.status(500).json({ error: 'Fallo en la conexión con la Bóveda de IA.' });
  }
}