// api/gemini-proxy.js
// Vercel Serverless Function — Proxy seguro para Gemini API
// Variable de entorno en Vercel: GEMINI_API_KEY
// (puedes usar ALIADO_GEMINI_KEY también — lee ambas con fallback)

export default async function handler(req, res) {

  // CORS — dominio propio en producción
  const allowedOrigin = 'https://aliado-resico.vercel.app';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Lee GEMINI_API_KEY con fallback a ALIADO_GEMINI_KEY
  const apiKey = process.env.GEMINI_API_KEY || process.env.ALIADO_GEMINI_KEY;
  if (!apiKey) {
    console.error('[Proxy] No se encontró GEMINI_API_KEY ni ALIADO_GEMINI_KEY en Vercel');
    return res.status(500).json({ error: 'API key no configurada en el servidor' });
  }

  // Modelo fijo — gemini-2.5-flash verificado con la key actual
  // Se ignora cualquier ?model= del query string para evitar manipulación
  const MODEL = 'gemini-2.5-flash';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  // Vercel no parsea el body automáticamente — leer manualmente si es necesario
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {
      return res.status(400).json({ error: 'Body no es JSON válido' });
    }
  }

  if (!body || !body.contents || !Array.isArray(body.contents)) {
    return res.status(400).json({ error: 'Payload inválido: falta campo contents[]' });
  }

  // Limpiar campos que causan error 400 en v1beta
  // responseMimeType y system_instruction no son soportados en todas las versiones
  if (body.generationConfig) {
    delete body.generationConfig.responseMimeType;
  }
  delete body.system_instruction;
  delete body.systemInstruction;

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('[Proxy] Gemini error:', geminiRes.status, data?.error?.message);
      return res.status(geminiRes.status).json({
        error: data?.error?.message || `Gemini HTTP ${geminiRes.status}`,
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('[Proxy] Error de red:', error.message);
    return res.status(500).json({ error: 'Error de red al contactar Gemini: ' + error.message });
  }
}
