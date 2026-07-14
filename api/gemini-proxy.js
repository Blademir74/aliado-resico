const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_TEXT = [
  'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
  'Responde en español mexicano, claro, breve y accionable.',
  'Reglas absolutas:',
  '- Límite anual RESICO PF: $3,500,000 MXN.',
  '- Umbrales: 80% preventivo, 90% riesgo alto, 94% riesgo de expulsión.',
  '- Buzón Tributario inactivo: multa hasta $10,260 MXN y pérdida de plazos.',
  '- No afirmes declaración anual para todos; primero valida si hubo ingresos mixtos.',
  '- ISR RESICO: sobre ingresos brutos efectivamente cobrados, sin deducciones.',
  '- IVA: requiere CFDI válido y gasto indispensable para acreditamiento.',
  '- Si falta contexto, pide el dato faltante antes de concluir.',
  '- Cierra con una recomendación concreta.'
].join('\n');

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function extractReply(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('\n')
      .trim() || ''
  );
}

function fallbackResponse(reason, hint) {
  const reply =
    hint ||
    'La IA no está disponible en este momento. Regla base RESICO 2026: monitorea el límite de $3,500,000 MXN, revisa ingresos mixtos antes de confirmar anual y mantén activo tu Buzón Tributario.';
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

  const ctx = body?.context || {};
  const lines = [
    ctx?.userEmail ? `Usuario: ${ctx.userEmail}` : '',
    ctx?.incomeYTD != null ? `Ingresos acumulados: ${ctx.incomeYTD}` : '',
    ctx?.annualLimit != null ? `Límite anual: ${ctx.annualLimit}` : '',
    ctx?.riskLevel ? `Nivel de riesgo: ${ctx.riskLevel}` : '',
    ctx?.isDemo ? 'Modo DEMO' : 'Modo CUENTA REAL'
  ].filter(Boolean);

  return [
    {
      role: 'user',
      parts: [
        {
          text: [
            lines.length ? `Contexto fiscal:\n${lines.join('\n')}\n` : '',
            `Consulta del usuario:\n${message}`
          ].join('\n')
        }
      ]
    }
  ];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendJson(res, 200, fallbackResponse('missing_api_key'));
  }

  const body = req.body && typeof req.body === 'object' ? req.body : null;
  if (!body) {
    return sendJson(res, 400, { ok: false, error: 'Body inválido: se espera JSON.' });
  }

  const contents = buildContents(body);
  if (!contents) {
    return sendJson(res, 400, { ok: false, error: 'Falta message o contents.' });
  }

  const payload = {
    contents,
    system_instruction: {
      parts: [{ text: SYSTEM_TEXT }]
    },
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 700
    }
  };

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (data?.error?.code === 429) {
        return sendJson(res, 200, fallbackResponse('quota_exhausted'));
      }
      if (data?.error?.code === 404) {
        return sendJson(res, 200, fallbackResponse('model_unavailable'));
      }
      return sendJson(
        res,
        200,
        fallbackResponse('api_error', data?.error?.message || 'Error de Gemini API')
      );
    }

    const reply = extractReply(data);
    if (!reply) {
      return sendJson(res, 200, fallbackResponse('empty_response'));
    }

    return sendJson(res, 200, {
      ok: true,
      is_fallback: false,
      reply,
      source: 'gemini-proxy',
      model: GEMINI_MODEL,
      raw: data
    });
  } catch (err) {
    return sendJson(
      res,
      200,
      fallbackResponse('network_error', err?.message || 'Error de red')
    );
  }
}