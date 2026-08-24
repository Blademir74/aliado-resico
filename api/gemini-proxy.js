// api/gemini-proxy.js — v5.0 HARDENED (Auditoría 2026)
// Regla de oro: NUNCA devolver 500. Degradar a motor fiscal local.
import crypto from 'node:crypto';

const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app', 'https://aliadoresico.com',
  'https://www.aliadoresico.com', 'http://localhost:3000',
  'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'
];
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// ── Rate limit (60 req/min por usuario) ─────────────────────────────────
const buckets = new Map();
function rateLimit(key) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > 60000) b = { start: now, n: 0 };
  b.n++; buckets.set(key, b);
  return b.n <= 60;
}

function setHeaders(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-demo-mode');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
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

// ── Motor fiscal determinista 2026 (fallback sin IA) ────────────────────
function fiscalEngine(message) {
  const t = String(message || '').toLowerCase();
  let respuestaFiscal, fundamentoLegal = 'Art. 113-E LISR · RMF 2026',
      diferenciacionIsrIva = 'ISR RESICO: sobre ingresos brutos, sin deducciones (1% a 2.5%). IVA: sí acreditable con CFDI válido y gasto indispensable.',
      accionConcreta = 'Registra tus ingresos en el Monitor para vigilar tu límite de $3,500,000 MXN.';
  if (t.includes('anual')) {
    respuestaFiscal = 'Declaración anual: EXENTA si solo tienes ingresos RESICO, no superas $3.5M y cumpliste pagos mensuales. OBLIGATORIA si tuviste salarios > $400,000, intereses reales > $100,000, dividendos o ingresos mixtos (Art. 113-F LISR).';
    fundamentoLegal = 'Art. 113-F LISR';
    accionConcreta = 'Usa el Wizard Fiscal para determinar tu obligación con tus montos exactos.';
  } else if (t.includes('buzón') || t.includes('buzon')) {
    respuestaFiscal = 'El Buzón Tributario es obligatorio para RESICO. Inactivo genera multa de $3,420 a $10,260 MXN y se duplica por reincidencia.';
    fundamentoLegal = 'Art. 17-K y 86-C CFF';
    accionConcreta = 'Actívalo hoy en sat.gob.mx → Mi Portal → Buzón Tributario.';
  } else if (t.includes('e.firma') || t.includes('efirma') || t.includes('firma')) {
    respuestaFiscal = 'La e.firma tiene vigencia de 4 años. Sin ella no puedes timbrar CFDI ni presentar declaraciones.';
    fundamentoLegal = 'Art. 17-D CFF';
    accionConcreta = 'Sube tu .cer a Mi Carpeta Fiscal para calcular tus días restantes.';
  } else if (t.includes('gasto') || t.includes('ticket') || t.includes('deducir') || t.includes('iva')) {
    respuestaFiscal = 'En RESICO los gastos NO reducen tu ISR (tributas sobre ingresos brutos), pero el IVA desglosado SÍ es acreditable si el gasto es estrictamente indispensable y tienes CFDI válido.';
    fundamentoLegal = 'Art. 113-E LISR · Arts. 5 y 29 Ley del IVA';
    accionConcreta = 'Sube el ticket al OCR y guárdalo en tu Bóveda de Evidencia IVA.';
  } else if (t.includes('límite') || t.includes('limite') || t.includes('3.5') || t.includes('expul')) {
    respuestaFiscal = 'El límite RESICO 2026 es $3,500,000 MXN anuales. Al excederlo, el SAT te migra a Actividad Empresarial con tasas hasta 35%.';
    fundamentoLegal = 'Art. 113-E LISR';
    accionConcreta = 'Vigila el semáforo: 80% preventivo, 90% alto, 94% expulsión.';
  } else {
    respuestaFiscal = 'En RESICO 2026 el ISR se calcula sobre ingresos efectivamente cobrados con tasas anuales: hasta $300,000 → 1.0%; $600,000 → 1.1%; $1,000,000 → 1.5%; $2,500,000 → 2.0%; $3,500,000 → 2.5%.';
    accionConcreta = 'Pregúntame por: declaración anual, buzón tributario, e.firma, gastos e IVA, o límite de ingresos.';
  }
  return { respuestaFiscal, fundamentoLegal, diferenciacionIsrIva, accionConcreta };
}

async function callGemini(message, context) {
  const prompt = `Eres el asesor fiscal RESICO 2026 de Aliado RESICO (México).
Contexto del usuario: ingreso acumulado $${context?.incomeYTD || 0} MXN de un límite de $3,500,000.
Responde SOLO JSON válido con estas llaves exactas (sin espacios):
{"respuestaFiscal": "string", "fundamentoLegal": "string", "diferenciacionIsrIva": "string", "accionConcreta": "string"}
Pregunta del usuario: ${message}`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const clean = text.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(clean.startsWith('{') ? clean : clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
  return parsed;
}

export default async function handler(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = String(body.message || '').slice(0, 2000);
    const isDemo = req.headers['x-demo-mode'] === 'true';
    const user = verifyJWT(req.headers.authorization);
    if (!user && !isDemo) return res.status(401).json({ ok: false, error: 'No autorizado' });
    if (!rateLimit(user?.uid || 'demo')) return res.status(429).json({ ok: false, error: 'Límite alcanzado. Intenta en un minuto.' });

    if (GEMINI_KEY) {
      try {
        const ai = callGemini(message, body.context);
        const structured = await ai;
        return res.status(200).json({ ok: true, source: 'gemini', reply: structured.respuestaFiscal, structured });
      } catch (e) {
        console.warn('[gemini-proxy] Gemini falló, usando motor fiscal:', e.message);
      }
    }
    const fb = fiscalEngine(message);
    return res.status(200).json({ ok: true, is_fallback: true, fallback_reason: GEMINI_KEY ? 'gemini_error' : 'no_api_key', reply: fb.respuestaFiscal, structured: fb });
  } catch (e) {
    // Red de seguridad absoluta: nunca 500
    const fb = fiscalEngine('');
    return res.status(200).json({ ok: true, is_fallback: true, fallback_reason: 'handler_error', reply: fb.respuestaFiscal, structured: fb });
  }
}