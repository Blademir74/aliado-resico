// api/gemini-proxy.js
// Vercel Serverless Function — Proxy seguro para Gemini API
// Variables de entorno requeridas en Vercel: ALIADO_GEMINI_KEY

export default async function handler(req, res) {
  // CORS — permitir llamadas desde el dominio propio y desde n8n
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Leer la key — nombre EXACTO de la variable en Vercel
  const apiKey = process.env.ALIADO_GEMINI_KEY;
  if (!apiKey) {
    console.error('[Proxy] ALIADO_GEMINI_KEY no está configurada en Vercel');
    return res.status(500).json({ error: 'API key no configurada en servidor' });
  }

  // Modelo permitido — solo gemini-2.5-flash de la lista verificada
  // Ignoramos el query param ?model= para evitar manipulación
  const MODEL = 'gemini-2.5-flash';
  const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  try {
    const body = req.body;

    // Validación básica del payload
    if (!body || !body.contents || !Array.isArray(body.contents)) {
      return res.status(400).json({ error: 'Payload inválido: falta campo contents' });
    }

    const geminiRes = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('[Proxy] Gemini error:', geminiRes.status, JSON.stringify(data));
      return res.status(geminiRes.status).json({
        error: data.error?.message || `Gemini HTTP ${geminiRes.status}`,
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('[Proxy] Error interno:', error.message);
    return res.status(500).json({ error: 'Error interno del proxy: ' + error.message });
  }
}
