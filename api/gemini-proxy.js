const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_INSTRUCTION = {
  parts: [{
    text: [
      'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
      'Reglas absolutas:',
      '- Límite anual RESICO: $3,500,000 MXN.',
      '- Umbrales: 80% preventivo, 90% riesgo alto, 94% riesgo de expulsión.',
      '- Buzón Tributario inactivo: multa hasta $10,260 MXN, pérdida de plazos y riesgo operativo severo.',
      '- La declaración anual NO se afirma para todos; primero pregunta por ingresos mixtos.',
      '- ISR RESICO: sobre ingresos brutos efectivamente cobrados, sin deducciones.',
      '- IVA: requiere CFDI válido y gasto indispensable para acreditamiento.',
      '- Responde en español mexicano.'
    ].join('\n')
  }]
};

function fallbackResponse(reason, hint) {
  const text = hint || 'El servicio de IA no está disponible. Puedo seguirte orientando con reglas RESICO 2026.';
  return {
    is_fallback: true,
    fallback_reason: reason,
    candidates: [{
      content: {
        parts: [{ text }]
      },
      finishReason: 'FALLBACK'
    }]
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(200).json(fallbackResponse('missing_api_key'));

  if (!req.body?.contents || !Array.isArray(req.body.contents)) {
    return res.status(400).json({ error: 'Body inválido: contents requerido.' });
  }

  const bodyToSend = {
    ...req.body,
    systemInstruction: req.body.systemInstruction ?? SYSTEM_INSTRUCTION
  };

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyToSend)
    });

    const data = await response.json();

    if (data?.error?.code === 429) return res.status(200).json(fallbackResponse('quota_exhausted'));
    if (data?.error?.code === 404) return res.status(200).json(fallbackResponse('model_unavailable'));
    if (data?.error) return res.status(200).json(fallbackResponse('api_error', data.error.message));
    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json(fallbackResponse('empty_response'));
    }

    return res.status(200).json({ ...data, is_fallback: false });
  } catch (err) {
    return res.status(200).json(fallbackResponse('network_error', err.message));
  }
}