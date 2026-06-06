/* ════════════════════════════════════════════════
   ALIADO RESICO — Dashboard v7.0 (2026)
   - Alertas escalonadas: 80% (amarillo), 90% (naranja), 94% (rojo)
   - Exención condicional de anual (Art. 113-F LISR 2026)
   - Módulo "Mi Carpeta Fiscal" (e.firma, constancia, opinión)
   ════════════════════════════════════════════════ */
const Dashboard = (() => {
  // Umbrales Art. 113-E LISR 2026
  const L = {
    MAX: 3_500_000,   // Expulsión
    A94: 3_290_000,   // 🔴 Crítico  94%
    A90: 3_150_000,   // 🟠 Alto     90%
    A80: 2_800_000,   // ⚠️ Alerta   80%
  };
  const fmt = n => n.toLocaleString('es-MX');

  // ── SEMÁFORO 2026 ─────────────────────────────────
  function _level(income) {
    const pct = (income / L.MAX) * 100;
    if (income >= L.MAX) {
      return {
        cls:'expelled', pct:100, badge:'❌ EXPULSADO',
        msg:`<strong>LÍMITE REBASADO — $${fmt(income)} MXN.</strong> Expulsión automática al Régimen General (Art. 113-E, fracc. III LISR 2026). Tu ISR sube hasta 35%.`,
        ref:'Art. 113-E LISR 2026',
      };
    }
    if (income >= L.A94) {
      return {
        cls:'critical', pct, badge:`🔴 RIESGO CRÍTICO ${pct.toFixed(1)}%`,
        msg:`<strong>ALERTA ROJA — $${fmt(income)} MXN (${pct.toFixed(1)}% del límite).</strong> Margen restante: $${fmt(L.MAX-income)} MXN. ¡Riesgo inminente de expulsión! Suspende facturación adicional este ejercicio.`,
        ref:'Art. 113-E LISR 2026',
      };
    }
    if (income >= L.A90) {
      return {
        cls:'high', pct, badge:`🟠 RIESGO ALTO ${pct.toFixed(1)}%`,
        msg:`<strong>ALERTA NARANJA — $${fmt(income)} MXN (${pct.toFixed(1)}% del límite).</strong> Margen: $${fmt(L.MAX-income)} MXN. Revisa tu proyección anual con tu contador.`,
        ref:'Art. 113-E LISR 2026',
      };
    }
    if (income >= L.A80) {
      return {
        cls:'warning', pct, badge:`⚠️ PREVENCIÓN ${pct.toFixed(1)}%`,
        msg:`<strong>ALERTA AMARILLA — $${fmt(income)} MXN (${pct.toFixed(1)}% del límite).</strong> Quedan $${fmt(L.MAX-income)} MXN de margen anual. Monitorea tus ingresos mensualmente.`,
        ref:'Art. 113-E LISR 2026',
      };
    }
    return {
      cls:'safe', pct, badge:'✅ SEGURO',
      msg:`Ingresos dentro del límite RESICO. Margen disponible: <strong>$${fmt(L.MAX-income)} MXN</strong>.`,
      ref:'Art. 113-E LISR 2026',
    };
  }

  // ── RENDER INCOME MONITOR ─────────────────────────
  function renderIncomeMonitor(income = 0) {
    const fill  = document.getElementById('income-progress-fill');
    const badge = document.getElementById('income-alert-badge');
    const msg   = document.getElementById('income-alert-message');
    const curr  = document.getElementById('income-current');
    const rem   = document.getElementById('income-remaining');
    const proj  = document.getElementById('projection-val');
    if (!fill) return;

    const a = _level(income);
    fill.style.width  = Math.min(a.pct, 100) + '%';
    fill.className    = `progress-fill ${a.cls}`;
    fill.setAttribute('aria-valuenow', Math.round(a.pct));

    if (badge) { badge.className = `alert-badge ${a.cls}`; badge.textContent = a.badge; }
    if (curr)  curr.textContent  = `$${fmt(income)} MXN`;
    if (rem)   { rem.textContent = `$${fmt(Math.max(0, L.MAX-income))} MXN`; rem.className = `metric-val ${a.cls==='safe'?'safe':a.cls==='warning'?'warning':''}`.trim(); }
    if (msg)   { msg.className = `income-alert ${a.cls}`; msg.innerHTML = a.msg + `<span class="alert-ref">${a.ref}</span>`; }

    // Proyección anual (basada en mes actual)
    if (proj && income > 0) {
      const mes = new Date().getMonth() + 1;
      if (mes >= 2) {
        const proyeccion = Math.round((income / mes) * 12);
        const pCls = proyeccion >= L.MAX ? 'danger' : proyeccion >= L.A80 ? 'warning' : 'safe';
        proj.textContent  = `$${fmt(proyeccion)} MXN/año estimado`;
        proj.className    = `projection-val ${pCls}`;
      } else {
        proj.textContent = 'Disponible desde febrero';
        proj.className   = 'projection-val safe';
      }
    } else if (proj) {
      proj.textContent = 'Captura ingresos para proyectar';
      proj.className   = 'projection-val safe';
    }
  }

  // ── SALUD FISCAL (Buzón, e.firma) ────────────────
  function renderHealth(buzon, efirma) {
    const bEl = document.getElementById('buzon-status');
    const eEl = document.getElementById('efirma-status');
    const dEl = document.getElementById('declaraciones-status');
    const box = document.getElementById('health-alert');
    const mEl = document.getElementById('health-alert-msg');
    const rEl = document.getElementById('health-alert-ref');

    if (bEl) {
      bEl.textContent = buzon ? '✅ Activo' : '❌ Inactivo';
      bEl.className = `status-pill ${buzon ? 'ok' : 'error'}`;
    }
    if (eEl) {
      eEl.textContent = efirma ? '✅ Vigente' : '⚠️ Revisar';
      eEl.className = `status-pill ${efirma ? 'ok' : 'warning'}`;
    }
    if (dEl) {
      dEl.textContent = '✅ Al corriente';
      dEl.className = 'status-pill ok';
    }

    if (!buzon && box) {
      box.classList.remove('hidden');
      if (mEl) mEl.innerHTML =
        '⚠️ <strong>Atención: Multa de $10,260 MXN</strong> por Buzón Tributario inactivo (Art. 17-K CFF). ' +
        'En caso de reincidencia la multa se duplica (Art. 86-C CFF). ' +
        'Activa tu buzón en <strong>sat.gob.mx</strong> hoy mismo.';
      if (rEl) rEl.textContent = 'Art. 17-K CFF — Obligación de medios electrónicos | Art. 86-C CFF — Reincidencia';
    } else if (box) {
      box.classList.add('hidden');
    }
  }

  // ── MÓDULO "MI CARPETA FISCAL" ───────────────────
  // Actualiza la UI con los datos de e.firma, constancia, opinión
  function renderCarpetaFiscal(data) {
    const vigenciaEl = document.getElementById('efirma-vigencia');
   // Dentro de renderCarpetaFiscal
if (vigenciaEl && data.efirmaExpiry) {
  const today = new Date();
  const expiry = new Date(data.efirmaExpiry);
  const daysLeft = Math.ceil((expiry - today) / (1000 * 3600 * 24));
  let alertClass = '', alertMsg = '';
  if (daysLeft <= 30) {   // Alerta roja según solicitud
    alertClass = 'error';
    alertMsg = `🔴 **URGENTE**: Tu e.firma vence en ${daysLeft} días. Art. 17-D CFF: Sin e.firma vigente no podrás facturar ni declarar. Renueva ya en el SAT.`;
  } else if (daysLeft <= 90) {
    alertClass = 'warning';
    alertMsg = `⚠️ Tu e.firma vence en ${daysLeft} días. Programa su renovación.`;
  } else {
    alertClass = 'ok';
    alertMsg = `✅ Vigente hasta ${expiry.toLocaleDateString('es-MX')}`;
  }
  vigenciaEl.textContent = alertMsg;
  vigenciaEl.className = `status-pill ${alertClass}`;
}
    const constanciaEl = document.getElementById('constancia-status');
    if (constanciaEl && data.constanciaStatus) {
      constanciaEl.textContent = data.constanciaStatus === 'active' ? '✅ Vigente' : '❌ No disponible';
      constanciaEl.className = `status-pill ${data.constanciaStatus === 'active' ? 'ok' : 'error'}`;
    }
    const opinionEl = document.getElementById('opinion-status');
    if (opinionEl && data.opinionStatus) {
      opinionEl.textContent = data.opinionStatus === 'positive' ? '✅ Positiva' : (data.opinionStatus === 'negative' ? '❌ Negativa' : '⚠️ Por definir');
      opinionEl.className = `status-pill ${data.opinionStatus === 'positive' ? 'ok' : 'error'}`;
    }
  }

  // ── KPIs ─────────────────────────────────────
  function renderKPIs(m = {}) {
    const s = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    s('kpi-total',         m.totalProcessed      || 0);
    s('kpi-auto-rate',    (m.autoResolutionRate   || 0) + '%');
    s('kpi-confidence',   (m.avgConfidence        || 0) + '%');
    s('kpi-response-time',(m.avgResponseTime      || 2.3).toFixed(1) + 's');
  }

  // ── FEED ─────────────────────────────────────
  function renderFeed(items = []) {
    const list = document.getElementById('feed-list');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<p class="feed-empty">Sin actividad. Envía una consulta al Asistente IA.</p>';
      return;
    }
    const CFG = window.CATEGORY_CONFIG || {};
    list.innerHTML = items.map(c => {
      const cat = CFG[c.intent] || { icon:'💬', label: c.intent || 'General' };
      const ts  = c.created_at
        ? new Date(c.created_at).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})
        : (c.time || '');
      const txt = (c.text||'').slice(0,90) + ((c.text?.length||0)>90?'…':'');
      return `<div class="feed-item">
        <span class="feed-icon">${cat.icon}</span>
        <div class="feed-body">
          <span class="feed-text">${escapeHtml(txt)}</span>
          <span class="feed-meta">${cat.label} · ${Math.round((c.confidence||0)*100)}% · ${ts}</span>
        </div>
      </div>`;
    }).join('');
  }
  function escapeHtml(str) { if(!str)return ''; return str.replace(/[&<>]/g, function(m){ if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }

  // ── SYNC CON SUPABASE ─────────────────────────
  async function syncAndRender() {
    if (window.Store) {
      renderKPIs(Store.getMetrics());
      renderIncomeMonitor(Store.getState().incomeYTD || 0);
      const sf = Store.getSaludFiscal();
      renderHealth(sf.buzonTributarioActivo !== false, sf.eFirmaVigente !== false);
      renderFeed(Store.getConversations().slice(0,10));
      // Cargar datos de carpeta fiscal desde Store (si existen)
      const carpeta = Store.getCarpetaFiscal ? Store.getCarpetaFiscal() : { efirmaExpiry: null, constanciaStatus: null, opinionStatus: null };
      renderCarpetaFiscal(carpeta);
    }
    const client = window.APP_STATE?.supabase;
    if (!client) return;
    try {
      const { data: auth } = await client.auth.getUser();
      if (!auth?.user?.id) return;
      const uid = auth.user.id;
      const [metRes, convsRes] = await Promise.all([
        client.from('fiscal_metrics').select('income_ytd,total_processed,avg_confidence').eq('user_id', uid).maybeSingle(),
        client.from('conversations').select('id,text,intent,confidence,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(10),
      ]);
      if (metRes.data) {
        renderIncomeMonitor(Number(metRes.data.income_ytd) || 0);
        renderKPIs({ totalProcessed: Number(metRes.data.total_processed) || 0, avgConfidence: Math.round((Number(metRes.data.avg_confidence) || 0)*100), autoResolutionRate:0, avgResponseTime:2.3 });
      }
      if (convsRes.data) renderFeed(convsRes.data);
    } catch(err) { console.warn('[Dashboard] sync error:', err.message); }
  }

  // ========== DENTRO DE Dashboard.init() o en una función aparte ==========
async function checkAndShowOnboarding() {
  if (!window.AuthManager) return;
  const isFirst = await AuthManager.isFirstLogin();
  if (!isFirst) return;

  // Crear modal si no existe
  let modal = document.getElementById('onboarding-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'onboarding-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-card glass">
        <h2>📋 Configuración Fiscal 2026</h2>
        <p>Completa estos datos para que el monitor de ingresos (Art. 113-E LISR) sea preciso.</p>
        <label>RFC (con homoclave)</label>
        <input type="text" id="onb-rfc" placeholder="Ej: COME850101XXX" maxlength="13" style="text-transform:uppercase">
        <label>Ingresos acumulados en el año (MXN)</label>
        <input type="number" id="onb-income" placeholder="0" step="1000">
        <label>¿Tu e.firma está vigente?</label>
        <select id="onb-efirma">
          <option value="true">Sí, vigente</option>
          <option value="false">No, necesita renovación</option>
        </select>
        <div class="modal-actions">
          <button id="onb-submit" class="btn-primary">Guardar y continuar</button>
        </div>
        <small>Los datos se almacenan de forma segura y solo los usa el sistema para tus alertas fiscales.</small>
      </div>
    `;
    document.body.appendChild(modal);
    // Estilos básicos (puedes agregarlos a styles.css)
    const style = document.createElement('style');
    style.textContent = `
      .modal-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); display:flex; align-items:center; justify-content:center; z-index:10000; backdrop-filter:blur(8px); }
      .modal-card { max-width:450px; width:90%; padding:1.5rem; border-radius:20px; background:var(--bg-card); border:1px solid var(--glass-border); }
      .modal-card input, .modal-card select { width:100%; padding:0.6rem; margin:0.5rem 0 1rem; background:var(--bg-input); border:1px solid rgba(241,245,249,.1); border-radius:12px; color:var(--text-primary); }
      .modal-actions { display:flex; justify-content:flex-end; margin-top:1rem; }
    `;
    document.head.appendChild(style);
  }

  modal.style.display = 'flex';
  const submitBtn = document.getElementById('onb-submit');
  const incomeInput = document.getElementById('onb-income');
  const rfcInput = document.getElementById('onb-rfc');
  const efirmaSelect = document.getElementById('onb-efirma');

  submitBtn.onclick = async () => {
    const rfc = rfcInput.value.trim().toUpperCase();
    const incomeYTD = parseFloat(incomeInput.value) || 0;
    const efirmaVigente = efirmaSelect.value === 'true';

    // Validación básica RFC
    if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
      alert('RFC no válido. Debe tener 12 o 13 caracteres.');
      return;
    }

    // Guardar en Supabase (fiscal_metrics)
    try {
      await AuthManager.upsertFiscalMetrics({ incomeYTD, totalProcessed: 0, avgConfidence: 0 });
      // Guardar RFC en user_metadata (opcional)
      const supabase = window.APP_STATE.supabase;
      if (supabase && rfc) {
        await supabase.auth.updateUser({ data: { rfc, efirma_vigente: efirmaVigente } });
      }
      AuthManager.markOnboardingDone();
      modal.style.display = 'none';
      // Refrescar dashboard
      if (window.Dashboard) await Dashboard.syncAndRender();
      // Mostrar mensaje de bienvenida
      alert('✅ Configuración guardada. Ahora el monitor de ingresos reflejará tu situación fiscal.');
    } catch (err) {
      console.error('Onboarding error:', err);
      alert('❌ Error al guardar. Intenta de nuevo.');
    }
  };
}
  
  function init() {
    renderIncomeMonitor(0);
    renderHealth(true, true);
    renderCarpetaFiscal({ efirmaExpiry: null, constanciaStatus: null, opinionStatus: null });
    if (window.Store) {
      Store.on('income:updated',      v  => renderIncomeMonitor(v));
      Store.on('metrics:updated',     m  => renderKPIs(m));
      Store.on('saludFiscal:updated', sf => renderHealth(sf.buzonTributarioActivo, sf.eFirmaVigente));
      Store.on('conversation:added',  () => renderFeed(Store.getConversations().slice(0,10)));
      Store.on('carpetaFiscal:updated', data => renderCarpetaFiscal(data));
    }
  }

  return { init, syncAndRender, renderIncomeMonitor, renderHealth, renderCarpetaFiscal, LIMITS: L };
})();
if (typeof window !== 'undefined') window.Dashboard = Dashboard;