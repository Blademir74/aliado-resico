// api/rfc-consult.js — Vercel Serverless (ESM)
// FIX FASE 2.5: Endpoint para consultar RFC + watchlist EFOS
import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

function setHeaders(req, res) {
  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'no-store');
}

// ── Validación JWT de Supabase ───────────────────────────────────────────
async function validateSupabaseJWT(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSig] = parts;
    if (SUPABASE_JWT_SECRET) {
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const expectedSig = crypto.createHmac('sha256', SUPABASE_JWT_SECRET)
        .update(signingInput).digest('base64url');
      const sigBuf = Buffer.from(encodedSig, 'base64url');
      const expBuf = Buffer.from(expectedSig, 'base64url');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    }
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role === 'service_role') return null;
    return { uid: payload.sub || null, email: payload.email || null };
  } catch { return null; }
}

// ── FIX D5: Rate limit para uso público (30 req/min) ────────────────────
const _rl = new Map();
function rateLimit(key) {
  const now = Date.now();
  let b = _rl.get(key);
  if (!b || now - b.start > 60000) b = { start: now, n: 0 };
  b.n++; _rl.set(key, b);
  return b.n <= 30;
}
// ── Validación de RFC con homoclave (algoritmo oficial SAT) ─────────────
const RFC_CHAR_MAP = {
  '0':0,'1':1,'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,
  'A':10,'B':11,'C':12,'D':13,'E':14,'F':15,'G':16,'H':17,'I':18,
  'J':19,'K':20,'L':21,'M':22,'N':23,'&':24,'O':25,'P':26,'Q':27,
  'R':28,'S':29,'T':30,'U':31,'V':32,'W':33,'X':34,'Y':35,'Z':36,
  ' ':37,'Ñ':38
};

function validateRFCChecksum(rfc) {
  if (!rfc) return { valid: false, reason: 'RFC vacío' };
  const clean = String(rfc).trim().toUpperCase();
  if (clean === 'XAXX010101000' || clean === 'XEXX010101000') {
    return { valid: true, reason: 'RFC genérico válido', isGeneric: true };
  }
  if (clean.length !== 12 && clean.length !== 13) {
    return { valid: false, reason: `Longitud inválida (${clean.length})` };
  }
  try {
    const forCalc = clean.length === 13 ? ' ' + clean.substring(0, 11) : clean.substring(0, 11);
    let sum = 0;
    for (let i = 0; i < 11; i++) {
      const charVal = RFC_CHAR_MAP[forCalc[i]];
      if (charVal === undefined) return { valid: false, reason: 'Carácter inválido en RFC' };
      sum += charVal * (12 - i);
    }
    const remainder = sum % 11;
    const expectedDigit = remainder === 0 ? '0' : remainder === 1 ? 'A' : String(11 - remainder);
    const actualDigit = clean.charAt(clean.length - 1);
    if (expectedDigit !== actualDigit) {
      return {
        valid: false,
        reason: `Dígito verificador incorrecto. Esperado: ${expectedDigit}, recibido: ${actualDigit}`,
      };
    }
    return { valid: true, reason: 'RFC válido con homoclave correcta', isGeneric: false };
  } catch (e) {
    return { valid: false, reason: 'Error al validar: ' + e.message };
  }
}

// ── Consulta a watchlist EFOS ────────────────────────────────────────────
// ── Consulta a watchlist EFOS ────────────────────────────────────────────
async function checkEFOS(rfc, skipEFOS = false) {
  // En modo demo, omitir consulta a EFOS (no hay acceso a DB)
  if (skipEFOS || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return { inList: false, reason: skipEFOS ? 'Modo demo: validación EFOS omitida' : 'Watchlist no configurada' };
  }
  try {
    const cleanRfc = String(rfc).trim().toUpperCase();
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/efos_watchlist?rfc=eq.${encodeURIComponent(cleanRfc)}&select=rfc,rfc_emisor,situacion,fecha_publicacion,fuente`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        }
      }
    );
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        inList: true,
        data: data[0],
        reason: 'RFC encontrado en lista de EFOS (Art. 69-B CFF)'
      };
    }
    return { inList: false, reason: 'RFC no encontrado en lista EFOS' };
  } catch (e) {
    console.warn('[rfc-consult] Error consultando EFOS:', e.message);
    return { inList: false, reason: 'Error al consultar: ' + e.message };
  }
}

// ── Handler principal ────────────────────────────────────────────────────
export default async function handler(req, res) {
  setHeaders(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

   // FIX R3: Validación de RFC es información PÚBLICA → sin 401, con rate-limit
  const user = await validateSupabaseJWT(req.headers.authorization);
  const rlKey = user?.uid || String(req.headers['x-forwarded-for'] || 'anon');
  if (!rateLimit(rlKey)) {
    return res.status(429).json({ ok: false, error: 'Demasiadas consultas. Intenta en un minuto.' });
  }
  
  const isDemoMode = !user && req.headers['x-demo-mode'] === 'true';
  
  if (!user && !isDemoMode) {
    return res.status(401).json({ ok: false, error: 'No autorizado. Se requiere sesión activa.' });
  }

  try {
    const body = JSON.parse(req.body || '{}');
    const rfc = String(body.rfc || '').trim().toUpperCase();

    if (!rfc) {
      return res.status(400).json({ ok: false, error: 'RFC requerido' });
    }

    // Paso 1: Validar estructura y homoclave
    const checksumResult = validateRFCChecksum(rfc);
    if (!checksumResult.valid) {
      return res.status(200).json({
        ok: true,
        rfc,
        valid: false,
        reason: checksumResult.reason,
        recommendation: '⚠️ RFC inválido. No emitas ni aceptes CFDI con este RFC. Verifica con el cliente.',
        riskLevel: 'HIGH'
      });
    }

    // Paso 2: Verificar en lista EFOS
       const efosResult = await checkEFOS(rfc, isDemoMode);
    
    // Paso 3: Generar recomendación
    let recommendation = '';
    let riskLevel = 'LOW';

    if (checksumResult.isGeneric) {
      recommendation = 'ℹ️ RFC genérico para operaciones con público en general. Úsalo solo para CFDI global.';
      riskLevel = 'INFO';
    } else if (efosResult.inList) {
      recommendation = `🚨 ALERTA: Este RFC está en la lista de EFOS (Art. 69-B CFF). NO aceptes facturas de este emisor. Riesgo de multa y no deducibilidad. Situación: ${efosResult.data?.situacion || 'publicado'}.`;
      riskLevel = 'CRITICAL';
    } else {
      recommendation = '✅ RFC válido y sin alertas EFOS. Puedes proceder con la operación fiscal.';
      riskLevel = 'LOW';
    }

    return res.status(200).json({
      ok: true,
      rfc,
      valid: true,
      isGeneric: checksumResult.isGeneric,
      inEFOSList: efosResult.inList,
      efosData: efosResult.inList ? efosResult.data : null,
      reason: checksumResult.reason,
      recommendation,
      riskLevel,
      legalReference: 'Art. 69-B CFF — Lista de EFOS publicada en DOF'
    });

  } catch (error) {
    console.error('[rfc-consult] Error:', error);
    return res.status(500).json({ ok: false, error: 'Error interno al consultar RFC' });
  }
}