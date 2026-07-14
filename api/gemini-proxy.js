const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_TEXT = [
  'Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.',
  'Responde en español mexicano, claro, útil y accionable.',
  'No uses tecnicismos innecesarios.',
  'Reglas absolutas:',
  '- Límite anual RESICO PF: $3,500,000 MXN.',
  '- Umbrales: 80% preventivo, 90% riesgo alto, 94% riesgo de expulsión.',
  '- Buzón Tributario inactivo: multa hasta $10,260 MXN, pérdida de plazos y riesgo operativo.',
  '- No afirmes declaración anual para todos; primero valida si hubo ingresos mixtos.',
  '- ISR RESICO: sobre ingresos brutos efectivamente cobrados, sin deducciones.',
  '- IVA: requiere CFDI válido y gasto indispensable para acreditamiento.',
  '- Si falta contexto, pide el dato faltante antes de concluir.',
  '- Termina con una acción concreta.'
].join('\n');

function sendJson(res, status, payload, headers = {}) {
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify(payload));
}

function extractReply(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('\n')
      .trim() || ''
  );
}

function fallbackPayload(reason, hint, debug = {}) {
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
    debug,
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
    ctx?.isDemo ? 'Modo: DEMO' : 'Modo: CUENTA REAL'
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

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const debugEnabled =
    process.env.ALIADO_AI_DEBUG === 'true' ||
    req.headers['x-aliado-debug'] === '1';

  if (!apiKey) {
    const payload = fallbackPayload('missing_api_key', null, { env: 'GEMINI_API_KEY absent' });
    return sendJson(res, 200, payload, {
      'x-aliado-ai-status': 'fallback',
      'x-aliado-fallback-reason': 'missing_api_key'
    });
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
    const upstream = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const code = data?.error?.code || upstream.status;
      const message = data?.error?.message || `HTTP ${upstream.status}`;
      const reason =
        code === 429 ? 'quota_exhausted' :
        code === 404 ? 'model_unavailable' :
        'api_error';

      const fb = fallbackPayload(reason, debugEnabled ? message : null, {
        upstream_status: upstream.status,
        upstream_code: code,
        upstream_message: message
      });

      return sendJson(res, 200, fb, {
        'x-aliado-ai-status': 'fallback',
        'x-aliado-fallback-reason': reason
      });
    }

    const reply = extractReply(data);
    if (!reply) {
      const fb = fallbackPayload('empty_response', null, {
        upstream_status: upstream.status
      });
      return sendJson(res, 200, fb, {
        'x-aliado-ai-status': 'fallback',
        'x-aliado-fallback-reason': 'empty_response'
      });
    }

    return sendJson(
      res,
      200,
      {
        ok: true,
        is_fallback: false,
        fallback_reason: null,
        reply,
        source: 'gemini-proxy',
        model: GEMINI_MODEL,
        debug: debugEnabled ? { upstream_status: upstream.status } : undefined,
        raw: data
      },
      {
        'x-aliado-ai-status': 'ok'
      }
    );
  } catch (err) {
    const fb = fallbackPayload('network_error', debugEnabled ? err?.message : null, {
      error_message: err?.message || 'unknown_network_error'
    });
    return sendJson(res, 200, fb, {
      'x-aliado-ai-status': 'fallback',
      'x-aliado-fallback-reason': 'network_error'
    });
  }
}