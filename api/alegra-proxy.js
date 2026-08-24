import crypto from 'node:crypto';

const ALEGRA_API_BASE = process.env.ALEGRA_API_BASE || 'https://api.alegra.com/api/v1';
const ALEGRA_EMAIL = process.env.ALEGRA_EMAIL || process.env.ALEGRA_API_USER || '';
const ALEGRA_TOKEN = process.env.ALEGRA_TOKEN || process.env.ALEGRA_API_TOKEN || '';
const ALEGRA_WEBHOOK_SECRET = process.env.ALEGRA_WEBHOOK_SECRET || '';
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'https://www.aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

// ── Régimen y Usos de CFDI válidos para RESICO PF (RMF 2026) ────────────────
const RESICO_REGIMEN_FISCAL = '626'; // Régimen Simplificado de Confianza
// ── FIX FASE 2.2: Tabla ISR RESICO anual 2026 para retenciones ────────────
const ISR_RATES_RESICO_2026 = [
  { lowerLimit: 0,          upperLimit: 300000,     rate: 1.00 },
  { lowerLimit: 300000.01,  upperLimit: 600000,     rate: 1.10 },
  { lowerLimit: 600000.01,  upperLimit: 1000000,    rate: 1.50 },
  { lowerLimit: 1000000.01, upperLimit: 2500000,    rate: 2.00 },
  { lowerLimit: 2500000.01, upperLimit: 3500000,    rate: 2.50 },
];

function calculateProgressiveRetention(annualIncome) {
  const income = Number(annualIncome || 0);
  if (income <= 0) return { rate: 1.00, bracket: 'Hasta $300,000' };
  
  for (const bracket of ISR_RATES_RESICO_2026) {
    if (income >= bracket.lowerLimit && income <= bracket.upperLimit) {
      return { rate: bracket.rate, bracket: `$${bracket.lowerLimit.toLocaleString()} - $${bracket.upperLimit.toLocaleString()}` };
    }
  }
  // Si supera el límite, usar la tasa máxima
  return { rate: 2.50, bracket: 'Más de $2,500,000' };
}
const VALID_USOS_CFDI_RESICO = [
  'G01', 'G02', 'G03', // Adquisición de mercancías / Devoluciones / Gastos en general
  'D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', // Deducciones personales
  'S01', // Sin efectos fiscales
  'CP01', // Pagos
  'CN01'  // Nómina
];

function resolveOrigin(origin = '') {
  if (!origin) return ALLOWED_ORIGINS[0];
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function setHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveOrigin(req.headers.origin || ''));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Alegra-Webhook-Secret');
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

function okJson(res, body = {}, status = 200) { return res.status(status).json(body); }
function fail(res, error, status = 400, extra = {}) { return res.status(status).json({ ok: false, error, ...extra }); }

// ── Validación JWT de Supabase (bloqueo 401) ────────────────────────────────
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
    } else {
      console.warn('[alegra-proxy] SUPABASE_JWT_SECRET no configurado. Verificación de firma OFF.');
    }

    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (payload.role === 'service_role') return null;

    return { uid: payload.sub || null, email: payload.email || null };
  } catch { return null; }
}

function requireEnv() {
  return Boolean(ALEGRA_EMAIL && ALEGRA_TOKEN);
}

function basicAuthHeader() {
  const raw = `${ALEGRA_EMAIL}:${ALEGRA_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

// ── Retry exponencial (3 intentos: 500ms, 1500ms, 4000ms) ───────────────────
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function alegraFetchWithRetry(path, options = {}, maxAttempts = 3) {
  const delays = [500, 1500, 4000];
  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`${ALEGRA_API_BASE}${path}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: basicAuthHeader(),
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      // Retry solo en errores transitorios (429, 502, 503, 504)
      if ([429, 502, 503, 504].includes(response.status) && attempt < maxAttempts - 1) {
        await sleep(delays[attempt]);
        continue;
      }

      const data = await response.json().catch(() => ({}));
      return { response, data };
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1) await sleep(delays[attempt]);
    }
  }
  throw lastError || new Error('Fallo de red tras reintentos con Alegra.');
}

