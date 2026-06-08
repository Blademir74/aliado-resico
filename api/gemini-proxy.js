/* ================================================
   ALIADO RESICO — Proxy Serverless v3.1
   Archivo: api/gemini-proxy.js
   Runtime: Node.js 24.x — ESM (package.json: "type":"module")
   Modelo: gemini-2.0-flash (vigente 2026, v1beta)
   Art. 113-E LISR | Art. 17-K CFF | LFPDPPP
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
    return res.status(500).json({
      error: 'Búnker de llaves no configurado en Vercel. Configura GEMINI_API_KEY en Settings → Environment Variables.',
    });
  }

  // Endpoint estable v1beta con gemini-2.0-flash
  // gemini-1.5-flash está deprecado en v1 y v1beta desde 2026
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  // Validación del body antes de llamar a Google
  if (!req.body?.contents || !Array.isArray(req.body.contents)) {
    return res.status(400).json({
      error: 'Body inválido: el campo contents[] es requerido.',
    });
  }

  // Inyectar contexto fiscal RESICO 2026 en cada llamada que no lo traiga ya
  // Esto garantiza que el modelo siempre responda con normativa vigente
  const systemInstruction = req.body.systemInstruction || {
    parts: [{
      text: `Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.
Reglas absolutas:
- Límite de ingresos RESICO: $3,500,000 MXN anuales (Art. 113-E LISR).
- Si el contribuyente supera el 94% ($3,300,000 MXN), alerta sobre expulsión al Régimen General.
- Buzón Tributario inactivo genera multa de hasta $10,260 MXN (Art. 17-K CFF). Reincidencia duplica el monto (Art. 86-C CFF).
- ISR en RESICO: tasa fija del 1% al 2.5% sobre ingresos brutos. No hay deducciones.
- IVA: requiere gestión de gastos con CFDI 4.0 para acreditamiento. Gasto indispensable (Art. 5 LIVA).
- Declaración anual (Art. 113-F LISR): no es obligatoria para todos. Preguntar si tiene ingresos mixtos.
- Todos los datos están protegidos bajo LFPDPPP con RLS auth.uid() = user_id en Supabase.
Responde en español mexicano, con precisión normativa.`,
    }],
  };

  const bodyToSend = {
    ...req.body,
    systemInstruction,
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyToSend),
    });

    const data = await response.json();

    if (data.error) {
      console.error('[gemini-proxy] Error de Google:', data.error.message);

      // Errores de cuota — mensaje accionable para el operador
      if (data.error.code === 429) {
        return res.status(429).json({
          error: 'Cuota de Gemini agotada. Activa facturación en aistudio.google.com/apikey o espera el reset del ciclo.',
        });
      }

      // Modelo no encontrado — indica un nombre incorrecto en API_URL
      if (data.error.code === 404) {
        return res.status(404).json({
          error: `Modelo no encontrado: ${data.error.message}. Verifica el identificador en gemini-proxy.js.`,
        });
      }

      return res.status(response.status).json({ error: data.error.message });
    }

    // Guardar que la respuesta tiene texto antes de enviarla al clasificador
    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('[gemini-proxy] Respuesta sin texto:', JSON.stringify(data));
      return res.status(502).json({
        error: 'Gemini no devolvió texto. Revisa generationConfig o el prompt enviado.',
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[gemini-proxy] Error de red:', err.message);
    return res.status(500).json({
      error: `Fallo en la conexión con la Bóveda de IA: ${err.message}`,
    });
  }
}