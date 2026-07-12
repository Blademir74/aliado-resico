const IntentClassifier = (() => {
  const CACHE = new Map();
  const CACHE_MAX = 100;
  const CACHE_TTL = 5 * 60 * 1000;
  const FLOW_KEY = 'ar_annual_flow_v2';

  const SLANG_MAP = {
    'la chiva': 'sat',
    'el chivo': 'sat',
    'hacienda': 'sat',
    'timbrar': 'emitir cfdi',
    'facturar': 'emitir cfdi',
    'recibito': 'ticket',
    'notita': 'nota de venta',
    'me cayó': 'recibi pago',
    'deposité': 'recibi pago',
    'me devuelvan': 'devolucion',
    'me regresen': 'devolucion'
  };

  function normalize(text) {
    let t = String(text || '').toLowerCase().trim();
    Object.entries(SLANG_MAP).forEach(([a, b]) => {
      t = t.replaceAll(a, b);
    });
    return t;
  }

  function getAnnualFlow() {
    try {
      return JSON.parse(localStorage.getItem(FLOW_KEY) || '{"awaiting":false}');
    } catch {
      return { awaiting: false };
    }
  }

  function setAnnualFlow(v) {
    try {
      localStorage.setItem(FLOW_KEY, JSON.stringify(v));
    } catch (_) {}
  }

  function clearAnnualFlow() {
    setAnnualFlow({ awaiting: false });
  }

  function detectAnnual(raw) {
    const text = normalize(raw);
    const flow = getAnnualFlow();

    const yes = /^(si|sí|yes|claro)\b/.test(text);
    const no = /^(no|nel)\b/.test(text);
    const mixed = /(salarios?|nomina|nómina|intereses?|dividendos?|arrendamiento|plataformas?|uber|didi|mercado libre)/i.test(text);
    const asksAnnual = /(declaraci[oó]n anual|anual|tengo que presentar anual|debo presentar anual)/i.test(text);
    const onlyResico = /(solo resico|solamente resico|puro resico)/i.test(text);

    if (flow.awaiting) {
      if (yes || mixed) {
        clearAnnualFlow();
        return {
          annual_obligation: 'obligated',
          assistant_reply: 'Sí debes tratar el caso como posible obligación anual porque confirmaste ingresos mixtos. Primero revisa pagos mensuales, buzón y e.firma.'
        };
      }
      if (no || onlyResico) {
        clearAnnualFlow();
        return {
          annual_obligation: 'not_obligated',
          assistant_reply: 'Si solo tuviste ingresos RESICO y cumpliste pagos mensuales, no debes marcar la anual como obligatoria por defecto.'
        };
      }
      return {
        annual_obligation: 'ask_mixed_income',
        assistant_reply: 'Para cerrar la validación, respóndeme sí o no: ¿tuviste ingresos mixtos como salarios mayores a $400,000, intereses, dividendos, arrendamiento o plataformas?'
      };
    }

    if (asksAnnual) {
      if (mixed) {
        return {
          annual_obligation: 'obligated',
          assistant_reply: 'Hay indicios de ingresos mixtos; no debe tratarse como RESICO puro.'
        };
      }
      if (onlyResico) {
        return {
          annual_obligation: 'not_obligated',
          assistant_reply: 'Si tu caso es RESICO puro y cumpliste con pagos mensuales, no se confirma obligación anual automática.'
        };
      }
      setAnnualFlow({ awaiting: true });
      return {
        annual_obligation: 'ask_mixed_income',
        assistant_reply: 'Antes de confirmarte la anual necesito validar algo: ¿tuviste solo RESICO o también salarios mayores a $400,000, intereses, dividendos, arrendamiento o plataformas?'
      };
    }

    return null;
  }

  function classifyLocal(raw) {
    const text = normalize(raw);
    const annual = detectAnnual(raw);

    if (annual) {
      return {
        intent: 'CONSULTA_FISCAL',
        confidence: 0.95,
        keywords_matched: ['anual', 'resico'],
        explanation: 'Flujo condicional anual',
        source: 'local',
        ...annual
      };
    }

    const buckets = [
      ['SALUD_FISCAL', /(buz[oó]n|e\.firma|efirma|multa|sat|notificaci[oó]n|sellos|csd)/i],
      ['DEVOLUCION_SALDO_A_FAVOR', /(saldo a favor|devoluci[oó]n|me retuvieron|compensaci[oó]n)/i],
      ['REGISTRO_GASTO', /(gasto|ticket|iva|acreditar|cfdi de gasto|gasolina|compra)/i],
      ['SOLICITUD_FACTURA', /(factura|cfdi|timbrar|xml|folio|receptor)/i],
      ['REPORTE_PAGO', /(cobr[eé]|recibi pago|me pagaron|transferencia|dep[oó]sito|ingreso)/i],
      ['CONSULTA_FISCAL', /(resico|isr|l[ií]mite|3\.5|3500000|anual|113-e|113-f)/i]
    ];

    for (const [intent, rgx] of buckets) {
      if (rgx.test(text)) {
        return {
          intent,
          confidence: 0.84,
          keywords_matched: [],
          explanation: `Clasificación local ${intent}`,
          source: 'local',
          resico_context:
            intent === 'REGISTRO_GASTO'
              ? 'ISR: sin deducciones. IVA: gasto indispensable con CFDI válido para acreditamiento.'
              : (intent === 'CONSULTA_FISCAL' ? 'Límite anual RESICO: $3,500,000 MXN. Umbrales LISR: 80% preventivo ($2.8M), 90% riesgo alto ($3.15M), 94% riesgo de expulsión ($3.3M).' : null),
          salud_fiscal_alerta:
            intent === 'SALUD_FISCAL'
              ? '⚠️ Buzón Tributario inactivo: multa hasta $10,260 MXN, pérdida de plazos y riesgo operativo severo ante el SAT, incluyendo afectación sobre sellos digitales si el incumplimiento escala.'
              : null,
          assistant_reply:
            intent === 'CONSULTA_FISCAL'
              ? 'El límite anual de ingresos para RESICO es de $3,500,000 MXN (Art. 113-E LISR). Los umbrales de riesgo son: 80% Preventivo ($2,800,000 MXN), 90% Riesgo Alto ($3,150,000 MXN) y 94% Riesgo de Expulsión ($3,300,000 MXN).'
              : (intent === 'SALUD_FISCAL' ? 'Art. 17-K CFF: multa hasta $10,260 MXN por Buzón Tributario inactivo, pérdida de plazos y riesgo operativo grave; si el incumplimiento escala, también aumenta el riesgo sobre sellos digitales.' : '')
        };
      }
    }

    return {
      intent: 'OTROS',
      confidence: 0.4,
      keywords_matched: [],
      explanation: 'Sin coincidencias claras',
      source: 'local'
    };
  }

  async function classifyWithProxy(message) {
    const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
    const token = session?.data?.session?.access_token;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const prompt = [
      'Responde SOLO JSON válido.',
      'Campos: intent, confidence, keywords_detected, explanation, annual_obligation, answer, resico_context, salud_fiscal_alerta.',
      `Mensaje: "${String(message || '').slice(0, 1500)}"`
    ].join('\n');

    const r = await fetch('/api/gemini-proxy', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 350 }
      })
    });

    if (!r.ok) throw new Error(`Proxy HTTP ${r.status}`);
    const data = await r.json();
    if (data?.is_fallback) throw new Error(`fallback:${data.fallback_reason || 'proxy'}`);

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = raw.replace(/```json/gi, '```').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('JSON no encontrado');

    const p = JSON.parse(cleaned.slice(start, end + 1));
    return {
      intent: p.intent || 'OTROS',
      confidence: Number(p.confidence || 0.5),
      keywords_matched: p.keywords_detected || [],
      explanation: p.explanation || '',
      annual_obligation: p.annual_obligation ?? null,
      assistant_reply: p.answer || '',
      resico_context: p.resico_context || null,
      salud_fiscal_alerta: p.salud_fiscal_alerta || null,
      source: 'gemini_proxy'
    };
  }

  async function process(message) {
    const key = normalize(message);
    const cached = CACHE.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.value;

    let result;
    try {
      const annual = detectAnnual(message);
      result = annual
        ? { intent: 'CONSULTA_FISCAL', confidence: 0.95, keywords_matched: ['anual'], explanation: 'Flujo anual', source: 'local', ...annual }
        : await classifyWithProxy(message);
    } catch (_) {
      result = classifyLocal(message);
    }

    if (/buz[oó]n inactivo|no tengo buz[oó]n/i.test(normalize(message))) {
      window.Store?.updateSaludFiscal?.({
        buzonTributarioActivo: false,
        alertLevel: 'danger',
        lastAuditDate: new Date().toISOString()
      });
      result.salud_fiscal_alerta =
        '⚠️ Art. 17-K CFF: multa hasta $10,260 MXN por Buzón Tributario inactivo, pérdida de plazos y riesgo operativo grave; si el incumplimiento escala, también aumenta el riesgo sobre sellos digitales.';
    }

    CACHE.set(key, { ts: Date.now(), value: result });
    if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
    return result;
  }

  return {
    process,
    classifyLocal
  };
})();

window.IntentClassifier = IntentClassifier;