function sanitizeText(value, max = 255) { return String(value || '').trim().slice(0, max); }
function sanitizeRFC(value) { return String(value || '').trim().toUpperCase(); }

function isValidRFC(value) {
  const clean = sanitizeRFC(value);
  return /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(clean) || clean === 'XAXX010101000' || clean === 'XEXX010101000';
}
function isPMByRFC(rfc) {
  const clean = sanitizeRFC(rfc);
  return /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/.test(clean) && clean !== 'XAXX010101000' && clean !== 'XEXX010101000';
}

// ── Validación Fiscal: fuerza régimen 626 + Uso CFDI válido RMF 2026 ────────
function validateInvoiceInput(input = {}) {
  const errors = [];
  if (!isValidRFC(input.rfc)) errors.push('RFC receptor inválido.');
  if (!sanitizeText(input.name)) errors.push('Nombre o razón social requerido.');
  if (!/^\d{5}$/.test(String(input.zip || '').trim())) errors.push('Código postal receptor inválido.');

  // Régimen del EMISOR siempre forzado a 626 (RESICO), sin importar lo enviado
  input.regimenFiscalEmisor = RESICO_REGIMEN_FISCAL;

  if (!sanitizeText(input.regimenFiscal)) errors.push('Régimen fiscal receptor requerido.');

  const usoCfdi = sanitizeText(input.usoCfdi, 10).toUpperCase();
  if (!VALID_USOS_CFDI_RESICO.includes(usoCfdi)) {
    errors.push(`Uso CFDI '${usoCfdi}' no es compatible con RESICO conforme a la RMF 2026.`);
  }

  if (!['PUE', 'PPD'].includes(String(input.metodoPago || '').trim().toUpperCase())) errors.push('Método de pago inválido.');
  if (!sanitizeText(input.formaPago, 10)) errors.push('Forma de pago requerida.');
  if (!sanitizeText(input.claveProdServ, 20)) errors.push('Clave producto/servicio requerida.');
  if (!sanitizeText(input.description)) errors.push('Descripción requerida.');
  if (!(Number(input.quantity) > 0)) errors.push('Cantidad inválida.');
  if (!(Number(input.unitPrice) > 0)) errors.push('Precio unitario inválido.');
  if (!['16', '0', 'EXENTO'].includes(String(input.ivaType || '').trim().toUpperCase())) errors.push('IVA inválido.');
  return errors;
}

async function createOrFindContact(input) {
  const identification = sanitizeRFC(input.rfc);
  const searchPath = `/contacts?identification=${encodeURIComponent(identification)}`;
  const { response: searchResp, data: searchData } = await alegraFetchWithRetry(searchPath);

  if (searchResp.ok && Array.isArray(searchData) && searchData.length > 0) return searchData[0];

  const payload = {
    name: sanitizeText(input.name),
    identification,
    email: sanitizeText(input.email || ''),
    phonePrimary: sanitizeText(input.phone || ''),
    type: ['client'],
    ignoreRepeated: true
  };

  const { response, data } = await alegraFetchWithRetry('/contacts', { method: 'POST', body: payload });
  if (!response.ok) throw new Error(mapAlegraError(data, response.status));
  return data;
}

