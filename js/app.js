/* ============================================
   ALIADO RESICO — App Core v3.0
   SPA Router + Init + Config Panel + Documents
   Producción Vercel Ready
   ============================================ */

const App = (() => {
  const views = ['dashboard', 'chat', 'documents', 'settings'];
  const titles = { dashboard: 'Dashboard', chat: 'Clasificador de Intención', documents: 'Documentos', settings: 'Configuración' };

  function navigateTo(viewName) {
    if (!views.includes(viewName)) return;

    views.forEach(v => {
      const el = document.getElementById(`view-${v}`);
      if (el) el.classList.remove('active');
    });

    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
    });

    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[viewName] || viewName;

    if (viewName === 'dashboard') {
      setTimeout(() => Dashboard.render(), 50);
    }

    if (viewName === 'settings') {
      setTimeout(() => refreshConfigStatus(), 100);
    }

    window.location.hash = viewName;
  }

  function updateDateTime() {
    const el = document.getElementById('header-datetime');
    if (el) {
      const now = new Date();
      el.textContent = now.toLocaleDateString('es-MX', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    }
  }

  function initNavigation() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigateTo(btn.getAttribute('data-view'));
      });
    });

    const hash = window.location.hash.replace('#', '');
    if (views.includes(hash)) {
      navigateTo(hash);
    }

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (views.includes(h)) navigateTo(h);
    });
  }

  // =============================================
  // DOCUMENTS MODULE (async OCR)
  // =============================================
  function initDocuments() {
    const zone = document.getElementById('doc-upload-zone');
    const fileInput = document.getElementById('doc-file-input');
    const resultEl = document.getElementById('ocr-result');

    if (zone && fileInput) {
      zone.addEventListener('click', () => fileInput.click());

      zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) processFile(e.dataTransfer.files[0]);
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) processFile(fileInput.files[0]);
      });
    }

    async function processFile(file) {
      if (!resultEl) return;
      resultEl.innerHTML = `<div style="text-align:center;padding:var(--sp-lg)"><div class="typing-indicator" style="justify-content:center"><span></span><span></span><span></span></div><p style="margin-top:var(--sp-md);color:var(--text-muted)">Procesando ${escapeHTMLApp(file.name)}... ${AppConfig.isGeminiConfigured() ? '🧠 Gemini Vision' : '⚡ Modo Demo'}</p></div>`;

      try {
        const result = await DocumentProcessor.processImage(file);

        // Save document to store (and Supabase)
        Store.saveDocument(result);

        // Build the display
        const sourceTag = result.source === 'gemini_vision'
          ? '<span class="source-badge gemini" style="margin-left:var(--sp-sm)">🧠 Gemini Vision</span>'
          : '<span class="source-badge local" style="margin-left:var(--sp-sm)">⚡ Demo</span>';

        // Human review flag
        const reviewBanner = result.needsHumanReview
          ? `<div class="review-flag">
              <span class="review-flag-icon">⚠️</span>
              <div>
                <strong>Verificación Humana Requerida</strong>
                <p>${escapeHTMLApp(result.humanReviewReason || 'Confianza baja — verifique los datos manualmente')}</p>
              </div>
            </div>`
          : '';

        if (result.type === 'CFDI') {
          const validation = DocumentProcessor.validateCFDI(result.data);
          resultEl.innerHTML = `
            <div style="margin-bottom:var(--sp-md)">
              <span class="cat-badge factura" style="font-size:12px;padding:4px 12px">📑 CFDI 4.0 Detectado</span>
              ${sourceTag}
              <span style="margin-left:var(--sp-sm);font-size:12px;color:var(--text-muted)">${escapeHTMLApp(result.fileName)} · ${result.fileSize}${result.processingTime ? ' · ' + result.processingTime : ''}</span>
            </div>
            ${reviewBanner}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-sm);font-size:13px">
              ${Object.entries(result.data).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `
                <div style="padding:var(--sp-sm);background:var(--bg-elevated);border-radius:var(--radius-sm)">
                  <div style="color:var(--text-muted);font-size:11px;text-transform:uppercase">${k.replace(/_/g, ' ')}</div>
                  <div style="color:var(--text-primary);margin-top:2px;word-break:break-all">${v || '<span style="color:var(--text-muted)">No detectado</span>'}</div>
                </div>
              `).join('')}
            </div>
            <div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);border-radius:var(--radius-md);background:${validation.valid ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'};font-size:13px">
              ${validation.valid ? '✅ CFDI válido — Estructura correcta' : '❌ Errores: ' + validation.errors.join(', ')}
            </div>
            <div style="margin-top:var(--sp-sm);font-size:11px;color:var(--text-muted)">Confianza OCR: ${(result.confidence * 100).toFixed(1)}%</div>
          `;
        } else {
          resultEl.innerHTML = `
            <div style="margin-bottom:var(--sp-md)">
              <span class="cat-badge gasto" style="font-size:12px;padding:4px 12px">🧾 ${result.type === 'TRANSFERENCIA' ? 'Transferencia' : 'Ticket'} Detectado</span>
              ${sourceTag}
              <span style="margin-left:var(--sp-sm);font-size:12px;color:var(--text-muted)">${escapeHTMLApp(result.fileName)} · ${result.fileSize}${result.processingTime ? ' · ' + result.processingTime : ''}</span>
            </div>
            ${reviewBanner}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--sp-sm);font-size:13px">
              ${Object.entries(result.data).filter(([k]) => !k.startsWith('_')).map(([k, v]) => `
                <div style="padding:var(--sp-sm);background:var(--bg-elevated);border-radius:var(--radius-sm)">
                  <div style="color:var(--text-muted);font-size:11px;text-transform:uppercase">${k.replace(/_/g, ' ')}</div>
                  <div style="color:var(--text-primary);margin-top:2px">${v || '<span style="color:var(--text-muted)">No detectado</span>'}</div>
                </div>
              `).join('')}
            </div>
            ${result.data.iva ? `<div style="margin-top:var(--sp-md);padding:var(--sp-sm) var(--sp-md);border-radius:var(--radius-md);background:rgba(245,158,11,0.1);font-size:13px">📌 IVA acreditable detectado: ${result.data.iva} — <strong>Indispensable para acreditamiento en RESICO</strong></div>` : ''}
            <div style="margin-top:var(--sp-sm);font-size:11px;color:var(--text-muted)">Confianza OCR: ${(result.confidence * 100).toFixed(1)}%</div>
          `;
        }
      } catch (error) {
        resultEl.innerHTML = `<div style="padding:var(--sp-lg);color:var(--danger)">❌ Error al procesar: ${escapeHTMLApp(error.message)}</div>`;
      }
    }

    // RFC Validator
    const rfcInput = document.getElementById('rfc-input');
    const btnRfc = document.getElementById('btn-validate-rfc');
    const rfcResult = document.getElementById('rfc-result');

    if (btnRfc && rfcInput && rfcResult) {
      btnRfc.addEventListener('click', () => {
        const val = rfcInput.value.trim();
        if (!val) { rfcResult.innerHTML = '<span style="color:var(--warning)">Ingresa un RFC</span>'; return; }

        const result = DocumentProcessor.validateRFC(val);
        if (result.valid) {
          rfcResult.innerHTML = `
            <div style="padding:var(--sp-sm) var(--sp-md);background:rgba(16,185,129,0.1);border-radius:var(--radius-md);border:1px solid rgba(16,185,129,0.2)">
              <div style="color:var(--success);font-weight:600">✅ RFC Válido</div>
              <div style="margin-top:var(--sp-xs);color:var(--text-secondary)">
                Tipo: ${result.type} · RFC: ${result.rfc} · Fecha: ${result.date} · Homoclave: ${result.homoclave}
              </div>
            </div>`;
        } else {
          rfcResult.innerHTML = `
            <div style="padding:var(--sp-sm) var(--sp-md);background:rgba(239,68,68,0.1);border-radius:var(--radius-md);border:1px solid rgba(239,68,68,0.2)">
              <div style="color:var(--danger);font-weight:600">❌ RFC Inválido</div>
              <div style="margin-top:var(--sp-xs);color:var(--text-secondary)">${result.error}</div>
            </div>`;
        }
      });

      rfcInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnRfc.click();
      });
    }
  }

  // =============================================
  // SETTINGS & API CONFIG PANEL
  // =============================================
  function initSettings() {
    const settings = Store.getSettings();

    const autoReply = document.getElementById('setting-auto-reply');
    const incomeAlert = document.getElementById('setting-income-alert');
    const sound = document.getElementById('setting-sound');

    if (autoReply) { autoReply.checked = settings.autoReply; autoReply.addEventListener('change', () => Store.updateSetting('autoReply', autoReply.checked)); }
    if (incomeAlert) { incomeAlert.checked = settings.incomeAlert; incomeAlert.addEventListener('change', () => Store.updateSetting('incomeAlert', incomeAlert.checked)); }
    if (sound) { sound.checked = settings.sound; sound.addEventListener('change', () => Store.updateSetting('sound', sound.checked)); }

    const btnExport = document.getElementById('btn-export-data');
    if (btnExport) btnExport.addEventListener('click', () => Store.exportJSON());

    const btnReset = document.getElementById('btn-reset-data');
    if (btnReset) btnReset.addEventListener('click', () => {
      if (confirm('¿Resetear todos los datos de demo?')) {
        Store.reset();
        Dashboard.render();
      }
    });

    const btnRefresh = document.getElementById('btn-refresh-feed');
    if (btnRefresh) btnRefresh.addEventListener('click', () => Dashboard.renderFeed());

    // --- API Config ---
    initApiConfig();
  }

  function initApiConfig() {
    // Gemini Key
    const geminiInput = document.getElementById('config-gemini-key');
    const btnGemini = document.getElementById('btn-save-gemini');
    const btnTestGemini = document.getElementById('btn-test-gemini');

    if (geminiInput) {
      const existing = AppConfig.getGeminiKey();
      if (existing) geminiInput.value = existing.slice(0, 8) + '••••••••';
    }

    if (btnGemini && geminiInput) {
      btnGemini.addEventListener('click', () => {
        const val = geminiInput.value.trim();
        if (val && !val.includes('••••')) {
          AppConfig.setGeminiKey(val);
          geminiInput.value = val.slice(0, 8) + '••••••••';
          refreshConfigStatus();
          updateModeBadge();
        }
      });
    }

    if (btnTestGemini) {
      btnTestGemini.addEventListener('click', async () => {
        btnTestGemini.textContent = '⏳';
        const result = await AppConfig.testGemini();
        btnTestGemini.textContent = result.ok ? '✅' : '❌';
        if (result.ok) AppConfig.secureForProduction();
        setTimeout(() => { btnTestGemini.textContent = 'Test'; }, 2000);
      });
    }

    // Supabase Config
    const sbUrl = document.getElementById('config-supabase-url');
    const sbKey = document.getElementById('config-supabase-key');
    const btnSupabase = document.getElementById('btn-save-supabase');
    const btnTestSupa = document.getElementById('btn-test-supabase');

    if (sbUrl) {
      const existing = AppConfig.getSupabaseUrl();
      if (existing) sbUrl.value = existing;
    }
    if (sbKey) {
      const existing = AppConfig.getSupabaseKey();
      if (existing) sbKey.value = existing.slice(0, 12) + '••••••••';
    }

    if (btnSupabase && sbUrl && sbKey) {
      btnSupabase.addEventListener('click', () => {
        const url = sbUrl.value.trim();
        const key = sbKey.value.trim();
        if (url && key && !key.includes('••••')) {
          AppConfig.setSupabaseConfig(url, key);
          sbKey.value = key.slice(0, 12) + '••••••••';
          Store.initSupabase();
          refreshConfigStatus();
        }
      });
    }

    if (btnTestSupa) {
      btnTestSupa.addEventListener('click', async () => {
        btnTestSupa.textContent = '⏳';
        const result = await AppConfig.testSupabase();
        btnTestSupa.textContent = result.ok ? '✅' : '❌';
        if (result.ok) AppConfig.secureForProduction();
        setTimeout(() => { btnTestSupa.textContent = 'Test'; }, 2000);
      });
    }

    // Webhook URL
    const whUrl = document.getElementById('config-webhook-url');
    const btnWebhook = document.getElementById('btn-save-webhook');
    const btnTestWH = document.getElementById('btn-test-webhook');

    if (whUrl) {
      const existing = AppConfig.getWebhookUrl();
      if (existing) whUrl.value = existing;
    }

    if (btnWebhook && whUrl) {
      btnWebhook.addEventListener('click', () => {
        const val = whUrl.value.trim();
        if (val) {
          AppConfig.setWebhookUrl(val);
          refreshConfigStatus();
        }
      });
    }

    if (btnTestWH) {
      btnTestWH.addEventListener('click', async () => {
        btnTestWH.textContent = '⏳';
        const result = await AppConfig.testWebhook();
        btnTestWH.textContent = result.ok ? '✅' : '❌';
        setTimeout(() => { btnTestWH.textContent = 'Test'; }, 2000);
      });
    }

    refreshConfigStatus();
  }

  function refreshConfigStatus() {
    const status = AppConfig.getStatus();

    const dots = {
      gemini: document.getElementById('status-dot-gemini'),
      supabase: document.getElementById('status-dot-supabase'),
      webhook: document.getElementById('status-dot-webhook'),
    };

    for (const [key, dot] of Object.entries(dots)) {
      if (dot) {
        dot.className = `config-status-dot ${status[key] ? 'active' : 'inactive'}`;
      }
    }

    updateModeBadge();
  }

  function updateModeBadge() {
    const mode = AppConfig.getMode();
    const badge = document.getElementById('mode-badge');
    if (badge) {
      badge.innerHTML = mode === 'production'
        ? '<span class="mode-indicator production">🟢 Producción — Gemini AI</span>'
        : '<span class="mode-indicator demo">🟡 Demo — Clasificador Local</span>';
    }

    // Update sidebar footer
    const statusText = document.querySelector('.sidebar-footer .status-badge span:last-child');
    if (statusText) {
      statusText.textContent = mode === 'production' ? 'Gemini AI activo' : 'Modo Demo';
    }
  }

  // =============================================
  // MOBILE MENU
  // =============================================
  function initMobileMenu() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');

    if (window.innerWidth <= 768 && toggle) {
      toggle.style.display = 'flex';
    }

    window.addEventListener('resize', () => {
      if (toggle) toggle.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
    });

    if (toggle && sidebar) {
      toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
      sidebar.addEventListener('click', (e) => {
        if (e.target.closest('.nav-item') && window.innerWidth <= 768) {
          sidebar.classList.remove('open');
        }
      });
    }
  }

  // --- Utility ---
  function escapeHTMLApp(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // =============================================
  // BOOT
  // =============================================
  async function init() {
    console.log('%c🧠 Aliado RESICO v3.0 — Producción', 'color:#10b981;font-size:16px;font-weight:bold');
    console.log('%cGemini 1.5 Flash + Supabase + n8n Ready', 'color:#94a3b8');

    // Load server config if in production (Vercel)
    if (AppConfig.IS_PRODUCTION) {
      await AppConfig.loadServerConfig();
    }

    // Seed demo data if empty
    if (Store.getConversations().length === 0) {
      Store.seedDemoData();
    }

    // Init Supabase if configured
    if (AppConfig.isSupabaseConfigured()) {
      Store.initSupabase();
    }

    initNavigation();
    Dashboard.init();
    Chat.init();
    initDocuments();
    initSettings();
    initMobileMenu();
    updateDateTime();
    setInterval(updateDateTime, 30000);
    updateModeBadge();

    // Run local classifier test
    const testResult = IntentClassifier.runTestSuite();
    console.log(`%c🎯 Precisión del clasificador local: ${testResult.accuracy}%`, 'color:#f59e0b;font-weight:bold');

    // Check e.firma expiry on boot
    const eFirmaStatus = Store.checkEFirmaExpiry();
    if (eFirmaStatus.status !== 'valid' && eFirmaStatus.status !== 'unknown') {
      console.warn(`%c[e.firma] ${eFirmaStatus.message}`, 'color:#ef4444;font-weight:bold');
    }

    // Log system status
    const status = AppConfig.getStatus();
    console.log('%c📋 System Status:', 'color:#3b82f6;font-weight:bold');
    console.log(`   Gemini: ${status.gemini ? '✅' : '❌'}  Supabase: ${status.supabase ? '✅' : '❌'}  Webhook: ${status.webhook ? '✅' : '❌'}  Mode: ${status.mode}  Env: ${status.environment}`);
  }

  return { init, navigateTo };
})();

document.addEventListener('DOMContentLoaded', () => App.init());

if (typeof window !== 'undefined') window.App = App;
