// api/gemini-proxy.js — v7 CERTIFICADO: Vertex AI (productivo) + AI Studio + motor fiscal
import crypto from 'node:crypto';
const ALLOWED_ORIGINS = ['https://aliado-resico.vercel.app','https://aliadoresico.com','https://www.aliadoresico.com','http://localhost:3000','http://127.0.0.1:3000','http://localhost:5500','http://127.0.0.1:5500'];
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const ENGINE = 'gemini-v7';
const buckets = new Map();
function rateLimit(key) { const now = Date.now(); let b = buckets.get(key); if (!b || now - b.start > 60000) b = { start: now, n: 0 }; b.n++; buckets.set(key, b); return b.n <= 60; }
function setHeaders(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-demo-mode');
  res.setHeader('Vary', 'Origin'); res.setHeader('Cache-Control', 'no-store');
}
function verifyJWT(auth) {
  if (!auth || !auth.startsWith('Bearer ')) return null;
  try {
    const [h, p, s] = auth.slice(7).split('.');
    if (!h || !p || !s) return null;
    if (JWT_SECRET) {
      const exp = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
      const a = Buffer.from(s, 'base64url'), b2 = Buffer.from(exp, 'base64url');
      if (a.length !== b2.length || !crypto.timingSafeEqual(a, b2)) return null;
    }
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role === 'service_role') return null;
    return { uid: payload.sub || 'anon' };
  } catch { return null; }
}
function fiscalEngine(message) {
  const t = String(message || '').toLowerCase();
  let respuestaFiscal, fundamentoLegal = 'Art. 113-E LISR · RMF 2026',
    diferenciacionIsrIva = 'ISR RESICO: sobre ingresos brutos, sin deducciones (1% a 2.5%). IVA: sí acreditable con CFDI válido y gasto indispensable.',
    accionConcreta = 'Registra tus ingresos en el Monitor para vigilar tu límite de $3,500,000 MXN.';
  if (t.includes('anual')) { respuestaFiscal = 'Declaración anual: EXENTA si solo tienes ingresos RESICO, no superas $3.5M y cumpliste pagos mensuales. OBLIGATORIA si tuviste salarios > $400,000, intereses reales > $100,000, dividendos o ingresos mixtos.'; fundamentoLegal = 'Art. 113-F LISR'; accionConcreta = 'Usa el Wizard Fiscal para determinar tu obligación con tus montos exactos.'; }
  else if (t.includes('buz')) { respuestaFiscal = 'El Buzón Tributario es obligatorio para RESICO. Inactivo genera multa de $3,420 a $10,260 MXN y se duplica por reincidencia.'; fundamentoLegal = 'Art. 17-K y 86-C CFF'; accionConcreta = 'Actívalo hoy en sat.gob.mx → Mi Portal → Buzón Tributario.'; }
  else if (t.includes('firma')) { respuestaFiscal = 'La e.firma tiene vigencia de 4 años. Sin ella no puedes timbrar CFDI ni presentar declaraciones.'; fundamentoLegal = 'Art. 17-D CFF'; accionConcreta = 'Sube tu .cer a Mi Carpeta Fiscal para calcular tus días restantes.'; }
  else if (t.includes('gasto') || t.includes('ticket') || t.includes('iva')) { respuestaFiscal = 'En RESICO los gastos NO reducen tu ISR, pero el IVA desglosado SÍ es acreditable si el gasto es estrictamente indispensable y tienes CFDI válido.'; fundamentoLegal = 'Art. 113-E LISR · Arts. 5 y 29 Ley del IVA'; accionConcreta = 'Sube el ticket al OCR y guárdalo en tu Bóveda de Evidencia IVA.'; }
  else if (t.includes('lím') || t.includes('lim') || t.includes('3.5') || t.includes('expul')) { respuestaFiscal = 'El límite RESICO 2026 es $3,500,000 MXN anuales. Al excederlo, el SAT te migra a Actividad Empresarial con tasas hasta 35%.'; fundamentoLegal = 'Art. 113-E LISR'; accionConcreta = 'Vigila el semáforo: 80% preventivo, 90% alto, 94% expulsión.'; }
  else { respuestaFiscal = 'En RESICO 2026 el ISR se calcula sobre ingresos efectivamente cobrados con tasas anuales: hasta $300,000 → 1.0%; $600,000 → 1.1%; $1,000,000 → 1.5%; $2,500,000 → 2.0%; $3,500,000 → 2.5%.'; }
  return { respuestaFiscal, fundamentoLegal, diferenciacionIsrIva, accionConcreta };
}
const buildPrompt = (message, context) => `Eres el asesor fiscal RESICO 2026 de Aliado RESICO (México). Contexto: ingreso acumulado $${context?.incomeYTD || 0} MXN de un límite de $3,500,000. Responde SOLO JSON válido con estas llaves exactas: {"respuestaFiscal": "string", "fundamentoLegal": "string", "diferenciacionIsrIva": "string", "accionConcreta": "string"} Pregunta: ${message}`;
function parseGemini(data) {
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const clean = text.replace(/```json|```/g, '').trim();
  const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
  if (s === -1 || e === -1) throw new Error('Respuesta sin JSON');
  return JSON.parse(clean.slice(s, e + 1));
}
let _g = { token: null, exp: 0 };
async function googleToken() {
  if (_g.token && Date.now() < _g.exp - 60000) return _g.token;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Credenciales Vertex ausentes');
  const now = Math.floor(Date.now() / 1000);
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({ iss: email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${head}.${claims}.${sig}` });
  if (!r.ok) throw new Error(`OAuth Google ${r.status}`);
  const d = await r.json();
  _g = { token: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return _g.token;
}
async function callVertex(prompt) {
  const token = await googleToken();
  const p = process.env.VERTEX_PROJECT_ID, l = process.env.VERTEX_LOCATION || 'us-central1', m = process.env.VERTEX_MODEL || 'gemini-2.0-flash';
  const r = await fetch(`https://${l}-aiplatform.googleapis.com/v1/projects/${p}/locations/${l}/publishers/google/models/${m}:generateContent`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] })
  });
  if (!r.ok) throw new Error(`Vertex HTTP ${r.status}`);
  return parseGemini(await r.json());
}
async function callAIStudio(model, prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!r.ok) throw new Error(`AIStudio HTTP ${r.status}`);
  return parseGemini(await r.json());
}
export default async function handler(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed', engine: ENGINE });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = String(body.message || '').slice(0, 2000);
    const isDemo = req.headers['x-demo-mode'] === 'true';
    const user = verifyJWT(req.headers.authorization);
    if (!user && !isDemo) return res.status(401).json({ ok: false, error: 'No autorizado', engine: ENGINE });
    if (!rateLimit(user?.uid || 'demo')) return res.status(429).json({ ok: false, error: 'Límite alcanzado.', engine: ENGINE });
    const prompt = buildPrompt(message, body.context);
    const errors = [];
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      try { const st = await callVertex(prompt); return res.status(200).json({ ok: true, engine: ENGINE, source: 'vertex', reply: st.respuestaFiscal, structured: st }); }
      catch (e) { errors.push('vertex: ' + e.message); }
    }
    if (GEMINI_KEY) {
      for (const m of ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash']) {
        try { const st = await callAIStudio(m, prompt); return res.status(200).json({ ok: true, engine: ENGINE, source: 'ai-studio', provider: m, reply: st.respuestaFiscal, structured: st }); }
        catch (e) { errors.push(m + ': ' + e.message); }
      }
    }
    const fb = fiscalEngine(message);
    return res.status(200).json({ ok: true, engine: ENGINE, is_fallback: true, fallback_reason: errors.length ? 'gemini_error' : 'no_credentials', debug: { providers: errors }, reply: fb.respuestaFiscal, structured: fb });
  } catch {
    const fb = fiscalEngine('');
    return res.status(200).json({ ok: true, engine: ENGINE, is_fallback: true, fallback_reason: 'handler_error', reply: fb.respuestaFiscal, structured: fb });
  }
}