function buildInvoicePayload(input, contactId) {
  const quantity = Number(input.quantity || 1);
  const unitPrice = Number(input.unitPrice || 0);
  const receptorPM = String(input.receptorType || '').toUpperCase() === 'PM' || isPMByRFC(input.rfc);

  const item = {
    name: sanitizeText(input.description),
    price: unitPrice,
    quantity,
    reference: sanitizeText(input.claveProdServ, 30)
  };

  // ── FIX FASE 2.2.B.1: Función síncrona, recibe retentionInfo como parámetro ──
function buildInvoicePayload(input, contactId, receptorPM, retentionInfo) {
  const retentionRate = (retentionInfo?.rate || 1.0).toFixed(2);
  const retentionBracket = retentionInfo?.bracket || 'Hasta $300,000';
  
  const payload = {
    client: Number(contactId),
    date: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    observations: [
      `Régimen fiscal emisor: 626 (RESICO)`,
      `Uso CFDI: ${sanitizeText(input.usoCfdi, 20)}`,
      `Régimen fiscal receptor: ${sanitizeText(input.regimenFiscal, 30)}`,
      `CP receptor: ${sanitizeText(input.zip, 10)}`,
      `Método de pago: ${sanitizeText(input.metodoPago, 10)}`,
      `Forma de pago: ${sanitizeText(input.formaPago, 10)}`,
      `Retención ISR RESICO: ${retentionRate}% (bracket ${retentionBracket})`
    ].join(' | '),
    items: [item],
    status: String(input.metodoPago || '').toUpperCase() === 'PUE' ? 'open' : 'draft',
    metadata: {
      aliado_resico: true,
      regimen_fiscal_emisor: RESICO_REGIMEN_FISCAL,
      rfc_receptor: sanitizeRFC(input.rfc),
      uso_cfdi: sanitizeText(input.usoCfdi, 20),
      receptor_zip: sanitizeText(input.zip, 10),
      metodo_pago: sanitizeText(input.metodoPago, 10),
      forma_pago: sanitizeText(input.formaPago, 10),
      iva_type: sanitizeText(input.ivaType, 10),
      receptor_type: receptorPM ? 'PM' : 'PF',
      retention_rate: retentionRate,
      retention_bracket: retentionBracket
    }
  };

  // Retención ISR progresiva (no fija 1.25%)
  if (receptorPM) {
    payload.metadata.auto_retencion_isr_resico = retentionRate;
  }
  
  return payload;
}
  
}

async function createInvoice(input) {
  const contact = await createOrFindContact(input);
  const contactId = contact?.id;
  if (!contactId) throw new Error('No se obtuvo id de contacto en Alegra.');

  const payload = buildInvoicePayload(input, contactId, receptorPM, retentionInfo);
  const { response, data } = await alegraFetchWithRetry('/invoices', { method: 'POST', body: payload });
  if (!response.ok) throw new Error(mapAlegraError(data, response.status));

  return { contact, invoice: data, payloadSent: payload };
}

// ── Descarga de PDF / XML del CFDI timbrado ─────────────────────────────────
async function getInvoiceDocument(invoiceId, format) {
  const path = format === 'xml'
    ? `/invoices/${invoiceId}/stamp/xml`
    : `/invoices/${invoiceId}/stamp/pdf`;

  const { response, data } = await alegraFetchWithRetry(path);
  if (!response.ok) throw new Error(mapAlegraError(data, response.status));
  return data; // Alegra regresa URL o base64 dependiendo del plan
}

// ── Mensajes pedagógicos de error del SAT ───────────────────────────────────
function mapAlegraError(data, status) {
  const rawMsg = String(data?.message || '').toLowerCase();

  if (status === 401 || status === 403) {
    return 'Error del SAT: Verifique la vigencia de su CSD o el RFC del receptor.';
  }
  if (rawMsg.includes('rfc') || rawMsg.includes('identification')) {
    return 'Error del SAT: RFC del receptor inválido o no reconocido. Verifique la Constancia de Situación Fiscal.';
  }
  if (rawMsg.includes('sello') || rawMsg.includes('certificate') || rawMsg.includes('csd')) {
    return 'Error del SAT: Verifique la vigencia de su CSD (Certificado de Sello Digital).';
  }
  if (rawMsg.includes('uso') && rawMsg.includes('cfdi')) {
    return 'Error del SAT: El Uso de CFDI no es compatible con el régimen RESICO (626) conforme a la RMF 2026.';
  }
  return data?.message || 'Error del SAT: Verifique la vigencia de su CSD o el RFC del receptor.';
    // ── FIX FASE 1.7: Detección específica de CSD restringido ─────────────
  // Art. 17-H Bis CFF — El SAT puede restringir CSD por incumplimientos
  const errMsg = String(error?.message || error?.error || '').toLowerCase();
  const errDetails = String(JSON.stringify(error?.details || error?.response || '')).toLowerCase();
  const combinedError = `${errMsg} ${errDetails}`;
  
  if (combinedError.includes('certificado') && (combinedError.includes('cancelado') || combinedError.includes('restringido') || combinedError.includes('vigencia'))) {
    return {
      userMessage: '🚨 Tu Certificado de Sello Digital (CSD) está restringido o cancelado por el SAT (Art. 17-H Bis CFF). No puedes timbrar CFDIs hasta renovarlo. Acude a la oficina del SAT o usa SAT ID para tramitar uno nuevo.',
      httpStatus: 403,
      actionable: true,
      satReference: 'https://sat.gob.mx → Trámites → Certificados',
    };
  }
  
  if (combinedError.includes('buzón') && combinedError.includes('inactivo')) {
    return {
      userMessage: '📭 Tu Buzón Tributario está inactivo. Multa de hasta $10,260 MXN (Art. 17-K CFF). Actívalo en sat.gob.mx antes de timbrar.',
      httpStatus: 403,
      actionable: true,
    };
  }
  
  if (combinedError.includes('efirma') || combinedError.includes('e.firma') || combinedError.includes('firma electronica')) {
    return {
      userMessage: '🔐 Tu e.firma está vencida (Art. 17-D CFF). Sin e.firma vigente no puedes emitir CFDIs. Renueva en el portal del SAT.',
      httpStatus: 403,
      actionable: true,
    };
  }
  
  if (combinedError.includes('rfc') && combinedError.includes('no existe')) {
    return {
      userMessage: '⚠️ El RFC del receptor no existe en el padrón del SAT. Verifica el RFC con el cliente antes de timbrar.',
      httpStatus: 400,
      actionable: true,
    };
  }
}

