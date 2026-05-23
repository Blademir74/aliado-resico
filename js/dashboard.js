/* ============================================
ALIADO RESICO — Dashboard Renderer v2.3
Thresholds Legales + Supabase RLS Sync
============================================ */
const Dashboard = (() => {
  const LIMITS = { MAX: 3_500_000, A80: 2_800_000, A90: 3_150_000, A94: 3_300_000 };
  
  function getAlertLevel(income) {
    if (income >= LIMITS.MAX) return { level:'expelled', color:'#7f1d1d', icon:'❌', msg:'LÍMITE REBASADO. Expulsión automática a Régimen General (Art. 113-E LISR).' };
    if (income >= LIMITS.A94) return { level:'critical', color:'#dc2626', icon:'🔴', msg:'ALERTA CRÍTICA (94%). Riesgo inminente de expulsión.' };
    if (income >= LIMITS.A90) return { level:'high', color:'#f97316', icon:'🔶', msg:'RIESGO EXPULSIÓN (90%). Tasas subirán hasta 35% si rebasa $3.5M.' };
    if (income >= LIMITS.A80) return { level:'warning', color:'#eab308', icon:'⚠️', msg:'ALERTA TEMPRANA (80%). Revise proyección de ingresos restantes.' };
    return { level:'safe', color:'#22c55e', icon:'✅', msg:'Ingresos dentro del límite seguro RESICO.' };
  }

  function renderIncomeAlert(income) {
    const el = document.getElementById('income-alert-container');
    if (!el) return;
    const pct = Math.min((income / LIMITS.MAX) * 100, 100);
    const alert = getAlertLevel(income);
    
    el.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:1.5rem;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem">
          <h3 style="margin:0">📊 Monitor de Ingresos RESICO</h3>
          <span style="background:${alert.color}20;color:${alert.color};padding:0.2rem 0.6rem;border-radius:20px;font-size:0.8rem;font-weight:bold">${alert.icon} ${alert.level.toUpperCase()}</span>
        </div>
        <div style="background:#f1f5f9;height:12px;border-radius:6px;overflow:hidden;margin:0.5rem 0">
          <div style="width:${pct}%;background:${alert.color};height:100%;transition:width 0.3s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#64748b">
          <span>$${income.toLocaleString('es-MX')}</span>
          <span>$${LIMITS.MAX.toLocaleString('es-MX')}</span>
        </div>
        <p style="margin:0.5rem 0 0;color:${alert.color};font-size:0.9rem;font-weight:500">${alert.msg}</p>
        <p style="margin:0.2rem 0 0;font-size:0.75rem;color:#94a3b8">📜 Referencia: Art. 113-E, fracción III, LISR 2024</p>
      </div>
    `;
  }

  async function syncAndRender() {
    if (!window.supabase) { console.warn('[Dashboard] Supabase no inicializado'); return; }
    const { data: { user } } = await window.supabase.auth.getUser();
    if (!user) return;

    // Sync con Supabase RLS
    const { data: metrics } = await window.supabase
      .from('fiscal_metrics')
      .select('income_ytd')
      .eq('user_id', user.id)
      .single();

    const income = metrics?.income_ytd || 0;
    renderIncomeAlert(income);
    // Aquí puedes renderizar KPIs adicionales usando `income`
  }

  function init() {
    window.addEventListener('load', syncAndRender);
    if (window.Store) {
      Store.on('metrics:updated', syncAndRender);
      Store.on('conversation:added', syncAndRender);
    }
  }

  return { init, renderIncomeAlert, syncAndRender, LIMITS };
})();
if (typeof window !== 'undefined') window.Dashboard = Dashboard;