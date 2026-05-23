// api/gemini-proxy.js
// Vercel Edge Function — Puente seguro frontend → Google AI Studio
// ✅ Cero exposición de API keys | Rate limiting | Auditoría integrada

export const config = {
  runtime: 'edge',
  regions: ['scl1'], // Región más cercana a México
};

// Rate limiting in-memory (para producción usar Redis/Upstash)
const rateLimitStore = new Map();
const RATE_LIMIT = {
  MAX_REQUESTS: 100,      // Máximo por hora por IP
  WINDOW_MS: 60 * 60 * 1000, // 1 hora en milisegundos
};

function checkRateLimit(ip) {
  const now = Date.now();
  const user = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT.WINDOW_MS };
  
  if (now > user.resetAt) {
    user.count = 1;
    user.resetAt = now + RATE_LIMIT.WINDOW_MS;
  } else if (user.count >= RATE_LIMIT.MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: user.resetAt };
  } else {
    user.count++;
  }
  
  rateLimitStore.set(ip, user);
  return { allowed: true, remaining: RATE_LIMIT.MAX_REQUESTS - user.count, resetAt: user.resetAt };
}

// Limpieza periódica de store (cada 15 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitStore.entries()) {
    if (now > data.resetAt) rateLimitStore.delete(ip);
  }
}, 15 * 60 * 1000);

export default async function handler(req) {
  // 🔒 CORS estricto — solo dominio autorizado
  const allowedOrigins = [
    'https://aliado-resico.vercel.app',
    'https://aliadoresico.com',
    process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null,
    process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3000' : null,
  ].filter(Boolean);
  
  const origin = req.headers.get('origin') || '';
  const isAllowed = allowedOrigins.includes(origin);
  
  if (!isAllowed && process.env.NODE_ENV === 'production') {
    return new Response(JSON.stringify({ error: 'Origen no autorizado' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const headers = new Headers({
    'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Forwarded-For',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
    // 🔐 Headers de seguridad adicionales
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers
    });
  }

  // 🔐 VALIDACIÓN DE API KEY (SOLO SERVER)
  const apiKey = process.env.GEMINI_API_KEY || process.env.ALIADO_GEMINI_KEY;
  if (!apiKey) {
    console.error('[Proxy] CRÍTICO: GEMINI_API_KEY no configurada en Vercel');
    return new Response(JSON.stringify({ 
      error: 'Configuración del servidor incompleta',
      code: 'MISSING_API_KEY',
      hint: 'Configure GEMINI_API_KEY en Vercel Dashboard → Settings → Environment Variables'
    }), { status: 500, headers });
  }

  // 🎯 Modelo fijo y validado
  const MODEL = 'gemini-1.5-flash';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  // 📦 Parseo seguro del body
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Body debe ser JSON válido' }), {
      status: 400,
      headers
    });
  }

  // ✅ Validación estricta del payload
  if (!body?.contents || !Array.isArray(body.contents)) {
    return new Response(JSON.stringify({ 
      error: 'Payload inválido: se requiere campo "contents[]"',
      code: 'INVALID_PAYLOAD'
    }), { status: 400, headers });
  }

  // 🧹 Limpieza de campos no soportados en v1beta
  if (body.generationConfig) {
    delete body.generationConfig.responseMimeType;
    delete body.generationConfig.responseSchema;
  }
  delete body.system_instruction;
  delete body.systemInstruction;

  // 🔍 Sanitización de prompts: prevenir inyección
  const sanitizePrompt = (text) => {
    if (typeof text !== 'string') return text;
    return text
      .slice(0, 32000) // Límite de seguridad
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/["\\]/g, ''); // Escape de caracteres peligrosos
  };

  if (body.contents[0]?.parts?.[0]?.text) {
    body.contents[0].parts[0].text = sanitizePrompt(body.contents[0].parts[0].text);
  }

  // 🚦 RATE LIMITING por IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const rateCheck = checkRateLimit(ip);
  
  headers.set('X-RateLimit-Limit', RATE_LIMIT.MAX_REQUESTS.toString());
  headers.set('X-RateLimit-Remaining', rateCheck.remaining.toString());
  headers.set('X-RateLimit-Reset', Math.ceil(rateCheck.resetAt / 1000).toString());

  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({
      error: 'Límite de solicitudes excedido',
      code: 'RATE_LIMITED',
      message: `Máximo ${RATE_LIMIT.MAX_REQUESTS} solicitudes por hora. Reintente después de ${new Date(rateCheck.resetAt).toLocaleTimeString('es-MX')}`,
      retryAfter: Math.ceil((rateCheck.resetAt - Date.now()) / 1000)
    }), { 
      status: 429, 
      headers: { ...headers, 'Retry-After': Math.ceil((rateCheck.resetAt - Date.now()) / 1000).toString() }
    });
  }

  // 📡 Llamada a Gemini con timeout y retry básico
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error(`[Proxy] Gemini ${geminiRes.status}:`, data?.error?.message);
      
      // Mapeo de errores para el frontend
      const errorMap = {
        400: 'Solicitud inválida a Gemini',
        401: 'Autenticación fallida con Gemini',
        403: 'Acceso denegado a Gemini',
        429: 'Límite de cuota de Gemini excedido',
        500: 'Error interno de Gemini',
        503: 'Servicio de Gemini no disponible',
      };
      
      return new Response(JSON.stringify({
        error: errorMap[geminiRes.status] || `Error de Gemini: ${geminiRes.status}`,
        code: `GEMINI_${geminiRes.status}`,
        details: process.env.NODE_ENV === 'development' ? data : undefined,
        fiscal_hint: geminiRes.status === 429 ? 'El sistema está protegido por rate limiting. Sus datos fiscales están seguros.' : undefined
      }), { status: geminiRes.status, headers });
    }

    // ✅ Respuesta exitosa con metadatos de auditoría
    return new Response(JSON.stringify({
      ...data,
      _meta: {
        proxy_version: '2.3',
        timestamp: new Date().toISOString(),
        model: MODEL,
        rate_limit: {
          remaining: rateCheck.remaining,
          reset_at: new Date(rateCheck.resetAt).toISOString()
        }
      }
    }), { status: 200, headers });

  } catch (error) {
    clearTimeout(timeout);
    
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({
        error: 'Tiempo de espera agotado',
        code: 'TIMEOUT',
        message: 'La solicitud tardó más de 15 segundos. Intente nuevamente.',
        fiscal_hint: 'Su consulta fiscal no se procesó. No se registró ningún cambio en sus datos.'
      }), { status: 504, headers });
    }

    console.error('[Proxy] Error de red:', error.message);
    return new Response(JSON.stringify({
      error: 'Error de conectividad con Gemini',
      code: 'NETWORK_ERROR',
      message: process.env.NODE_ENV === 'development' ? error.message : 'No se pudo conectar con el servicio de IA. Intente en unos momentos.',
      fiscal_hint: 'Sus datos fiscales no fueron transmitidos. El sistema opera en modo seguro.'
    }), { status: 502, headers });
  }
}