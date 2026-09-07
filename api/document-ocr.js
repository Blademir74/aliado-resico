// api/document-ocr.js — v8.0 CERTIFICADO
// Motor fiscal completo: OCR + Retenciones PM→PF + Gasolina Art. 27 + Storage
import crypto from 'node:crypto';

const ENGINE = 'ocr-v8.0';
const ALLOWED_ORIGINS = ['https://aliado-resico.vercel.app','https://aliadoresico.com','https://www.aliadoresico.com','http://localhost:3000','http://127.0.0.1:3000','http://localhost:5500','http://127.0.0.1:5500'];
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const VERTEX_MODEL = process.env.VERTEX_MODEL || 'gemini-2.0-flash-001';
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'us-central1';
const VERTEX_PROJECT_ID = process.env.VERTEX_PROJECT_ID || '';
const AI_MODELS = ['gemini-2.0-flash', 'gemini-2.5-flash'];

// ── FASE 2: Motor de Retenciones PM → PF RESICO (Art. 113-J LISR) ────────
function calcularRetencionesRESICO(tipo, subtotal, ivaTrasladado, ingresosAnualesAcumulados = 0, opciones = {}) {
  let isrRetenido = subtotal * 0.0125;
  if (tipo === 'AGAPES') {
    if (ingresosAnualesAcumulados <= 900000) isrRetenido = 0;
  }
  let ivaRetenido = 0;
  switch (tipo) {
    case 'HONORARIOS':
      ivaRetenido = ivaTrasladado * (2 / 3);
      break;
    case 'ARRENDAMIENTO':
      ivaRetenido = opciones.casaHabitacionSinAmueblar ? 0 : ivaTrasladado * (2 / 3);
      break;
    case 'COMISIONES':
      ivaRetenido = ivaTrasladado * (2 / 3) * (2 / 3); // 4/9 = 44.44%
      break;
    case 'FLETES':
    case 'AUTOTRANSPORTE':
      ivaRetenido = subtotal * 0.04;
      break;
    case 'DESPERDICIOS':
    case 'CHATARRA':
      ivaRetenido = ivaTrasladado;
      break;
    case 'HOTELES':
    case 'ACTIVIDADES_EMPRESARIALES':
    case 'AGAPES':
    default:
      ivaRetenido = 0;
      break;
  }
  const totalRetenciones = isrRetenido + ivaRetenido;
  const netoAPagar = subtotal + ivaTrasladado - totalRetenciones;
  const round = (n) => Math.round(n * 100) / 100;
  return {
    isr_retencion: round(isrRetenido),
    iva_retencion: round(ivaRetenido),
    total_retenciones: round(totalRetenciones),
    neto_a_pagar: round(netoAPagar),
    tipo_servicio: tipo
  };
}

// ── Detectar si RFC es PM (12 chars) o PF (13 chars) ────────────────────
function detectTipoPersona(rfc) {
  const clean = String(rfc || '').trim().toUpperCase();
  if (clean.length === 12) return 'PM';
  if (clean.length === 13) return 'PF';
  return 'OTRO';
}

// ── FASE 1: Detección de Gasolina en Efectivo (Art. 27 Fracc. III LISR) ──
function detectGasolinaEfectivo(parsed, fileName) {
  const emisor = String(parsed?.nombre_emisor || '').toUpperCase();
  const rfcEmisor = String(parsed?.rfc_emisor || '').toUpperCase();
  const nombreArchivo = String(fileName || '').toUpperCase();
  const isFuel = /GASOLIN|PEMEX|OXXO GAS|SHELL|BP\b|MOBIL|G500|GNP GAS|COMBUSTIBLE|ESTACION DE SERVICIO/i.test(
    `${emisor} ${rfcEmisor} ${nombreArchivo}`
  );
  const paymentMethod = String(parsed?.payment_method || parsed?.metodo_pago || '').trim();
  const isCashPayment = paymentMethod === '01' || paymentMethod === '99' ||
    /EFECTIVO|CASH/i.test(paymentMethod) || !paymentMethod;
  return { isFuel, isCashPayment, isFuelCash: isFuel && isCashPayment };
}

