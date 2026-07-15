const DocumentsManager = (() => {
  let booted = false;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function fmtDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('es-MX');
  }

  function pct(value) {
    return `${Math.round(Number(value || 0) * 100)}%`;
  }

  function badgeClass(doc) {
    if (doc?.needs_review || doc?.safety_flag) return 'badge-warning';
    return 'badge-safe';
  }

  function badgeText(doc) {
    if (doc?.needs_review || doc?.safety_flag) return 'Revisión humana';
    return 'Procesado';
  }

  function getDocs() {
    return window.Store?.getDocuments?.() || [];
  }

  function ensureUI() {
    const tab = document.getElementById('documents-tab');
    if (!tab) return;

    if (document.getElementById('documents-history-card')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'documents-history-card';
    wrapper.className = 'card glass';
    wrapper.style.padding = '20px';
    wrapper.style.marginTop = '20px';

    wrapper.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <h3 style="color:#e2e8f0;margin:0 0 8px;">Historial documental</h3>
          <p style="color:#94a3b8;margin:0;">CFDI, tickets y documentos fiscales procesados por usuario autenticado.</p>
        </div>
        <div id="documents-summary" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
      </div>

      <div id="documents-empty" style="color:#94a3b8;margin-top:16px;">
        Aún no hay documentos procesados.
      </div>

      <div id="documents-list" style="display:grid;gap:12px;margin-top:16px;"></div>
    `;

    tab.appendChild(wrapper);
  }

  function renderSummary(docs) {
    const el = document.getElementById('documents-summary');
    if (!el) return;

    const total = docs.length;
    const review = docs.filter(d => d.needs_review || d.safety_flag).length;
    const ok = total - review;

    el.innerHTML = `
      <span class="badge-safe" style="padding:6px 12px;border-radius:40px;">Procesados: ${ok}</span>
      <span class="badge-warning" style="padding:6px 12px;border-radius:40px;">Por revisar: ${review}</span>
      <span style="padding:6px 12px;border-radius:40px;background:rgba(255,255,255,0.06);color:#e2e8f0;">Total: ${total}</span>
    `;
  }

  function renderDocuments() {
    ensureUI();

    const docs = getDocs();
    const list = document.getElementById('documents-list');
    const empty = document.getElementById('documents-empty');

    if (!list || !empty) return;

    renderSummary(docs);

    if (!docs.length) {
      empty.style.display = 'block';
      list.innerHTML = '';
      return;
    }

    empty.style.display = 'none';

    list.innerHTML = docs.map(doc => {
      const data = doc.extracted_data || {};
      const subtotal = data.subtotal ?? '—';
      const iva = data.iva ?? '—';
      const total = data.total ?? '—';
      const rfcEmisor = data.rfc_emisor || '—';
      const fecha = data.fecha || '—';

      return `
        <article style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:16px;">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;">
            <div>
              <div style="font-weight:700;color:#e2e8f0;">${esc(doc.file_name || 'archivo')}</div>
              <div style="color:#94a3b8;font-size:13px;margin-top:4px;">
                Tipo: ${esc(doc.document_type || doc.doc_type || 'OTRO')} · Confianza: ${pct(doc.confidence)}
              </div>
            </div>
            <span class="${badgeClass(doc)}" style="padding:6px 10px;border-radius:999px;">${badgeText(doc)}</span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:12px;">
            <div style="background:rgba(0,0,0,0.18);padding:10px;border-radius:12px;">
              <div style="color:#94a3b8;font-size:12px;">RFC emisor</div>
              <div style="color:#e2e8f0;">${esc(rfcEmisor)}</div>
            </div>
            <div style="background:rgba(0,0,0,0.18);padding:10px;border-radius:12px;">
              <div style="color:#94a3b8;font-size:12px;">Subtotal</div>
              <div style="color:#e2e8f0;">${esc(subtotal)}</div>
            </div>
            <div style="background:rgba(0,0,0,0.18);padding:10px;border-radius:12px;">
              <div style="color:#94a3b8;font-size:12px;">IVA</div>
              <div style="color:#e2e8f0;">${esc(iva)}</div>
            </div>
            <div style="background:rgba(0,0,0,0.18);padding:10px;border-radius:12px;">
              <div style="color:#94a3b8;font-size:12px;">Total</div>
              <div style="color:#e2e8f0;">${esc(total)}</div>
            </div>
            <div style="background:rgba(0,0,0,0.18);padding:10px;border-radius:12px;">
              <div style="color:#94a3b8;font-size:12px;">Fecha fiscal</div>
              <div style="color:#e2e8f0;">${esc(fecha)}</div>
            </div>
            <div style="background:rgba(0,0,0,0.18);padding:10px;border-radius:12px;">
              <div style="color:#94a3b8;font-size:12px;">Guardado</div>
              <div style="color:#e2e8f0;">${esc(fmtDate(doc.created_at))}</div>
            </div>
          </div>

          <div style="margin-top:12px;color:#94a3b8;font-size:13px;">
            Estado: ${esc(doc.validation_status || 'pendiente')} · Fuente: ${esc(doc.source || 'web_upload')}
          </div>
        </article>
      `;
    }).join('');
  }

  function init() {
    if (booted) return;
    booted = true;

    ensureUI();
    renderDocuments();

    window.Store?.on?.('documentAdded', renderDocuments);
    window.Store?.on?.('storeUpdated', renderDocuments);
  }

  return {
    init,
    renderDocuments
  };
})();

window.DocumentsManager = DocumentsManager;