// ── FIX FASE 2.2.B + 2.3: mapInvoiceSuccess con retención progresiva y alerta REP ──
function mapInvoiceSuccess(result, input, retentionInfo = null, repDeadlineAlert = null) {
  const invoice = result?.invoice || {};
  const receptorPM = String(input.receptorType || '').toUpperCase() === 'PM' || isPMByRFC(input.rfc);
  
  // Tasa de retención progresiva según ingreso anual del emisor
  // Si no hay retentionInfo (fallback), usar 1.00% (tasa base RESICO)
  const retentionRate = retentionInfo?.rate?.toFixed(2) || '1.00';
  const retentionBracket = retentionInfo?.bracket || 'Hasta $300,000';
  
  return {
    ok: true,
    invoice: {
      id: invoice.id || null,
      number: invoice.number || invoice.numberTemplate?.fullNumber || null,
      status: invoice.status || null,
      date: invoice.date || null,
      dueDate: invoice.dueDate || null,
      total: invoice.total || null
    },
    contact: {
      id: result?.contact?.id || null,
      name: result?.contact?.name || sanitizeText(input.name),
      identification: sanitizeRFC(input.rfc)
    },
    fiscal: {
      regimenFiscalEmisor: RESICO_REGIMEN_FISCAL,
      metodoPago: sanitizeText(input.metodoPago, 10),
      formaPago: sanitizeText(input.formaPago, 10),
      usoCfdi: sanitizeText(input.usoCfdi, 20),
      ivaType: sanitizeText(input.ivaType, 10),
      // ── FIX FASE 2.2.B: Retención progresiva (no fija 1.25%) ──────────
      retencionISR125: receptorPM,  // Se mantiene para compatibilidad
      retentionRate: retentionRate,  // Nueva: tasa progresiva real (1.00% a 2.50%)
      retentionBracket: retentionBracket,  // Nueva: bracket del ingreso anual
      emisorAnnualIncome: retentionInfo?.income || 0  // Nueva: ingreso anual del emisor
    },
    repRequired: String(input.metodoPago || '').toUpperCase() === 'PPD',
    // ── FIX FASE 2.3: Alerta de plazo REP (RMF 2026) ────────────────────
    repDeadlineAlert: repDeadlineAlert || null
  };
}

