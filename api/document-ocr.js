const ALLOWED_ORIGINS = [
  'https://aliado-resico.vercel.app',
  'https://aliadoresico.com',
  'https://www.aliadoresico.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500'
];

const GEMINI_MODEL = 'gemini-1.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

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

function fallback(reason, fileName = '') {
  return {
    ok: true,
    is_fallback: true,
    reason,
    document: {
      file_name: fileName || 'documento',
      document_type: 'DESCONOCIDO',
      confidence: 0.5,
      file_url: `local:${fileName || 'documento'}`,
      extracted_data: {
        rfc_emisor: null,
        rfc_receptor: null,
        subtotal: null,
        iva: null,
        total: null,
        folio: null,
        fecha: null
      },
      safety_flag: true,
      pedagogical_note: 'ISR: Sin deducciones. IVA: Gasto indispensable para acreditamiento con CFDI válido.'
    },
    needsHumanReview: true
  };
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```json/gi, '```').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return cleaned.slice(start, end + 1);
}

export default async function handler(req, res) {
  setHeaders(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  if (!geminiApiKey) {
    return res.status(200).json(fallback('missing_api_key', req.body?.fileName || ''));
  }

  const { fileName, mimeType, base64Data } = req.body || {};
  if (!fileName || !mimeType || !base64Data) {
    return res.status(400).json({
      ok: false,
      error: 'fileName, mimeType y base64Data son requeridos.'
    });
  }

  const prompt = [
    'Eres un extractor fiscal mexicano para RESICO 2026.',
    'Analiza el documento y responde SOLO JSON válido.',
    'Sin markdown. Sin texto adicional.',
    'Identifica si es CFDI, ticket, constancia, opinión de cumplimiento, e.firma u otro.',
    'Campos exactos:',
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
    'Si no puedes leer algo, devuelve null.',
    'Si es gasto, recuerda que en RESICO el ISR no deduce gastos, pero el IVA sí requiere CFDI válido y gasto indispensable.'
  ].join('\n');

  const body = {
    contents: [
      {
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
      temperature: 0.1,
      maxOutputTokens: 600
    }
  };

  try {
    const response = await fetch(`${GEMINI_ENDPOINT}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || data?.error) {
      return res.status(200).json(fallback('gemini_error', fileName));
    }

    const rawText = data?.candidates?.?.content?.parts?.?.text || '';
    const jsonText = extractJSON(rawText);

    if (!jsonText) {
      return res.status(200).json(fallback('empty_response', fileName));
    }

    const parsed = JSON.parse(jsonText);
    const confidence = Number(parsed.confidence || 0);
    const safetyFlag = confidence < 0.85;

    return res.status(200).json({
      ok: true,
      is_fallback: false,
      document: {
        file_name: fileName,
        document_type: parsed.document_type || 'OTRO',
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
        pedagogical_note: 'ISR: Sin deducciones (tasa fija). IVA: Gasto indispensable para acreditamiento con CFDI válido.'
      },
      needsHumanReview: safetyFlag
    });
  } catch (error) {
    return res.status(200).json(fallback(error?.message || 'network_error', fileName));
  }
}