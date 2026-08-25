// api/document-ocr.js — v5.0 CERTIFICADO
// OCR fiscal real con Gemini Vision. Acepta sesión real O demo (rate-limited).
// Cumplimiento: Art. 17-D CFF (e.firma) · Diferenciador ISR/IVA (DOC02 TRD).
import crypto from 'node:crypto';

const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app','https://aliadoresico.com','https://www.aliadoresico.com',
  'http://localhost:3000','http://127.0.0.1:3000','http://localhost:5500','http://127.0.0.1:5500'
];
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ── Rate limit (demo: 10/min por IP; autenticado: 30/min) ───────────────
const _rl = new Map();
function rateLimit(key, max) {
  const now = Date.now();
  let b = _rl.get(key);
  if (!b || now - b.start > 60000) b = { start: now, n: 0 };
  b.n++; _rl.set(key, b);
  return b.n <= max;
}

async function validateSupabaseJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    if (SUPABASE_JWT_SECRET) {
      const exp = crypto.createHmac('sha256', SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest('base64url');
      const a = Buffer.from(s, 'base64url'), b2 = Buffer.from(exp, 'base64url');
      if (a.length !== b2.length || !crypto.timingSafeEqual(a, b2)) return null;
    }
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role === 'service_role') return null;
    return { uid: payload.sub || null, email: payload.email || null };
  } catch { return null; }
}

// ── Magic number: MIME real desde bytes, no extensión ───────────────────
const MAGIC_SIGNATURES = {
  'image/jpeg': ['FFD8FF'], 'image/png': ['89504E47'],
  'image/webp': ['52494646'], 'application/pdf': ['25504446']
};
function validateMagicNumber(base64Data, claimedMime) {
  if (!base64Data || typeof base64Data !== 'string') return { valid: false, reason: 'Datos vacíos' };
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length < 8) return { valid: false, reason: 'Archivo muy pequeño' };
    const hexHead = buffer.slice(0, 4).toString('hex').toUpperCase();
    if (!MAGIC_SIGNATURES[claimedMime]) return { valid: false, reason: `MIME no permitido: ${claimedMime}` };
    if (!MAGIC_SIGNATURES[claimedMime].some(sig => hexHead.startsWith(sig))) {
      return { valid: false, reason: `Firma binaria no coincide con ${claimedMime}.` };
    }
    return { valid: true, mime: claimedMime };
  } catch (e) { return { valid: false, reason: 'Error al validar: ' + e.message }; }
}

function resolveOrigin(origin = '') {
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}
function setHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveOrigin(req.headers.origin || ''));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-demo-mode');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}
function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}
function normalizeDocType(value) {
  const v = String(value || '').trim().toUpperCase();
  return new Set(['CFDI','TICKET','CONSTANCIA','OPINION','EFIRMA','OTRO']).has(v) ? v : 'OTRO';
}
// ── FIX CRÍTICO: normaliza llaves (Gemini a veces devuelve espacios) ────
function normalizeKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k.trim()] = v;
  return out;
}
function extractReplyText(data) {
  return data?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('\n').trim() || '';
}
function extractJSON(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = cleaned.indexOf('{'), e = cleaned.lastIndexOf('}');
  if (s === -1 || e <= s) return null;
  return cleaned.slice(s, e + 1);
}
function buildFallback(reason, fileName = '') {
  return {
    ok: true, is_fallback: true, reason,
    document: {
      file_name: fileName || 'documento', doc_type: 'OTRO', document_type: 'OTRO',
      confidence: 0.5, file_url: `local:${fileName || 'documento'}`,
      extracted_data: { rfc_emisor: null, rfc_receptor: null, subtotal: null, iva: null, total: null, folio: null, fecha: null, summary: null, tax_usefulness: null },
      safety_flag: true, validation_status: 'pendiente', needs_review: true,
      source: 'ocr_fallback',
      pedagogical_note: 'ISR RESICO: sin deducciones. IVA: requiere CFDI válido y gasto indispensable para acreditamiento.'
    },
    needsHumanReview: true
  };
}