export default async function handler(req, res) {
  setHeaders(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return fail(res, 'Method Not Allowed', 405);

  // ── Bloqueo 401: JWT obligatorio para todas las acciones excepto webhook_verify ──
  const body = parseBody(req);
  const action = sanitizeText(body.action, 50);

  if (action !== 'webhook_verify') {
    const user = await validateSupabaseJWT(req.headers.authorization);
    if (!user) {
      return fail(res, 'No autorizado. Se requiere sesión activa de Supabase.', 401);
    }
    req.aliadoUser = user;
  }

  if (!requireEnv()) return fail(res, 'Alegra no está configurado en el servidor.', 503);

  try {
    if (action === 'health') {
      return okJson(res, { ok: true, provider: 'alegra', auth: 'basic', regimen_forzado: RESICO_REGIMEN_FISCAL });
    }

    if (action === 'create_contact') {
      const input = body.input || {};
      if (!isValidRFC(input.rfc)) return fail(res, 'RFC inválido.');
      const contact = await createOrFindContact(input);
      return okJson(res, { ok: true, contact });
    }

    if (action === 'create_invoice') {
  const input = body.input || {};
  const errors = validateInvoiceInput(input);
  if (errors.length) return fail(res, 'Validación fallida.', 422, { details: errors });

  // ── FIX FASE 2.2.B.2: Obtener ingreso anual ANTES de construir payload ──
  // La consulta va aquí (handler async), no en buildInvoicePayload (síncrono)
  let emisorAnnualIncome = 0;
  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY && req.aliadoUser?.uid) {
      const metricsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/fiscal_metrics?user_id=eq.${req.aliadoUser.uid}&select=income_ytd`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          }
        }
      );
      const metrics = await metricsRes.json();
      emisorAnnualIncome = Array.isArray(metrics) && metrics[0]?.income_ytd
        ? Number(metrics[0].income_ytd)
        : 0;
    }
  } catch (e) {
    console.warn('[alegra-proxy] No se pudo obtener income_ytd:', e.message);
  }

  // Calcular retención progresiva con el ingreso anual
  const retentionInfo = calculateProgressiveRetention(emisorAnnualIncome);

  // Pasar retentionInfo a la función que construye el payload
  const result = await createInvoice(input, retentionInfo);
        // ── FIX FASE 2.3.A: Calcular alerta de plazo REP (RMF 2026) ──────────
      const repRequired = String(input.metodoPago || '').toUpperCase() === 'PPD';
      let repDeadlineAlert = null;
      if (repRequired) {
        const today = new Date();
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        const deadline = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 5);
        const daysUntilDeadline = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        repDeadlineAlert = {
          required: true,
          deadline: deadline.toISOString().split('T')[0],
          daysRemaining: daysUntilDeadline,
          message: `⏰ PLAZO RMF 2026: Debes emitir el Complemento de Pago (REP) antes del ${deadline.toLocaleDateString('es-MX')} (${daysUntilDeadline} días). Art. 2.7.1.22 RMF 2026.`,
          urgency: daysUntilDeadline <= 2 ? 'CRÍTICO' : daysUntilDeadline <= 5 ? 'URGENTE' : 'NORMAL',
          legalReference: 'Art. 2.7.1.22 RMF 2026 — 5 días naturales del mes siguiente'
        };
      }
        const successResponse = mapInvoiceSuccess(result, input, retentionInfo);
            // ── FIX FASE 2.3.B (simplificado): Pasar repDeadlineAlert directamente ──
      return okJson(res, mapInvoiceSuccess(result, input, retentionInfo, repDeadlineAlert));
}

    if (action === 'get_pdf') {
      const { invoiceId } = body.input || {};
      if (!invoiceId) return fail(res, 'invoiceId requerido.');
      const doc = await getInvoiceDocument(invoiceId, 'pdf');
      return okJson(res, { ok: true, pdf: doc });
    }

    if (action === 'get_xml') {
      const { invoiceId } = body.input || {};
      if (!invoiceId) return fail(res, 'invoiceId requerido.');
      const doc = await getInvoiceDocument(invoiceId, 'xml');
      return okJson(res, { ok: true, xml: doc });
    }

    if (action === 'webhook_verify') {
      const provided = req.headers['x-alegra-webhook-secret'] || '';
      const valid = Boolean(ALEGRA_WEBHOOK_SECRET) && provided === ALEGRA_WEBHOOK_SECRET;
      return okJson(res, { ok: valid, valid });
    }

    return fail(res, 'Acción no soportada.', 400);
  } catch (error) {
    return fail(res, error?.message || 'Error del SAT: Verifique la vigencia de su CSD o el RFC del receptor.', 500);
  }
}