const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_TEXT = [
  'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
  'Responde en español mexicano, claro y accionable.',
  'Nunca expongas dudas técnicas internas.',
  'Reglas absolutas:',
  '- Límite anual RESICO PF: $3,500,000 MXN.',
  '- Umbrales: 80% preventivo, 90% riesgo alto, 94% riesgo de expulsión.',
  '- Buzón Tributario inactivo: multa hasta $10,260 MXN, pérdida de plazos y riesgo operativo severo.',
  '- La declaración anual NO se afirma para todos; primero pregunta por ingresos mixtos si falta contexto.',
  '- ISR RESICO: sobre ingresos brutos efectivamente cobrados, sin deducciones.',
  '- IVA: requiere CFDI válido y gasto indispensable para acreditamiento.',
  '- Si el usuario pregunta por anual, primero valida si solo tuvo RESICO o ingresos mixtos.',
  '- Termina con una acción concreta.'
].join('\n');

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(body));
}

function extractReply(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || '')
      .join('\n')
      .trim() || ''
  );
}

function fallback(reason, hint) {
  const reply =
    hint ||
    'El servicio de IA no está disponible por el momento. Puedo orientarte con reglas base RESICO 2026: límite de $3,500,000 MXN, monitoreo al 80/90/94, y revisión de ingresos mixtos antes de confirmar anual.';
  return {
    ok: true,
    is_fallback: true,
    fallback_reason: reason,
    reply,
    source: 'gemini-proxy',
    model: GEMINI_MODEL,
    raw: {
      candidates: [
        {
          content: { parts: [{ text: reply }] },
          finishReason: 'FALLBACK'
        }
      ]
    }
  };
}

function buildContents(body) {
  if (Array.isArray(body?.contents) && body.contents.length) return body.contents;

  const message = String(body?.message || '').trim();
  if (!message) return null;

  const context = body?.context || {};
  const contextLines = [
    context?.userEmail ? `Usuario: ${context.userEmail}` : '',
    context?.incomeYTD != null ? `Ingresos acumulados: ${context.incomeYTD}` : '',
    context?.annualLimit != null ? `Límite anual: ${context.annualLimit}` : '',
    context?.riskLevel ? `Riesgo actual: ${context.riskLevel}` : '',
    context?.isDemo ? 'Modo: DEMO' : 'Modo: CUENTA REAL'
  ].filter(Boolean);

  const composed = [
    contextLines.length ? `Contexto:\n${contextLines.join('\n')}\n` : '',
    `Consulta del usuario:\n${message}`
  ].join('\n');

  return [
    {
      role: 'user',
      parts: [{ text: composed }]
    }
  ];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method Not Allowed' });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return json(res, 200, fallback('missing_api_key'));
  }

  const body = req.body && typeof req.body === 'object' ? req.body : null;
  if (!body) {
    return json(res, 400, { ok: false, error: 'Body inválido: se espera JSON.' });
  }

  const contents = buildContents(body);
  if (!contents) {
    return json(res, 400, { ok: false, error: 'Falta message o contents.' });
  }

  const payload = {
    contents,
    systemInstruction: body.systemInstruction || {
      parts: [{ text: SYSTEM_TEXT }]
    },
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 700,
      ...body.generationConfig
    }
  };

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (data?.error?.code === 429) return json(res, 200, fallback('quota_exhausted'));
      if (data?.error?.code === 404) return json(res, 200, fallback('model_unavailable'));
      return json(res, 200, fallback('api_error', data?.error?.message));
    }

    const reply = extractReply(data);
    if (!reply) {
      return json(res, 200, fallback('empty_response'));
    }

    return json(res, 200, {
      ok: true,
      is_fallback: false,
      reply,
      source: 'gemini-proxy',
      model: GEMINI_MODEL,
      raw: data
    });
  } catch (err) {
    return json(res, 200, fallback('network_error', err?.message));
  }
}