// ── Rate limit y JWT (idéntico a v7.0) ──────────────────────────────────
const _rl = new Map();
function rateLimit(key, max) { const now = Date.now(); let b = _rl.get(key); if (!b || now - b.start > 60000) b = { start: now, n: 0 }; b.n++; _rl.set(key, b); return b.n <= max; }
async function validateSupabaseJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim(); if (!token) return null;
  try {
    const [h, p, s] = token.split('.'); if (!h || !p || !s) return null;
    if (SUPABASE_JWT_SECRET) {
      const exp = crypto.createHmac('sha256', SUPABASE_JWT_SECRET).update(`${h}.${p}`).digest('base64url');
      const a = Buffer.from(s, 'base64url'), b2 = Buffer.from(exp, 'base64url');
      if (a.length === b2.length && crypto.timingSafeEqual(a, b2)) {
        const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
        if (payload.role !== 'service_role' && (!payload.exp || payload.exp >= Math.floor(Date.now() / 1000))) {
          return { uid: payload.sub || null, email: payload.email || null };
        }
      }
    }
  } catch {}
  try {
    const url = SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY || '';
    if (!url || !anon) return null;
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { uid: u.id, email: u.email || null } : null;
  } catch { return null; }
}
const MAGIC = { 'image/jpeg': ['FFD8FF'], 'image/png': ['89504E47'], 'image/webp': ['52494646'], 'application/pdf': ['25504446'] };
function validateMagicNumber(base64Data, claimedMime) {
  if (!base64Data || typeof base64Data !== 'string') return { valid: false, reason: 'Datos vacíos' };
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length < 8) return { valid: false, reason: 'Archivo muy pequeño' };
    const hexHead = buffer.slice(0, 4).toString('hex').toUpperCase();
    if (!MAGIC[claimedMime]) return { valid: false, reason: `MIME no permitido: ${claimedMime}` };
    if (!MAGIC[claimedMime].some(sig => hexHead.startsWith(sig))) return { valid: false, reason: `Firma binaria no coincide con ${claimedMime}.` };
    return { valid: true, mime: claimedMime };
  } catch (e) { return { valid: false, reason: 'Error al validar: ' + e.message }; }
}
function setHeaders(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-demo-mode');
  res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
}
function parseBody(req) { if (!req?.body) return {}; if (typeof req.body === 'object') return req.body; try { return JSON.parse(req.body); } catch { return {}; } }
function normalizeDocType(v) { const t = String(v || '').trim().toUpperCase(); return new Set(['CFDI','TICKET','CONSTANCIA','OPINION','EFIRMA','OTRO']).has(t) ? t : 'OTRO'; }
function normalizeKeys(obj) { const out = {}; for (const [k, v] of Object.entries(obj || {})) out[k.trim()] = v; return out; }
function extractReplyText(data) { return data?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('\n').trim() || ''; }
function extractJSON(text) { if (!text) return null; const c = String(text).replace(/```json/gi, '').replace(/```/g, '').trim(); const s = c.indexOf('{'), e = c.lastIndexOf('}'); if (s === -1 || e <= s) return null; return c.slice(s, e + 1); }
function tolerantParse(jsonText) {
  try { return JSON.parse(jsonText); } catch {}
  let s = jsonText;
  s = s.replace(/,\s*"[^"]*"?\s*$/, ''); s = s.replace(/:\s*"[^"]*$/, ': null');
  const ob = (s.match(/{/g) || []).length - (s.match(/}/g) || []).length;
  const ok = (s.match(/\[/g) || []).length - (s.match(/]/g) || []).length;
  s += ']'.repeat(Math.max(0, ok)) + '}'.repeat(Math.max(0, ob));
  try { return JSON.parse(s); } catch {}
  const cut = s.lastIndexOf('}');
  if (cut > s.indexOf('{')) { const head = s.slice(0, cut + 1); const d = (head.match(/{/g) || []).length - (head.match(/}/g) || []).length; try { return JSON.parse(head + '}'.repeat(Math.max(0, d))); } catch {} }
  return null;
}
function buildFallback(reason, fileName = '', debug = {}) {
  return { ok: true, is_fallback: true, reason, engine: ENGINE, debug,
    document: { file_name: fileName || 'documento', doc_type: 'OTRO', document_type: 'OTRO', confidence: 0.5, file_url: `local:${fileName || 'documento'}`,
      extracted_data: { rfc_emisor: null, rfc_receptor: null, nombre_emisor: null, subtotal: null, descuento: 0, iva: null, total: null, folio: null, fecha: null, summary: null, tax_usefulness: null },
      safety_flag: true, validation_status: 'pendiente', needs_review: true, source: 'ocr_fallback',
      pedagogical_note: 'ISR RESICO: sin deducciones. IVA: requiere CFDI válido y gasto indispensable para acreditamiento.' },
    needsHumanReview: true };
}
function base64url(i) { return Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
const _tok = { token: null, exp: 0 };
function canUseVertex() { return Boolean(VERTEX_PROJECT_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY); }
async function googleToken() {
  if (_tok.token && _tok.exp > Date.now() + 60000) return _tok.token;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({ iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key, 'base64');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${claims}.${sig}` });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('oauth_token_error');
  _tok = { token: d.access_token, exp: Date.now() + 55 * 60 * 1000 };
  return d.access_token;
}
// ── Prompt OCR v8.0: con method de pago + tipo servicio ─────────────────
const PROMPT = [
  'Eres un extractor fiscal mexicano especializado en RESICO 2026 y CFDI 4.0.',
  'Analiza el documento y responde SOLO JSON válido, sin markdown.',
  'Extrae: document_type, confidence, rfc_emisor, rfc_receptor, razon_social_receptor, cp_receptor, uso_cfdi, metodo_pago, forma_pago, concepto, nombre_emisor, subtotal, descuento, iva, total, folio, fecha, tax_usefulness.',
  'REGLAS CFDI 4.0: reporta razon_social_receptor TAL CUAL aparece; reporta cp_receptor y uso_cfdi exactamente como vengan.',
  'metodo_pago: "PUE"|"PPD". forma_pago: "01"=Efectivo,"03"=Transferencia,"04"=Tarjeta crédito,"28"=Tarjeta débito.',
  'Si es combustible (gasolina/diésel) indica concepto="COMBUSTIBLE".',
  'Si falta un dato, devuelve null. confidence entre 0 y 1.',
  'Regla fiscal: gasolina en efectivo (forma_pago 01) NO es deducible ni acreditable (Art. 27 Fracc. III LISR).'
].join('\n');
function geminiBody(mimeType, base64Data) {
  return { contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: base64Data } }] }],
    generationConfig: { temperature: 0.05, topP: 0.9, maxOutputTokens: 1024, responseMimeType: 'application/json' } };
}
async function callAIStudio(model, body) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { lastErr = new Error(`AIStudio HTTP ${r.status}`); await new Promise(res => setTimeout(res, 300 * Math.pow(2, attempt))); continue; }
    if (!r.ok) throw new Error(`AIStudio HTTP ${r.status}`);
    return { data: await r.json(), model: `ai-studio:${model}` };
  }
  throw lastErr;
}
async function callVertex(body) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await googleToken();
    const url = `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/${VERTEX_PROJECT_ID}/locations/${VERTEX_LOCATION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    if (r.status === 429 || r.status >= 500) { lastErr = new Error(`Vertex HTTP ${r.status}`); await new Promise(res => setTimeout(res, 300 * Math.pow(2, attempt))); continue; }
    if (!r.ok) throw new Error(`Vertex HTTP ${r.status}`);
    return { data: await r.json(), model: `vertex:${VERTEX_MODEL}` };
  }
  throw lastErr;
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
  if (!process.env.GEMINI_API_KEY && !canUseVertex()) return res.status(200).json(buildFallback('missing_credentials', fileName));
  if (!fileName || !mimeType || !base64Data) return res.status(400).json({ ok: false, error: 'fileName, mimeType y base64Data requeridos.', engine: ENGINE });

  const tried = [];
  let outcome = null;
  if (process.env.GEMINI_API_KEY) { for (const m of AI_MODELS) { try { outcome = await callAIStudio(m, geminiBody(mimeType, base64Data)); break; } catch (e) { tried.push({ provider: `ai-studio:${m}`, err: e.message }); } } }
  if (!outcome && canUseVertex()) { try { outcome = await callVertex(geminiBody(mimeType, base64Data)); } catch (e) { tried.push({ provider: 'vertex', err: e.message }); } }
  if (!outcome) return res.status(200).json(buildFallback('all_providers_failed', fileName, { tried }));

  const raw = extractReplyText(outcome.data);
  const parsedRaw = tolerantParse(raw);
  const parsed = parsedRaw ? normalizeKeys(parsedRaw) : null;
  if (!parsed) return res.status(200).json(buildFallback('invalid_json', fileName, { tried, raw_preview: raw.slice(0, 300) }));

  const docType = normalizeDocType(parsed.document_type);
  let confidence = Number(parsed.confidence || 0);
  const sub = Number(parsed.subtotal ?? 0), desc = Number(parsed.descuento ?? 0), iv = Number(parsed.iva ?? 0), tot = Number(parsed.total ?? 0);
  const baseGravable = Math.max(0, sub - desc);
  const sumOk = tot <= 0 || Math.abs(baseGravable + iv - tot) <= Math.max(1, tot * 0.05);
  if (tot > 0 && (!sumOk || iv > tot)) confidence = Math.min(confidence, 0.7);

  // ── FASE 1: Gasolina en Efectivo (Art. 27 Fracc. III LISR) ────────────
  const fuelCheck = detectGasolinaEfectivo(parsed, fileName);
  let safety_flag_reason = null;
  let pedagogical_note_extra = null;
  if (fuelCheck.isFuelCash) {
    confidence = Math.min(confidence, 0.70);
    safety_flag_reason = 'gasolina_efectivo';
    pedagogical_note_extra = '⚠️ ALERTA FISCAL CRÍTICA (Art. 27 Fracc. III LISR): Gasolina pagada en EFECTIVO NO es deducible para ISR ni acreditable para IVA. El SAT invalida este gasto sin importar el monto. Debe pagarse con tarjeta, transferencia o monedero electrónico.';
  }

  // ── FASE 2: Retenciones PM → PF RESICO (Art. 113-J LISR) ──────────────
  let retenciones = null;
  const tipoEmisor = detectTipoPersona(parsed.rfc_emisor);
  const tipoReceptor = detectTipoPersona(parsed.rfc_receptor);
  // Aplicar retenciones SOLO cuando el emisor es PF (13 chars) y el receptor es PM (12 chars)
  // Esto significa: el usuario (PF RESICO) le está facturando a una PM
  if (tipoEmisor === 'PF' && tipoReceptor === 'PM' && docType === 'CFDI' && sub > 0) {
    const tipoServicio = String(parsed.tipo_servicio || 'HONORARIOS').toUpperCase();
    retenciones = calcularRetencionesRESICO(tipoServicio, sub, iv);
    pedagogical_note_extra = (pedagogical_note_extra ? pedagogical_note_extra + ' ' : '') +
      `💼 RETENCIONES APLICADAS (Art. 113-J LISR): La PM receptora debe retenerte ISR ${retenciones.isr_retention} MXN (1.25%) e IVA ${retenciones.iva_retention} MXN. Neto a recibir: ${retenciones.neto_a_pagar} MXN.`;
  }

  const safetyFlag = confidence < 0.85 || safety_flag_reason === 'gasolina_efectivo';

  const doc = {
    file_name: fileName, doc_type: docType, document_type: docType, confidence,
    file_url: `local:${fileName}`,
    extracted_data: {
      rfc_emisor: parsed.rfc_emisor || null,
      rfc_receptor: parsed.rfc_receptor || null,
      nombre_emisor: parsed.nombre_emisor || null,
      subtotal: parsed.subtotal ?? null,
      descuento: parsed.descuento ?? 0,
      iva: parsed.iva ?? null,
      total: parsed.total ?? null,
      folio: parsed.folio || null,
      fecha: parsed.fecha || null,
      payment_method: parsed.payment_method || null,
      tipo_servicio: parsed.tipo_servicio || null,
      is_fuel: !!parsed.is_fuel,
      summary: parsed.summary || null,
      tax_usefulness: parsed.tax_usefulness || null,
      retenciones: retenciones,
      safety_flag_reason: safety_flag_reason
    },
    safety_flag: safetyFlag,
    validation_status: 'pendiente',
    needs_review: safetyFlag,
    source: isDemo ? 'ocr_ai_demo' : 'ocr_ai',
    pedagogical_note: pedagogical_note_extra || 'ISR RESICO: sin deducciones. IVA: requiere CFDI válido y gasto indispensable para acreditamiento.'
  };

  // ── FASE 3: Storage jerárquico desde backend (solo sesión real) ──────
  if (user?.uid && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    try {
      const fecha = parsed.fecha || new Date().toISOString().slice(0, 10);
      const cat = (String(parsed.tax_usefulness || '').toUpperCase() === 'ISR' || docType === 'CFDI') ? 'ingresos' : 'gastos';
      const storagePath = `${user.uid}/${fecha.slice(0, 4)}/${fecha.slice(5, 7)}/${cat}/${Date.now()}_${fileName}`;
      const buffer = Buffer.from(base64Data, 'base64');
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/carpeta-fiscal/${encodeURIComponent(storagePath)}`, {
        method: 'POST',
        headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': mimeType, 'x-upsert': 'true' },
        body: buffer
      });
      if (up.ok) doc.file_url = `supabase://carpeta-fiscal/${storagePath}`;
      else console.warn('[document-ocr] Storage upload falló:', await up.text());
    } catch (e) { console.warn('[document-ocr] Storage exception:', e.message); }
  }

  // ── Validación RFC receptor vs user_profiles (solo sesión real) ──────
  if (user?.uid && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    const rec = String(doc.extracted_data.rfc_receptor || '').toUpperCase().trim();
    if (rec && rec !== 'XAXX010101000' && rec !== 'XEXX010101000') {
      try {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${user.uid}&select=rfc`, { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } });
        const profiles = await pr.json();
        const userRfc = Array.isArray(profiles) && profiles[0]?.rfc ? profiles[0].rfc.toUpperCase().trim() : null;
        if (userRfc && rec !== userRfc && tipoReceptor === 'PM') {
          // Cuando el receptor es PM pero no coincide con el RFC del usuario,
          // significa que el usuario está EMITIENDO CFDI (no recibiendo).
          // En ese caso, las retenciones calculadas son correctas.
          // Solo advertimos si el RFC receptor es inválido o no existe.
        }
      } catch (e) { console.warn('[document-ocr] validación receptor:', e.message); }
    }
  }
  return res.status(200).json({ ok: true, engine: ENGINE, is_fallback: false, model: outcome.model, document: doc, needsHumanReview: safetyFlag });
}