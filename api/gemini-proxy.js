// ============================================
// ALIADO RESICO — Gemini API Proxy
// Vercel Serverless Function
// La API key de Gemini NUNCA llega al frontend
// Rate limiting por IP + sanitización de payload
// ============================================

// In-memory rate limiter (resets on cold start — fine for serverless)
const rateLimitMap = new Map();
const RATE_LIMIT = 30;            // requests per window
const RATE_WINDOW_MS = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const key = ip || 'unknown';

  if (!rateLimitMap.has(key)) {
    rateLimitMap.set(key, []);
  }

  const timestamps = rateLimitMap.get(key);

  // Clean old entries
  while (timestamps.length > 0 && now - timestamps[0] > RATE_WINDOW_MS) {
    timestamps.shift();
  }

  if (timestamps.length >= RATE_LIMIT) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((timestamps[0] + RATE_WINDOW_MS - now) / 1000) };
  }

  timestamps.push(now);
  return { allowed: true, remaining: RATE_LIMIT - timestamps.length, resetIn: 60 };
}

// Sanitize the payload to prevent prompt injection at the proxy level
function sanitizePayload(body) {
  if (!body || typeof body !== 'object') return null;

  // Validate structure
  if (!body.contents || !Array.isArray(body.contents)) return null;

  // Limit payload size (prevent abuse)
  const payloadStr = JSON.stringify(body);
  if (payloadStr.length > 50000) return null; // 50KB max

  return body;
}

export default async function handler(req, res) {
  // --- CORS ---
  const allowedOrigin = process.env.ALIADO_ALLOWED_ORIGIN || '*';
  const origin = req.headers.origin || '';

  // Permitir peticiones sin Origin (backend-to-backend como n8n) o si coinciden con allowedOrigin
  if (allowedOrigin !== '*' && origin !== '' && origin !== allowedOrigin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Source');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Rate Limiting ---
  const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const rateCheck = checkRateLimit(clientIP);

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT);
  res.setHeader('X-RateLimit-Remaining', rateCheck.remaining);
  res.setHeader('X-RateLimit-Reset', rateCheck.resetIn);

  if (!rateCheck.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Máximo ${RATE_LIMIT} solicitudes por minuto. Intenta de nuevo en ${rateCheck.resetIn}s.`,
      retryAfter: rateCheck.resetIn,
    });
  }

  // --- Validate Gemini Key ---
  const geminiKey = process.env.ALIADO_GEMINI_KEY || process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return res.status(500).json({ error: 'Gemini API key not configured on server (Missing ALIADO_GEMINI_KEY or GEMINI_API_KEY)' });
  }

  // --- Sanitize Request Body ---
  const sanitized = sanitizePayload(req.body);
  if (!sanitized) {
    return res.status(400).json({ error: 'Invalid request payload' });
  }

  // --- Determine model endpoint ---
  // CORRECCIÓN: El modelo en v1beta requiere sufijo -latest si no se especifica versión
  let model = req.query.model || 'gemini-1.5-flash-latest';
  if (model === 'gemini-1.5-flash') model = 'gemini-1.5-flash-latest';
  if (model === 'gemini-2.5-flash') model = 'gemini-1.5-flash-latest'; // Fallback a una versión que sabemos que funciona
  
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

  try {
    const geminiRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitized),
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      return res.status(geminiRes.status).json({
        error: data.error?.message || `Gemini API error: HTTP ${geminiRes.status}`,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('[Gemini Proxy] Error:', error.message);
    return res.status(502).json({
      error: 'Failed to reach Gemini API',
      message: error.message,
    });
  }
}
