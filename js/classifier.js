const IntentClassifier = (() => {
  const classificationCache = new Map();
  const CACHE_TTL_MS = 5 * 60 * 1000;

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

  const FAST_PATH_REPLIES = {
    hola: 'Hola. Soy tu asistente fiscal RESICO 2026. Puedo ayudarte con ISR, IVA, declaración anual, CFDI, e.firma y Buzón Tributario.',
    buenas: 'Hola. Estoy listo para ayudarte con tu operación RESICO 2026.',
    'buen dia': 'Buen día. Estoy listo para ayudarte con tu operación RESICO 2026.',
    'buen día': 'Buen día. Estoy listo para ayudarte con tu operación RESICO 2026.',
    gracias: 'Con gusto. Seguimos con tu operación fiscal.',
    ok: 'Perfecto. Continúo atento a tu siguiente consulta.',
    okay: 'Perfecto. Continúo atento a tu siguiente consulta.'
  };

  function normalizeText(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function getCacheKey(text) {
    return normalizeText(text);
  }

  function readCache(text) {
    const key = getCacheKey(text);
    const hit = classificationCache.get(key);
    if (!hit) return null;

    if (Date.now() - hit.at > CACHE_TTL_MS) {
      classificationCache.delete(key);
      return null;
    }

    return hit.value;
  }

  function writeCache(text, value) {
    classificationCache.set(getCacheKey(text), {
      at: Date.now(),
      value
    });
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

  function getFastPathReply(text) {
    const key = normalizeText(text);
    return FAST_PATH_REPLIES[key] || null;
  }

  function renderStructuredReply(data) {
    const respuestaFiscal =
      data?.respuestaFiscal ||
      data?.structured?.respuestaFiscal ||
      '';

    const fundamentoLegal =
      data?.fundamentoLegal ||
      data?.structured?.fundamentoLegal ||
      '';

    const diferenciacionIsrIva =
      data?.diferenciacionIsrIva ||
      data?.structured?.diferenciacionIsrIva ||
      '';

    const accionConcreta =
      data?.accionConcreta ||
      data?.structured?.accionConcreta ||
      '';

    const parts = [
      respuestaFiscal,
      fundamentoLegal ? `Fundamento legal: ${fundamentoLegal}` : '',
      diferenciacionIsrIva ? `ISR vs IVA: ${diferenciacionIsrIva}` : '',
      accionConcreta ? `Acción concreta: ${accionConcreta}` : ''
    ].filter(Boolean);

    return parts.join('\n\n').trim();
  }

  async function askProxy(text) {
    // Obtener el JWT de Supabase para validación en el proxy (v3.0).
    // El proxy rechaza peticiones sin sesión activa (401) para blindar la cuota de Vertex AI.
    let supabaseToken = '';
    try {
      const session = await window.APP_STATE?.supabase?.auth?.getSession?.();
      supabaseToken = session?.data?.session?.access_token || '';
    } catch (_) { /* silent — el proxy usa fallback si no hay token en dev */ }

    const headers = { 'Content-Type': 'application/json' };
      if (supabaseToken) headers['Authorization'] = `Bearer ${supabaseToken}`;
      if (window.APP_STATE?.isDemo) headers['x-demo-mode'] = 'true'; // [PASO 1] demo sin 401

    const response = await fetch('/api/gemini-proxy', {
      method: 'POST',
      headers,
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
        fallbackReason: response.headers.get('x-aliado-fallback-reason'),
        provider: response.headers.get('x-aliado-provider')
      },
      data
    };
  }

  function extractReply(data) {
    if (typeof data?.reply === 'string' && data.reply.trim()) {
      return data.reply.trim();
    }

    const structuredReply = renderStructuredReply(data);
    if (structuredReply) return structuredReply;

    const rawReply = data?.raw?.candidates?.[0]?.content?.parts
      ?.map(p => p?.text || '')
      .join('\n')
      .trim();

    return rawReply || '';
  }

  function buildResult(base, overrides = {}) {
    return {
      intent: base.intent,
      confidence: base.confidence,
      keywordsMatched: base.keywordsMatched,
      assistantReply: overrides.assistantReply || '',
      source: overrides.source || 'local',
      isFallback: !!overrides.isFallback,
      fallbackReason: overrides.fallbackReason || null,
      debug: overrides.debug || null,
      raw: overrides.raw || null
    };
  }

  async function process(text) {
    const cleanText = String(text || '').trim();
    const local = classifyLocal(cleanText);

    if (!cleanText) {
      const result = buildResult(local, {
        assistantReply: 'Escribe tu consulta fiscal para ayudarte con RESICO 2026.',
        source: 'local-empty',
        isFallback: false,
        raw: { empty: true }
      });
      return result;
    }

    const cached = readCache(cleanText);
    if (cached) {
      return { ...cached, source: 'cache' };
    }

    const fastReply = getFastPathReply(cleanText);
    if (fastReply) {
      const result = buildResult(local, {
        assistantReply: fastReply,
        source: 'local-fastpath',
        isFallback: false,
        raw: { fastPath: true }
      });
      writeCache(cleanText, result);
      return result;
    }

    try {
      const { httpOk, headers, data } = await askProxy(cleanText);
      const fallbackReason = data?.fallback_reason || headers?.fallbackReason || null;

      let assistantReply =
        extractReply(data) ||
        'No pude generar una respuesta completa en este momento.';

      if (fallbackReason === 'quota_exhausted') {
        assistantReply =
          'En este momento el servicio de IA del asistente está temporalmente limitado. ' +
          'Tu consulta sí fue identificada correctamente. Regla base: en RESICO el ISR se calcula sobre ingresos brutos y el IVA requiere CFDI válido y gasto facturado para acreditamiento.';
      }

      if (!httpOk) {
        console.warn('[Classifier] Proxy HTTP error:', data);
      }

      if (data?.is_fallback || headers?.aiStatus === 'fallback') {
        console.warn('[Classifier] Gemini fallback:', {
          reason: fallbackReason,
          debug: data?.debug || null,
          provider: headers?.provider || data?.provider || null
        });
      }

      const result = buildResult(local, {
        assistantReply,
        source: data?.is_fallback ? 'gemini-fallback' : (data?.source || 'gemini-proxy'),
        isFallback: !!data?.is_fallback,
        fallbackReason,
        debug: data?.debug || null,
        raw: data
      });

      writeCache(cleanText, result);
      return result;
    } catch (err) {
      console.warn('[Classifier] Error consultando proxy:', err);

      const result = buildResult(local, {
        assistantReply:
          'La consulta fue identificada, pero el proxy de IA no respondió correctamente. Regla base: en RESICO el ISR va sobre ingresos brutos y la anual debe revisarse con ingresos mixtos.',
        source: 'local-fallback',
        isFallback: true,
        fallbackReason: 'proxy_exception',
        debug: { message: err?.message || 'unknown_error' },
        raw: { error: err?.message || 'unknown_error' }
      });

      writeCache(cleanText, result);
      return result;
    }
  }

  return { process };
})();

window.IntentClassifier = IntentClassifier;