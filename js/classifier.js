const IntentClassifier = (() => {
  const INTENTS = {
    CONSULTA_FISCAL: {
      keywords: ['resico', 'isr', 'iva', 'anual', 'declaración', 'declaracion', 'impuesto', 'sat', 'régimen', 'regimen']
    },
    SOLICITUD_FACTURA: {
      keywords: ['factura', 'cfdi', 'timbrar', 'timbrado', 'comprobante', 'folio']
    },
    REGISTRO_GASTO: {
      keywords: ['gasto', 'ticket', 'deducir', 'acreditar', 'iva acreditable', 'subtotal', 'proveedor']
    },
    REPORTE_PAGO: {
      keywords: ['pagué', 'pague', 'pagué', 'pago', 'transferencia', 'deposité', 'deposite', 'aboné', 'abone']
    },
    SALUD_FISCAL: {
      keywords: ['buzón', 'buzon', 'e.firma', 'efirma', 'opinión', 'opinion', 'cumplimiento', 'sello digital', 'csd']
    }
  };

  function normalizeText(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function extractKeywords(text, list) {
    const t = normalizeText(text);
    return list.filter(k => t.includes(normalizeText(k)));
  }

  function classifyLocal(text) {
    let bestIntent = 'OTROS';
    let bestHits = [];

    Object.entries(INTENTS).forEach(([intent, cfg]) => {
      const hits = extractKeywords(text, cfg.keywords);
      if (hits.length > bestHits.length) {
        bestIntent = intent;
        bestHits = hits;
      }
    });

    const confidence = bestHits.length
      ? Math.min(0.99, 0.62 + bestHits.length * 0.08)
      : 0.55;

    return {
      intent: bestIntent,
      confidence,
      keywordsMatched: bestHits
    };
  }

  function getContext() {
    const st = window.Store?.getState?.() || {};
    return {
      incomeYTD: st?.incomeYTD ?? 0,
      annualLimit: st?.fiscalMetrics?.annualLimit ?? 3500000,
      riskLevel: st?.fiscalMetrics?.riskLevel ?? 'SEGURO',
      isDemo: !!window.APP_STATE?.isDemo,
      userEmail: window.APP_STATE?.currentUser?.email || ''
    };
  }

  async function askProxy(text) {
    const response = await fetch('/api/gemini-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        context: getContext()
      })
    });

    if (!response.ok) {
      throw new Error(`Proxy HTTP ${response.status}`);
    }

    return response.json();
  }

  function extractReply(data) {
    if (typeof data?.reply === 'string' && data.reply.trim()) {
      return data.reply.trim();
    }

    const rawReply = data?.raw?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || '')
      .join('\n')
      .trim();

    if (rawReply) return rawReply;

    const fallbackReply = data?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || '')
      .join('\n')
      .trim();

    return fallbackReply || '';
  }

  async function process(text) {
    const local = classifyLocal(text);

    try {
      const data = await askProxy(text);
      const assistantReply = extractReply(data);

      return {
        intent: local.intent,
        confidence: local.confidence,
        keywordsMatched: local.keywordsMatched,
        assistantReply: assistantReply || 'No pude generar una respuesta completa, pero ya identifiqué tu consulta fiscal.',
        source: data?.source || 'gemini-proxy',
        isFallback: !!data?.is_fallback,
        raw: data
      };
    } catch (err) {
      return {
        intent: local.intent,
        confidence: Math.max(0.5, local.confidence - 0.1),
        keywordsMatched: local.keywordsMatched,
        assistantReply:
          'Tu consulta fue identificada, pero la IA no respondió en este momento. Regla base: en RESICO el ISR se calcula sobre ingresos brutos y la anual no debe confirmarse sin revisar si hubo ingresos mixtos.',
        source: 'local-fallback',
        isFallback: true,
        raw: { error: err?.message || 'unknown_error' }
      };
    }
  }

  return { process };
})();

window.IntentClassifier = IntentClassifier;