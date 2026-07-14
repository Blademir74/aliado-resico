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
      keywords: ['pagué', 'pague', 'pago', 'transferencia', 'deposité', 'deposite', 'aboné', 'abone']
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

    return {
      intent: bestIntent,
      confidence: bestHits.length ? Math.min(0.99, 0.62 + bestHits.length * 0.08) : 0.55,
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
      headers: {
        'Content-Type': 'application/json',
        'x-aliado-debug': '1'
      },
      body: JSON.stringify({
        message: text,
        context: getContext()
      })
    });

    const data = await response.json().catch(() => ({}));

    return {
      httpOk: response.ok,
      headers: {
        aiStatus: response.headers.get('x-aliado-ai-status'),
        fallbackReason: response.headers.get('x-aliado-fallback-reason')
      },
      data
    };
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

    return '';
  }

  async function process(text) {
    const local = classifyLocal(text);

    try {
      const { httpOk, headers, data } = await askProxy(text);

      const assistantReply =
        extractReply(data) ||
        'No pude generar una respuesta completa en este momento.';

      if (!httpOk) {
        console.warn('[Classifier] Proxy HTTP error:', data);
      }

      if (data?.is_fallback || headers?.aiStatus === 'fallback') {
        console.warn('[Classifier] Gemini fallback:', {
          reason: data?.fallback_reason || headers?.fallbackReason,
          debug: data?.debug || null
        });
      }

      return {
        intent: local.intent,
        confidence: local.confidence,
        keywordsMatched: local.keywordsMatched,
        assistantReply,
        source: data?.is_fallback ? 'gemini-fallback' : (data?.source || 'gemini-proxy'),
        isFallback: !!data?.is_fallback,
        fallbackReason: data?.fallback_reason || headers?.fallbackReason || null,
        debug: data?.debug || null,
        raw: data
      };
    } catch (err) {
      console.warn('[Classifier] Error consultando proxy:', err);

      return {
        intent: local.intent,
        confidence: Math.max(0.5, local.confidence - 0.1),
        keywordsMatched: local.keywordsMatched,
        assistantReply:
          'La consulta fue identificada, pero el proxy de IA no respondió correctamente. Regla base: en RESICO el ISR va sobre ingresos brutos y la anual debe revisarse con ingresos mixtos.',
        source: 'local-fallback',
        isFallback: true,
        fallbackReason: 'proxy_exception',
        debug: { message: err?.message || 'unknown_error' },
        raw: { error: err?.message || 'unknown_error' }
      };
    }
  }

  return { process };
})();

window.IntentClassifier = IntentClassifier;