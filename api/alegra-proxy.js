const ALEGRA_API_BASE = process.env.ALEGRA_API_BASE || 'https://api.alegra.com/api/v1';
const ALEGRA_API_USER = process.env.ALEGRA_API_USER || '';
const ALEGRA_API_TOKEN = process.env.ALEGRA_API_TOKEN || '';
const ALEGRA_WEBHOOK_SECRET = process.env.ALEGRA_WEBHOOK_SECRET || '';

const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'https://www.aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
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
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function okJson(res, body = {}, status = 200) {
  return res.status(status).json(body);
}

function fail(res, error, status = 400, extra = {}) {
  return res.status(status).json({ ok: false, error, ...extra });
}

function requireEnv() {
  return Boolean(ALEGRA_API_USER && ALEGRA_API_TOKEN);
}

function basicAuthHeader() {
  const raw = `${ALEGRA_API_USER}:${ALEGRA_API_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}

async function alegraFetch(path, options = {}) {
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

  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function sanitizeText(value, max = 255) {
  return String(value || '').trim().slice(0, max);
}

function sanitizeRFC(value) {
  return String(value || '').trim().toUpperCase();
}

function isValidRFC(value) {
  const clean = sanitizeRFC(value);
  return /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(clean) || clean === 'XAXX010101000' || clean === 'XEXX010101000';
}

function isPMByRFC(rfc) {
  const clean = sanitizeRFC(rfc);
  return /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/.test(clean) && clean !== 'XAXX010101000' && clean !== 'XEXX010101000';
}

function validateInvoiceInput(input = {}) {
  const errors = [];
  if (!isValidRFC(input.rfc)) errors.push('RFC receptor inválido.');
  if (!sanitizeText(input.name)) errors.push('Nombre o razón social requerido.');
  if (!/^\d{5}$/.test(String(input.zip || '').trim())) errors.push('Código postal receptor inválido.');
  if (!sanitizeText(input.regimenFiscal)) errors.push('Régimen fiscal receptor requerido.');
  if (!sanitizeText(input.usoCfdi)) errors.push('Uso CFDI requerido.');
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
  const { response: searchResp, data: searchData } = await alegraFetch(searchPath);

  if (searchResp.ok && Array.isArray(searchData) && searchData.length > 0) {
    return searchData[0];
  }

  const payload = {
    name: sanitizeText(input.name),
    identification,
    email: sanitizeText(input.email || ''),
    phonePrimary: sanitizeText(input.phone || ''),
    type: ['client'],
    ignoreRepeated: true
  };

  const { response, data } = await alegraFetch('/contacts', {
    method: 'POST',
    body: payload
  });

  if (!response.ok) {
    throw new Error(data?.message || 'No se pudo crear el contacto en Alegra.');
  }

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

  const payload = {
    client: Number(contactId),
    date: new Date().toISOString().slice(0, 10),
    dueDate: new Date().toISOString().slice(0, 10),
    observations: [
      `Uso CFDI: ${sanitizeText(input.usoCfdi, 20)}`,
      `Régimen fiscal receptor: ${sanitizeText(input.regimenFiscal, 30)}`,
      `CP receptor: ${sanitizeText(input.zip, 10)}`,
      `Método de pago: ${sanitizeText(input.metodoPago, 10)}`,
      `Forma de pago: ${sanitizeText(input.formaPago, 10)}`
    ].join(' | '),
    items: [item]
  };

  if (String(input.metodoPago || '').toUpperCase() === 'PUE') {
    payload.status = 'open';
  } else {
    payload.status = 'draft';
  }

  payload.metadata = {
    aliado_resico: true,
    rfc_receptor: sanitizeRFC(input.rfc),
    uso_cfdi: sanitizeText(input.usoCfdi, 20),
    receptor_zip: sanitizeText(input.zip, 10),
    metodo_pago: sanitizeText(input.metodoPago, 10),
    forma_pago: sanitizeText(input.formaPago, 10),
    iva_type: sanitizeText(input.ivaType, 10),
    receptor_type: receptorPM ? 'PM' : 'PF'
  };

  if (receptorPM) {
    payload.metadata.auto_retencion_isr_resico = '1.25';
  }

  return payload;
}

async function createInvoice(input) {
  const contact = await createOrFindContact(input);
  const contactId = contact?.id;

  if (!contactId) {
    throw new Error('No se obtuvo id de contacto en Alegra.');
  }

  const payload = buildInvoicePayload(input, contactId);
  const { response, data } = await alegraFetch('/invoices', {
    method: 'POST',
    body: payload
  });

  if (!response.ok) {
    throw new Error(data?.message || 'No se pudo crear la factura en Alegra.');
  }

  return {
    contact,
    invoice: data,
    payloadSent: payload
  };
}

async function createPayment(input = {}) {
  const payload = {
    invoice: Number(input.invoiceId),
    date: input.date || new Date().toISOString().slice(0, 10),
    amount: Number(input.amount || 0),
    observations: sanitizeText(input.observations || 'Pago registrado desde Aliado RESICO')
  };

  const { response, data } = await alegraFetch('/payments', {
    method: 'POST',
    body: payload
  });

  if (!response.ok) {
    throw new Error(data?.message || 'No se pudo registrar el pago en Alegra.');
  }

  return data;
}

function mapInvoiceSuccess(result, input) {
  const invoice = result?.invoice || {};
  const receptorPM = String(input.receptorType || '').toUpperCase() === 'PM' || isPMByRFC(input.rfc);
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
      metodoPago: sanitizeText(input.metodoPago, 10),
      formaPago: sanitizeText(input.formaPago, 10),
      usoCfdi: sanitizeText(input.usoCfdi, 20),
      ivaType: sanitizeText(input.ivaType, 10),
      retencionISR125: receptorPM
    },
    repRequired: String(input.metodoPago || '').toUpperCase() === 'PPD'
  };
}

export default async function handler(req, res) {
  setHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return fail(res, 'Method Not Allowed', 405);
  }

  if (!requireEnv()) {
    return fail(res, 'Alegra no está configurado en el servidor.', 503);
  }

  const body = parseBody(req);
  const action = sanitizeText(body.action, 50);

  try {
    if (action === 'health') {
      return okJson(res, { ok: true, provider: 'alegra', auth: 'basic' });
    }

    if (action === 'create_contact') {
      const input = body.input || {};
      if (!isValidRFC(input.rfc)) {
        return fail(res, 'RFC inválido.');
      }

      const contact = await createOrFindContact(input);
      return okJson(res, { ok: true, contact });
    }

    if (action === 'create_invoice') {
      const input = body.input || {};
      const errors = validateInvoiceInput(input);

      if (errors.length) {
        return fail(res, 'Validación fallida.', 422, { details: errors });
      }

      const result = await createInvoice(input);
      return okJson(res, mapInvoiceSuccess(result, input));
    }

    if (action === 'create_payment') {
      const input = body.input || {};
      if (!input.invoiceId || !(Number(input.amount) > 0)) {
        return fail(res, 'invoiceId y amount son requeridos.');
      }

      const payment = await createPayment(input);
      return okJson(res, { ok: true, payment });
    }

    if (action === 'emit_rep') {
      return okJson(res, {
        ok: false,
        pending: true,
        message: 'La emisión automática de REP queda preparada, pero falta mapear el payload exacto de tu cuenta/endpoint operativo de Alegra.'
      });
    }

    if (action === 'webhook_verify') {
      const provided = req.headers['x-alegra-webhook-secret'] || '';
      const valid = Boolean(ALEGRA_WEBHOOK_SECRET) && provided === ALEGRA_WEBHOOK_SECRET;
      return okJson(res, { ok: valid, valid });
    }

    return fail(res, 'Acción no soportada.', 400);
  } catch (error) {
    return fail(res, error?.message || 'Error interno en integración Alegra.', 500);
  }
}