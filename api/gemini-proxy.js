/* ================================================
   ALIADO RESICO — Proxy Serverless v3.1
   Archivo: api/gemini-proxy.js
   Runtime: Node.js 24.x — ESM puro
   Modelo: gemini-2.0-flash (v1beta — vigente 2026)
   Art. 113-E LISR | Art. 17-K CFF | LFPDPPP
   ================================================ */

const GEMINI_MODEL    = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Contexto fiscal inyectado server-side en cada llamada
// El frontend no necesita duplicarlo — Gemini siempre responde
// con normativa RESICO 2026 sin importar qué prompt llegue
const SYSTEM_INSTRUCTION = {
  parts: [{
    text: `Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.
Reglas absolutas:
- Límite de ingresos RESICO: $3,500,000 MXN anuales (Art. 113-E LISR).
- Al superar el 94% ($3,300,000 MXN): alerta sobre expulsión al Régimen General de Actividad Empresarial.
- Buzón Tributario inactivo: multa de hasta $10,260 MXN (Art. 17-K CFF). Reincidencia duplica el monto (Art. 86-C CFF).
- ISR en RESICO: tasa fija 1%–2.5% sobre ingresos brutos cobrados. Sin deducciones de gastos.
- IVA: requiere CFDI 4.0 con RFC del receptor para acreditamiento (Art. 5 LIVA). Gasto estrictamente indispensable.
- Declaración anual (Art. 113-F LISR): NO es obligatoria para todos. Preguntar si hay ingresos mixtos antes de confirmar obligación.
- e.firma (Art. 17-D CFF): alertar con 90, 30 y 15 días de anticipación al vencimiento.
- Todos los datos están protegidos bajo LFPDPPP con Row Level Security (RLS) en Supabase.
Responde en español mexicano. Máx 250 palabras. Cita artículos cuando aplique.`,
  }],
};

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error('[gemini-proxy] GEMINI_API_KEY no configurada en Vercel');
    return res.status(500).json({
      error: 'Configura GEMINI_API_KEY en Vercel → Settings → Environment Variables.',
    });
  }

  if (!req.body?.contents || !Array.isArray(req.body.contents)) {
    return res.status(400).json({ error: 'Body inválido: contents[] requerido.' });
  }

  const url = `${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`;

  const bodyToSend = {
    ...req.body,
    // Solo inyectar si el frontend no envió su propio systemInstruction
    systemInstruction: req.body.systemInstruction ?? SYSTEM_INSTRUCTION,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyToSend),
    });

    const data = await response.json();

    if (data.error) {
      console.error('[gemini-proxy] Error Google:', data.error.message);

      if (data.error.code === 429) {
        return res.status(429).json({
          error: 'Cuota de Gemini agotada. Activa facturación en aistudio.google.com/apikey.',
        });
      }
      if (data.error.code === 404) {
        return res.status(404).json({
          error: `Modelo no encontrado: ${data.error.message}. Verifica el identificador en gemini-proxy.js.`,
        });
      }

      return res.status(response.status).json({ error: data.error.message });
    }

    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('[gemini-proxy] Respuesta sin texto:', JSON.stringify(data));
      return res.status(502).json({ error: 'Gemini no devolvió texto en la respuesta.' });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[gemini-proxy] Error de red:', err.message);
    return res.status(500).json({ error: `Error de conexión con la API de IA: ${err.message}` });
  }
}