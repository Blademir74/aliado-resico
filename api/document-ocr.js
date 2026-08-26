// api/document-ocr.js — v6.2 CERTIFICADO
// Cascada AI Studio → Vertex con reintento por parseo + prompt anti-refusal
// + debug completo en fallbacks. Safety Flag 85% (DOC02 TRD).
import crypto from 'node:crypto';

const ENGINE = 'ocr-v6.4';
const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app','https://aliadoresico.com','https://www.aliadoresico.com',
  'http://localhost:3000','http://127.0.0.1:3000','http://localhost:5500','http://127.0.0.1:5500'
];
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const VERTEX_MODEL = process.env.VERTEX_MODEL || 'gemini-2.0-flash-001';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || '';
const AI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];

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
const MAGIC_SIGNATURES = { 'image/jpeg': ['FFD8FF'], 'image/png': ['89504E47'], 'image/webp': ['52494646'], 'application/pdf': ['25504446'] };
function validateMagicNumber(base64Data, claimedMime) {
  if (!base64Data || typeof base64Data !== 'string') return { valid: false, reason: 'Datos vacíos' };
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length < 8) return { valid: false, reason: 'Archivo muy pequeño' };
    const hexHead = buffer.slice(0, 4).toString('hex').toUpperCase();
    if (!MAGIC_SIGNATURES[claimedMime]) return { valid: false, reason: `MIME no permitido: ${claimedMime}` };
    if (!MAGIC_SIGNATURES[claimedMime].some(sig => hexHead.startsWith(sig))) return { valid: false, reason: `Firma binaria no coincide con ${claimedMime}.` };
    return { valid: true, mime: claimedMime };
  } catch (e) { return { valid: false, reason: 'Error al validar: ' + e.message }; }
}
function setHeaders(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-demo-mode');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function parseBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}
function normalizeDocType(v) {
  const t = String(v || '').trim().toUpperCase();
  return new Set(['CFDI','TICKET','CONSTANCIA','OPINION','EFIRMA','OTRO']).has(t) ? t : 'OTRO';
}
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
function tolerantParse(jsonText) {
  try { return JSON.parse(jsonText); } catch {}
  // ── Reparar JSON truncado (corte por maxOutputTokens) ─────────────────
  let s = jsonText;
  s = s.replace(/,\s*"[^"]*"?\s*$/, '');          // coma o clave incompleta al final
  s = s.replace(/:\s*"[^"]*$/, ': null');          // valor de texto cortado
  const openB = (s.match(/{/g) || []).length - (s.match(/}/g) || []).length;
  const openK = (s.match(/\[/g) || []).length - (s.match(/]/g) || []).length;
  s += ']'.repeat(Math.max(0, openK)) + '}'.repeat(Math.max(0, openB));
  try { return JSON.parse(s); } catch { return null; }
}
function safeParse(raw) {
  const jsonText = extractJSON(raw);
  if (!jsonText) return null;
  const parsed = tolerantParse(jsonText);
  return parsed ? normalizeKeys(parsed) : null;
}
function buildFallback(reason, fileName = '', debug = {}) {
  return {
    ok: true, is_fallback: true, reason, engine: ENGINE, debug,
    document: {
      file_name: fileName || 'documento', doc_type: 'OTRO', document_type: 'OTRO',
      confidence: 0.5, file_url: `local:${fileName || 'documento'}`,
      extracted_data: { rfc_emisor: null, rfc_receptor: null, nombre_emisor: null, subtotal: null, iva: null, total: null, folio: null, fecha: null, summary: null, tax_usefulness: null },
      safety_flag: true, validation_status: 'pendiente', needs_review: true,
      source: 'ocr_fallback',
      pedagogical_note: 'ISR RESICO: sin deducciones. IVA: requiere CFDI válido y gasto indispensable para acreditamiento.'
    },
    needsHumanReview: true
  };
}
// ── Vertex: Service Account → token (cache 55 min) ──────────────────────
function base64url(input) { return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
const _tok = { token: null, exp: 0 };
function canUseVertex() {
  return Boolean(VERTEX_PROJECT_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
}
async function googleToken() {
  if (_tok.token && _tok.exp > Date.now() + 60000) return _tok.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key, 'base64');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${claims}.${sig}`
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`oauth_token_error: ${d.error || r.status}`);
  _tok = { token: d.access_token, exp: Date.now() + 55 * 60 * 1000 };
  return d.access_token;
}
// ── Prompt anti-refusal: SIEMPRE JSON, aunque no lea datos ──────────────
const PROMPT = [
  'Eres un extractor fiscal mexicano especializado en RESICO 2026.',
  'Analiza el documento y responde SOLO JSON válido, sin markdown y sin explicaciones.',
  'IMPORTANTE: Aunque la imagen esté borrosa o no encuentres datos, responde SIEMPRE el JSON con los campos en null y confidence 0.4.',
  'Detecta si es CFDI, ticket, constancia, opinión de cumplimiento, e.firma u otro.',
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
function geminiBody(mimeType, base64Data) {
  return {
    contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
    generationConfig: { temperature: 0.05, topP: 0.9, maxOutputTokens: 2048, responseMimeType: 'application/json' }
  };
}
// ── Cascada con reintento por parseo: AI Studio → Vertex ────────────────
async function tryProviders(gBody, tried) {
  if (process.env.GEMINI_API_KEY) {
    for (const m of AI_MODELS) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gBody)
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data?.error) { tried.push({ provider: `ai-studio:${m}`, http: r.status, err: data?.error?.message || 'http_error' }); continue; }
        const raw = extractReplyText(data);
        const parsed = safeParse(raw);
        if (parsed) return { parsed, model: `ai-studio:${m}` };
        tried.push({ provider: `ai-studio:${m}`, http: r.status, err: 'no_json', raw_preview: raw.slice(0, 300) });
      } catch (e) { tried.push({ provider: `ai-studio:${m}`, err: e.message }); }
    }
  }
  if (canUseVertex()) {
    try {
      const token = await googleToken();
      const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(gBody) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data?.error) { tried.push({ provider: 'vertex', http: r.status, err: data?.error?.message || 'http_error' }); }
      else {
        const raw = extractReplyText(data);
        const parsed = safeParse(raw);
        if (parsed) return { parsed, model: `vertex:${VERTEX_MODEL}` };
        tried.push({ provider: 'vertex', http: r.status, err: 'no_json', raw_preview: raw.slice(0, 300) });
      }
    } catch (e) { tried.push({ provider: 'vertex', err: e.message }); }
  }
  return null;
}

export default async function handler(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed', engine: ENGINE });

  const isDemo = req.headers['x-demo-mode'] === 'true';
  const user = await validateSupabaseJWT(req.headers.authorization);
  if (!user && !isDemo) return res.status(401).json({ ok: false, error: 'No autorizado. Se requiere sesión activa o modo demo.', engine: ENGINE });
  const ip = String(req.headers['x-forwarded-for'] || 'local');
  if (!user && !rateLimit(ip, 10)) return res.status(429).json({ ok: false, error: 'Límite de OCR en demo alcanzado.', engine: ENGINE });
  if (user && !rateLimit(user.uid, 30)) return res.status(429).json({ ok: false, error: 'Límite de procesamiento alcanzado.', engine: ENGINE });

  const body = parseBody(req);
  const { fileName, mimeType, base64Data } = body;
  const magicCheck = validateMagicNumber(base64Data, mimeType);
  if (!magicCheck.valid) return res.status(400).json({ ok: false, error: `Archivo inválido: ${magicCheck.reason}`, engine: ENGINE });
  if (!fileName || !mimeType || !base64Data) return res.status(400).json({ ok: false, error: 'fileName, mimeType y base64Data requeridos.', engine: ENGINE });
  if (!process.env.GEMINI_API_KEY && !canUseVertex()) return res.status(200).json(buildFallback('missing_credentials', fileName));

  const tried = [];
  const outcome = await tryProviders(geminiBody(mimeType, base64Data), tried);
  if (!outcome) return res.status(200).json(buildFallback('all_providers_failed', fileName, { tried }));

  const parsed = outcome.parsed;
  const docType = normalizeDocType(parsed.document_type);
  let confidence = Number(parsed.confidence || 0);
  // ── Heurística de auditoría: subtotal + IVA ≈ total (Art. 29-A CFF) ────
  const sub = Number(parsed.subtotal ?? 0), iv = Number(parsed.iva ?? 0), tot = Number(parsed.total ?? 0);
  const hasNums = tot > 0;
  const sumOk = !hasNums || Math.abs(sub + iv - tot) <= Math.max(1, tot * 0.05);
  const ivaOk = !hasNums || iv <= tot;
  if (hasNums && (!sumOk || !ivaOk)) {
    confidence = Math.min(confidence, 0.7); // fuerza Verificación Humana (<85%)
  }
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
          doc.safety_flag = true; doc.needs_review = true;
          doc.validation_status = 'RFC_receptor_no_coincide';
          doc.extracted_data.warning = `⚠️ El RFC receptor (${rec}) no coincide con tu RFC (${userRfc}). NO acreditable para IVA.`;
        }
      } catch (e) { console.warn('[document-ocr] validación receptor:', e.message); }
    }
  }
  return res.status(200).json({ ok: true, engine: ENGINE, is_fallback: false, model: outcome.model, document: doc, needsHumanReview: safetyFlag });
}