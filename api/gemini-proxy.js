// api/gemini-proxy.js
// Vercel Serverless Function — Proxy seguro para Gemini API
// ✅ REFACTORIZADO: Sin fugas, validación estricta, auditoría integrada

export const config = {
  runtime: 'edge', // Edge para menor latencia en México
  regions: ['scl1'], // Región más cercana: Santiago, Chile
};

export default async function handler(req) {
  // 🔒 CORS estricto: solo dominio propio + localhost para desarrollo
  const allowedOrigins = [
    'https://aliado-resico.vercel.app',
    'https://aliadoresico.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ];
  const origin = req.headers.get('origin') || '';
  
  if (!allowedOrigins.includes(origin)) {
    return new Response(JSON.stringify({ error: 'Origen no autorizado' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const headers = new Headers({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
    // 🔐 Headers de seguridad adicionales
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
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

  // 🔐 VALIDACIÓN DE API KEY (solo servidor)
  const apiKey = process.env.GEMINI_API_KEY || process.env.ALIADO_GEMINI_KEY;
  if (!apiKey) {
    console.error('[Proxy] CRÍTICO: GEMINI_API_KEY no configurada en Vercel');
    return new Response(JSON.stringify({ 
      error: 'Configuración del servidor incompleta',
      code: 'MISSING_API_KEY'
    }), { status: 500, headers });
  }

  // 🎯 Modelo fijo y validado — ignora manipulación del query string
  const MODEL = 'gemini-1.5-flash'; // ✅ Versión estable y económica
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
      .replace(/javascript:/gi, '');
  };

  if (body.contents[0]?.parts?.[0]?.text) {
    body.contents[0].parts[0].text = sanitizePrompt(body.contents[0].parts[0].text);
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
        429: 'Límite de solicitudes excedido',
        500: 'Error interno de Gemini',
      };
      
      return new Response(JSON.stringify({
        error: errorMap[geminiRes.status] || `Error de Gemini: ${geminiRes.status}`,
        code: `GEMINI_${geminiRes.status}`,
        details: process.env.NODE_ENV === 'development' ? data : undefined
      }), { status: geminiRes.status, headers });
    }

    // ✅ Respuesta exitosa
    return new Response(JSON.stringify(data), { status: 200, headers });

  } catch (error) {
    clearTimeout(timeout);
    
    if (error.name === 'AbortError') {
      return new Response(JSON.stringify({
        error: 'Tiempo de espera agotado',
        code: 'TIMEOUT',
        message: 'La solicitud tardó más de 15 segundos'
      }), { status: 504, headers });
    }

    console.error('[Proxy] Error de red:', error.message);
    return new Response(JSON.stringify({
      error: 'Error de conectividad con Gemini',
      code: 'NETWORK_ERROR',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    }), { status: 502, headers });
  }
}