export default async function handler(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });

  // ── AUTH: sesión real O demo con rate-limit estricto ──────────────────
  const isDemo = req.headers['x-demo-mode'] === 'true';
  const user = await validateSupabaseJWT(req.headers.authorization);
  if (!user && !isDemo) return res.status(401).json({ ok: false, error: 'No autorizado. Se requiere sesión activa de Supabase.' });
  const ip = String(req.headers['x-forwarded-for'] || 'local');
  if (!user && !rateLimit(ip, 10)) return res.status(429).json({ ok: false, error: 'Límite de OCR en demo alcanzado. Inicia sesión para continuar.' });
  if (user && !rateLimit(user.uid, 30)) return res.status(429).json({ ok: false, error: 'Límite de procesamiento alcanzado. Intenta en un minuto.' });

  const body = parseBody(req);
  const { fileName, mimeType, base64Data } = body;
  const magicCheck = validateMagicNumber(base64Data, mimeType);
  if (!magicCheck.valid) return res.status(400).json({ ok: false, error: `Archivo inválido: ${magicCheck.reason}`, hint: 'Sube una imagen (JPG/PNG/WEBP) o PDF válido.' });

  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!apiKey) return res.status(200).json(buildFallback('missing_api_key', fileName || ''));
  if (!fileName || !mimeType || !base64Data) return res.status(400).json({ ok: false, error: 'fileName, mimeType y base64Data son requeridos.' });

  // ── PROMPT con llaves LIMPIAS (sin espacios) ──────────────────────────
  const prompt = [
    'Eres un extractor fiscal mexicano especializado en RESICO 2026.',
    'Analiza el documento y responde SOLO JSON válido, sin markdown.',
    'Detecta si es CFDI, ticket, constancia, opinión de cumplimiento, e.firma u otro.',
    'Si falta un dato, devuelve null.',
    'Responde con esta forma exacta:',
    '{',
    '  "document_type": "CFDI|TICKET|CONSTANCIA|OPINION|EFIRMA|OTRO",',
    '  "confidence": 0.97,',
    '  "rfc_emisor": "string|null",',
    '  "rfc_receptor": "string|null",',
    '  "nombre_emisor": "string|null",',
    '  "subtotal": 123.45,',
    '  "iva": 19.76,',
    '  "total": 143.21,',
    '  "folio": "string|null",',
    '  "fecha": "YYYY-MM-DD|null",',
    '  "summary": "breve",',
    '  "tax_usefulness": "IVA|ISR|AMBOS|NINGUNO"',
    '}',
    'Regla fiscal pedagógica: ISR RESICO no deduce gastos; IVA solo acreditable con CFDI válido y gasto indispensable.'
  ].join('\n');

  try {
    const upstream = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
        generationConfig: { temperature: 0.05, topP: 0.9, maxOutputTokens: 700 }
      })
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok || data?.error) return res.status(200).json(buildFallback('gemini_error', fileName));
    const jsonText = extractJSON(extractReplyText(data));
    if (!jsonText) return res.status(200).json(buildFallback('empty_response', fileName));
    let parsed;
    try { parsed = normalizeKeys(JSON.parse(jsonText)); } catch { return res.status(200).json(buildFallback('invalid_json', fileName)); }

    const docType = normalizeDocType(parsed.document_type);
    const confidence = Number(parsed.confidence || 0);
    const safetyFlag = confidence < 0.85;

    const doc = {
      file_name: fileName, doc_type: docType, document_type: docType, confidence,
      file_url: `local:${fileName}`,
      extracted_data: {
        rfc_emisor: parsed.rfc_emisor || null, rfc_receptor: parsed.rfc_receptor || null,
        nombre_emisor: parsed.nombre_emisor || null,
        subtotal: parsed.subtotal ?? null, iva: parsed.iva ?? null, total: parsed.total ?? null,
        folio: parsed.folio || null, fecha: parsed.fecha || null,
        summary: parsed.summary || null, tax_usefulness: parsed.tax_usefulness || null
      },
      safety_flag: safetyFlag, validation_status: 'pendiente', needs_review: safetyFlag,
      source: isDemo ? 'ocr_ai_demo' : 'ocr_ai',
      pedagogical_note: 'ISR RESICO: sin deducciones. IVA: requiere CFDI válido y gasto indispensable para acreditamiento.'
    };

    // ── Validación de RFC receptor contra el usuario (solo sesión real) ──
    if (user && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const rec = String(doc.extracted_data.rfc_receptor || '').toUpperCase().trim();
      if (rec && rec !== 'XAXX010101000' && rec !== 'XEXX010101000') {
        try {
          const pr = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${user.uid}&select=rfc`, {
            headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
          });
          const profiles = await pr.json();
          const userRfc = Array.isArray(profiles) && profiles[0]?.rfc ? profiles[0].rfc.toUpperCase().trim() : null;
          if (userRfc && rec !== userRfc) {
            doc.extracted_data.rfc_receptor_mismatch = true;
            doc.extracted_data.rfc_receptor_expected = userRfc;
            doc.safety_flag = true; doc.needs_review = true;
            doc.validation_status = 'RFC_receptor_no_coincide';
            doc.extracted_data.warning = `⚠️ El RFC receptor (${rec}) no coincide con tu RFC (${userRfc}). Este documento NO es acreditable para IVA.`;
          }
        } catch (e) { console.warn('[document-ocr] validación receptor:', e.message); }
      }
    }
    return res.status(200).json({ ok: true, is_fallback: false, document: doc, needsHumanReview: safetyFlag, model: GEMINI_MODEL });
  } catch (error) {
    return res.status(200).json(buildFallback(error?.message || 'network_error', fileName));
  }
}