/* ============================================
ALIADO RESICO — OCR & Document Processor v2.3
Vision Strict, Human Review >=0.85, RLS Ready
============================================ */
const DocumentProcessor = (() => {
  const HUMAN_REVIEW_THRESHOLD = 0.85;

  const OCR_PROMPT = `Eres un OCR fiscal mexicano con precisión 97%. Responde SOLO JSON válido. Sin markdown.
Extrae: {"document_type":"CFDI|TICKET|TRANSFERENCIA|NOTA_VENTA|RECIBO|DESCONOCIDO","confidence":0.97,"emisor_rfc":"RFC o null","receptor_rfc":"RFC o null","subtotal":123.45,"iva":19.75,"iva_tasa":16,"total":143.20,"fecha":"DD/MM/AAAA","quality_notes":"notas o null"}
REGLAS: Montos SOLO números. Si no es legible, pon null. Confidence refleja calidad REAL. Si no es documento fiscal, document_type:"DESCONOCIDO", confidence:0.1`;

  function extractJSON(raw) {
    if (!raw?.trim()) return null;
    const c = raw.replace(/`(?:json)?\s*([\s\S]*?)`/gi, '$1').trim();
    const s = c.indexOf('{'), e = c.lastIndexOf('}');
    return (s !== -1 && e > s) ? c.slice(s, e + 1) : null;
  }

  async function fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  async function processWithGemini(file) {
    const base64 = await fileToBase64(file);
    const res = await fetch('/api/gemini-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: OCR_PROMPT }, { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } }] }],
        generationConfig: { temperature: 0.05, maxOutputTokens: 600 }
      })
    });
    if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
    const data = await res.json();
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) throw new Error('Respuesta OCR vacía');
    
    const json = extractJSON(txt);
    if (!json) throw new Error('OCR no retornó JSON');
    return JSON.parse(json);
  }

  async function processImage(file) {
    const start = performance.now();
    try {
      const gem = await processWithGemini(file);
      const conf = Math.max(0, Math.min(1, gem.confidence || 0.5));
      const needsReview = conf < HUMAN_REVIEW_THRESHOLD;
      const pedagogicMessage = "🔎 **ISR RESICO**: Se paga sobre ingreso bruto (sin deducciones). Este gasto NO reduce tu ISR.\n🟣 **IVA**: Este gasto es INDISPENSABLE para acreditar tu IVA. Asegúrate de tener CFDI 4.0 con tu RFC correcto.";
      return {
  type: gem.document_type === 'CFDI' ? 'CFDI' : 'TICKET',
  status: needsReview ? 'needs_review' : 'processed',
  confidence: conf,
  needsHumanReview: needsReview,
  humanReviewReason: needsReview ? `Confianza ${(conf*100).toFixed(0)}% < 85%. ${gem.quality_notes || 'Verificar datos fiscales críticos.'}` : null,
  pedagogicMessage: pedagogicMessage,  // <-- Nuevo campo
  source: 'gemini_vision',
  processingTime: `${((performance.now()-start)/1000).toFixed(1)}s`,
  data: {
          emisor_rfc: gem.emisor_rfc || null,
          receptor_rfc: gem.receptor_rfc || null,
          subtotal: gem.subtotal ? Number(gem.subtotal) : null,
          iva: gem.iva ? Number(gem.iva) : null,
          total: gem.total ? Number(gem.total) : null,
          fecha: gem.fecha || null
        },
        fileName: file.name,
        fileSize: `${(file.size/1024).toFixed(1)} KB`
      };
    } catch (err) {
      console.warn('[OCR] Proxy falló:', err.message);
      throw new Error('Procesamiento OCR no disponible. Intente con imagen más nítida.');
    }
  }

  return { processImage, HUMAN_REVIEW_THRESHOLD };
})();
if (typeof window !== 'undefined') window.DocumentProcessor = DocumentProcessor;