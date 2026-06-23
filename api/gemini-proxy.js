/* ================================================
   ALIADO RESICO — Proxy Serverless v4.0
   Archivo: api/gemini-proxy.js
   Runtime: Node.js 24.x — ESM puro (export default)
   Modelo: gemini-2.0-flash (API estable v1, no v1beta)
   Art. 113-E LISR | Art. 17-K CFF | Art. 86-C CFF | LFPDPPP

   NOVEDADES v4.0:
   - Endpoint v1 (estable) — evita "Model not found" de v1beta.
   - Contrato is_fallback: si la cuota de Gemini se agota o la red
     falla, el proxy responde HTTP 200 con { is_fallback: true, ... }
     para que el frontend active las reglas locales sin romper la UX.
   ================================================ */

// API estable v1 (NO v1beta) — recomendada por Google API Standards 2026
const GEMINI_MODEL    = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

// Contexto fiscal inyectado server-side en cada llamada.
// El frontend no necesita duplicarlo — Gemini responde con normativa
// RESICO 2026 sin importar qué prompt llegue.
const SYSTEM_INSTRUCTION = {
  parts: [{
    text: `Eres el Asistente Fiscal RESICO 2026 de Aliado RESICO.
Reglas absolutas:
- Límite de ingresos RESICO: $3,500,000 MXN anuales (Art. 113-E LISR).
- Al superar el 94% ($3,300,000 MXN): alerta sobre expulsión al Régimen General de Actividad Empresarial.
- Buzón Tributario inactivo: multa de hasta $10,260 MXN (Art. 17-K CFF). La reincidencia duplica el monto (Art. 86-C CFF).
- ISR en RESICO: tasa fija 1%–2.5% sobre ingresos brutos cobrados. Sin deducciones de gastos.
- IVA: requiere CFDI 4.0 con RFC del receptor para acreditamiento (Art. 5 LIVA). Gasto estrictamente indispensable.
- Declaración anual (Art. 113-F LISR): NO es obligatoria para todos. Preguntar si hay ingresos mixtos antes de confirmar obligación.
- e.firma (Art. 17-D CFF): alertar con 90, 30 y 15 días de anticipación al vencimiento.
- Todos los datos están protegidos bajo LFPDPPP con Row Level Security (RLS) en Supabase.
Responde en español mexicano. Máx 250 palabras. Cita artículos cuando aplique.`,
  }],
};

/* ─────────────────────────────────────────────────
   FALLBACK GENÉRICO
   El frontend (classifier.js) espera candidates[].content.parts[].text.
   Devolvemos ese mismo contrato + bandera is_fallback para que las reglas
   locales tomen el control de forma elegante.
   ───────────────────────────────────────────────── */
function _fallbackResponse(reason, hint = '') {
  const text = hint || 'El servicio de IA no está disponible en este momento. ' +
    'Te puedo orientar con las reglas RESICO 2026: límite anual de $3,500,000 MXN ' +
    '(Art. 113-E LISR) y multa de hasta $10,260 MXN por Buzón Tributario inactivo ' +
    '(Art. 17-K CFF). ¿Sobre qué tema quieres ayuda?';
  return {
    is_fallback: true,
    fallback_reason: reason,
    candidates: [{
      content: { parts: [{ text }] },
      finishReason: 'FALLBACK',
    }],
  };
}

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
    // Contrato is_fallback: no bloqueamos al usuario por una mala config del deploy
    return res.status(200).json(_fallbackResponse('missing_api_key'));
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

    // ── Cuota agotada (429) → is_fallback, NO error ──
    if (data.error && data.error.code === 429) {
      console.warn('[gemini-proxy] Cuota de Gemini agotada → is_fallback:quota_exhausted');
      return res.status(200).json(_fallbackResponse('quota_exhausted'));
    }

    // ── Modelo no encontrado / no disponible → is_fallback ──
    if (data.error && (data.error.code === 404 || /not found|not supported/i.test(data.error.message || ''))) {
      console.warn('[gemini-proxy] Modelo no disponible:', data.error.message);
      return res.status(200).json(_fallbackResponse('model_unavailable'));
    }

    // ── Otro error de la API de Google → is_fallback ──
    if (data.error) {
      console.error('[gemini-proxy] Error Google:', data.error.message);
      return res.status(200).json(_fallbackResponse('api_error', data.error.message));
    }

    if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.error('[gemini-proxy] Respuesta sin texto:', JSON.stringify(data));
      return res.status(200).json(_fallbackResponse('empty_response'));
    }

    // Respuesta exitosa — marcador explícito de que vino de Gemini
    return res.status(200).json({ ...data, is_fallback: false });

  } catch (err) {
    console.error('[gemini-proxy] Error de red:', err.message);
    return res.status(200).json(_fallbackResponse('network_error', err.message));
  }
}
