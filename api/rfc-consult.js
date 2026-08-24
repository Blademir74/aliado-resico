// api/rfc-consult.js — v2.0 HARDENED (FIX T3)
// La validación de RFC es información PÚBLICA: sin 401 anónimo, con rate-limit.
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app','https://aliadoresico.com','https://www.aliadoresico.com',
  'http://localhost:3000','http://127.0.0.1:3000','http://localhost:5500','http://127.0.0.1:5500'
];
const _rl = new Map();
function rateLimit(key) {
  const now = Date.now();
  let b = _rl.get(key);
  if (!b || now - b.start > 60000) b = { start: now, n: 0 };
  b.n++; _rl.set(key, b);
  return b.n <= 30;
}
function setHeaders(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-demo-mode');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
}
const M = {'0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'A':10,'B':11,'C':12,'D':13,'E':14,'F':15,'G':16,'H':17,'I':18,'J':19,'K':20,'L':21,'M':22,'N':23,'&':24,'O':25,'P':26,'Q':27,'R':28,'S':29,'T':30,'U':31,'V':32,'W':33,'X':34,'Y':35,'Z':36,' ':37,'Ñ':38};
function validateRFC(rfc) {
  const c = String(rfc || '').trim().toUpperCase();
  if (!c) return { valid: false, reason: 'RFC vacío' };
  if (c === 'XAXX010101000' || c === 'XEXX010101000') return { valid: true, isGeneric: true, reason: 'RFC genérico válido (público en general)' };
  if (c.length !== 12 && c.length !== 13) return { valid: false, reason: `Longitud inválida (${c.length}). PF=13, PM=12.` };
  const calc = c.length === 13 ? ' ' + c.substring(0, 12) : c.substring(0, 11);
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const v = M[calc[i]];
    if (v === undefined) return { valid: false, reason: `Carácter inválido: ${calc[i]}` };
    sum += v * (13 - i);
  }
  const rem = sum % 11;
  const exp = rem === 0 ? '0' : rem === 1 ? 'A' : String(11 - rem);
  if (exp !== c.charAt(c.length - 1)) return { valid: false, reason: `Dígito verificador incorrecto. Esperado: ${exp}, recibido: ${c.charAt(c.length - 1)}.` };
  return { valid: true, isGeneric: false, reason: `RFC válido (${c.length === 13 ? 'Persona Física' : 'Persona Moral'}) con homoclave correcta` };
}
async function checkEFOS(rfc) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { inList: false };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/efos_watchlist?rfc=eq.${encodeURIComponent(rfc)}&select=rfc,rfc_emisor,situacion,fuente`, {
      headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` }
    });
    const d = await r.json();
    return Array.isArray(d) && d.length ? { inList: true, data: d[0] } : { inList: false };
  } catch { return { inList: false }; }
}
export default async function handler(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  try {
    if (!rateLimit(String(req.headers['x-forwarded-for'] || 'anon')))
      return res.status(429).json({ ok: false, error: 'Demasiadas consultas. Intenta en un minuto.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const rfc = String(body.rfc || '').trim().toUpperCase();
    if (!rfc) return res.status(400).json({ ok: false, error: 'RFC requerido' });
    const check = validateRFC(rfc);
    if (!check.valid) return res.status(200).json({ ok: true, rfc, valid: false, riskLevel: 'HIGH', reason: check.reason, recommendation: '⚠️ RFC inválido. No emitas ni aceptes CFDI con este RFC.', legalReference: 'Art. 29-A CFF' });
    const efos = await checkEFOS(rfc);
    if (efos.inList) return res.status(200).json({ ok: true, rfc, valid: true, inEFOSList: true, efosData: efos.data, riskLevel: 'CRITICAL', reason: check.reason, recommendation: `🚨 ALERTA EFOS (Art. 69-B CFF): ${efos.data.rfc_emisor || 'Emisor simulado'}. NO aceptes facturas de este RFC.`, legalReference: 'Art. 69-B CFF' });
    return res.status(200).json({ ok: true, rfc, valid: true, inEFOSList: false, riskLevel: check.isGeneric ? 'INFO' : 'LOW', reason: check.reason, recommendation: check.isGeneric ? 'ℹ️ RFC genérico: solo para CFDI global. No permite acreditamiento de IVA.' : '✅ RFC válido y sin alertas EFOS. Puedes proceder con la operación.', legalReference: 'Art. 69-B CFF · RMF 2026' });
  } catch { return res.status(200).json({ ok: false, error: 'Error interno al consultar RFC' }); }
}