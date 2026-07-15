const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'https://www.aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function resolveOrigin(origin = '') {
  if (!origin) return ALLOWED_ORIGINS[0];
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function setHeaders(req, res) {
  res.setHeader('Access-Control-Allow-Origin', resolveOrigin(req.headers.origin || ''));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

function normalizeDocType(value) {
  const v = String(value || '').trim().toUpperCase();
  const allowed = new Set(['CFDI', 'TICKET', 'CONSTANCIA', 'OPINION', 'EFIRMA', 'OTRO']);
  return allowed.has(v) ? v : 'OTRO';
}

function extractReplyText(data) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('\n')
      .trim() || ''
  );
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

function buildFallback(reason, fileName = '') {
  const docType = 'OTRO';
  return {
    ok: true,
    is_fallback: true,
    reason,
    document: {
      file_name: fileName || 'documento',
      doc_type: docType,
      document_type: docType,
      confidence: 0.5,
      file_url: `local:${fileName || 'documento'}`,
      extracted_data: {
        rfc_emisor: null,
        rfc_receptor: null,
        subtotal: null,
        iva: null,
        total: null,
        folio: null,
        fecha: null,
        summary: null,
        tax_usefulness: null
      },
      safety_flag: true,
      validation_status: 'pendiente',
      needs_review: true,
      source: 'ocr_fallback',
      pedagogical_note: 'ISR RESICO: sin deducciones. IVA: requiere CFDI válido y gasto indispensable para acreditamiento.'
    },
    needsHumanReview: true
  };
}

export default async function handler(req, res) {
  setHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
  }

  const body = parseBody(req);
  const { fileName, mimeType, base64Data } = body;
  const apiKey = process.env.GEMINI_API_KEY || '';

  if (!apiKey) {
    return res.status(200).json(buildFallback('missing_api_key', fileName || ''));
  }

  if (!fileName || !mimeType || !base64Data) {
    return res.status(400).json({
      ok: false,
      error: 'fileName, mimeType y base64Data son requeridos.'
    });
  }

  const prompt = [
    'Eres un extractor fiscal mexicano especializado en RESICO 2026.',
    'Analiza el documento y responde SOLO JSON válido.',
    'No uses markdown. No uses explicaciones.',
    'Detecta si es CFDI, ticket, constancia, opinión de cumplimiento, e.firma u otro.',
    'Si falta un dato, devuelve null.',
    'El IVA debe ir explícito cuando se detecte; si no aparece, devuelve 0 o null según corresponda.',
    'Responde con esta forma exacta:',
    '{',
    '"document_type":"CFDI|TICKET|CONSTANCIA|OPINION|EFIRMA|OTRO",',
    '"confidence":0.97,',
    '"rfc_emisor":"string|null",',
    '"rfc_receptor":"string|null",',
    '"subtotal":123.45,',
    '"iva":19.76,',
    '"total":143.21,',
    '"folio":"string|null",',
    '"fecha":"YYYY-MM-DD|null",',
    '"summary":"breve",',
    '"tax_usefulness":"IVA|ISR|AMBOS|NINGUNO"',
    '}',
    'Regla fiscal pedagógica: ISR RESICO no deduce gastos; IVA solo es acreditable con CFDI válido y gasto indispensable.'
  ].join('\n');

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.05,
      topP: 0.9,
      maxOutputTokens: 700
    }
  };

  try {
    const upstream = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok || data?.error) {
      return res.status(200).json(buildFallback('gemini_error', fileName));
    }

    const rawText = extractReplyText(data);
    const jsonText = extractJSON(rawText);

    if (!jsonText) {
      return res.status(200).json(buildFallback('empty_response', fileName));
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return res.status(200).json(buildFallback('invalid_json', fileName));
    }

    const docType = normalizeDocType(parsed.document_type);
    const confidence = Number(parsed.confidence || 0);
    const safetyFlag = confidence < 0.85;

    return res.status(200).json({
      ok: true,
      is_fallback: false,
      document: {
        file_name: fileName,
        doc_type: docType,
        document_type: docType,
        confidence,
        file_url: `local:${fileName}`,
        extracted_data: {
          rfc_emisor: parsed.rfc_emisor || null,
          rfc_receptor: parsed.rfc_receptor || null,
          subtotal: parsed.subtotal ?? null,
          iva: parsed.iva ?? null,
          total: parsed.total ?? null,
          folio: parsed.folio || null,
          fecha: parsed.fecha || null,
          summary: parsed.summary || null,
          tax_usefulness: parsed.tax_usefulness || null
        },
        safety_flag: safetyFlag,
        validation_status: 'pendiente',
        needs_review: safetyFlag,
        source: 'ocr_ai',
        pedagogical_note: 'ISR RESICO: sin deducciones. IVA: requiere CFDI válido y gasto indispensable para acreditamiento.'
      },
      needsHumanReview: safetyFlag,
      model: GEMINI_MODEL
    });
  } catch (error) {
    return res.status(200).json(buildFallback(error?.message || 'network_error', fileName));
  }
}