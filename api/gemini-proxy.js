/* ================================================
   ALIADO RESICO — Proxy Serverless v2.0
   Archivo: api/gemini-proxy.js
   Propósito: Blindar GEMINI_API_KEY del frontend
   Runtime: Node.js 22.x (Vercel) — ESM
   ================================================ */

// URL exacta validada contra la documentación de Gemini API v1beta
// El modelo se especifica en el path, no en el body
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

export default async function handler(req, res) {

  // Cabeceras CORS para llamadas desde el mismo dominio de Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Pre-flight OPTIONS — el browser lo envía antes del POST real
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Solo acepta POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // API Key inyectada desde las variables de entorno de Vercel
  // Nunca se expone en el frontend ni en el bundle del cliente
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[gemini-proxy] GEMINI_API_KEY no configurada en Vercel Environment Variables');
    return res.status(500).json({
      error: 'Configuración del servidor incompleta. Contacta al administrador.',
    });
  }

  // Validación del body recibido desde classifier.js
  const body = req.body;
  if (!body || !Array.isArray(body.contents) || body.contents.length === 0) {
    return res.status(400).json({
      error: 'Body inválido: el campo contents[] es obligatorio y debe ser un array.',
    });
  }

  const { contents, generationConfig } = body;

  try {
    const geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        // generationConfig desde el clasificador, con fallback seguro
        generationConfig: generationConfig ?? {
          temperature: 0.1,
          maxOutputTokens: 400,
          topP: 0.8,
        },
      }),
    });

    const data = await geminiRes.json();

    // Propagar errores de la API de Google con su mensaje original
    if (!geminiRes.ok) {
      const googleError = data?.error?.message ?? `Gemini API HTTP ${geminiRes.status}`;
      console.error('[gemini-proxy] Error de Google:', googleError);
      return res.status(geminiRes.status).json({ error: googleError });
    }

    // Validar que la respuesta tenga la estructura esperada
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('[gemini-proxy] Respuesta sin texto:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini no devolvió texto en la respuesta.' });
    }

    // Metadatos de trazabilidad para debugging en producción
    data._meta = {
      model: 'gemini-2.0-flash',
      proxy: 'vercel-serverless',
      ts: new Date().toISOString(),
    };

    return res.status(200).json(data);

  } catch (err) {
    // Error de red o timeout
    console.error('[gemini-proxy] Error de red:', err.message);
    return res.status(502).json({
      error: `Error de conexión con Gemini: ${err.message}`,
    });
  }
}