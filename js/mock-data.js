/* ════════════════════════════════════════════════
   ALIADO RESICO — Mock Data v6.0
   Datos demo realistas para modo sin sesión
   KPIs no quedan en cero — proyección activa
   ════════════════════════════════════════════════ */
const MockData = (() => {

  // Contribuyente demo: freelancer IT, CDMX, ~40% del límite
  const DEMO_INCOME = 1_420_000; // $1.42M — zona segura con color real
  const DEMO_MES    = new Date().getMonth() + 1; // mes actual

  const DEMO_METRICS = {
    totalProcessed:    47,
    autoResolutionRate: 89,
    avgConfidence:     92,
    avgResponseTime:   2.1,
  };

  const DEMO_CONVERSATIONS = [
    { id:'d1', text:'¿Puedo deducir gasolina en RESICO?',        intent:'CONSULTA_FISCAL',   confidence:.97, time:'10:23', created_at: _ts(0) },
    { id:'d2', text:'Necesito timbrar factura de honorarios',     intent:'SOLICITUD_FACTURA', confidence:.95, time:'09:47', created_at: _ts(1) },
    { id:'d3', text:'Gasté $1,200 en papelería en Costco',        intent:'REGISTRO_GASTO',    confidence:.93, time:'09:12', created_at: _ts(1) },
    { id:'d4', text:'¿Mi buzón tributario debe estar activo?',    intent:'SALUD_FISCAL',      confidence:.99, time:'17:05', created_at: _ts(2) },
    { id:'d5', text:'¿Cuánto ISR pago si gané $45,000 este mes?', intent:'CONSULTA_FISCAL',   confidence:.96, time:'14:30', created_at: _ts(3) },
    { id:'d6', text:'Cobré $85,000 por proyecto de desarrollo',   intent:'REPORTE_PAGO',      confidence:.94, time:'11:00', created_at: _ts(3) },
    { id:'d7', text:'¿Cómo cancelo una factura mal timbrada?',    intent:'SOLICITUD_FACTURA', confidence:.91, time:'16:20', created_at: _ts(5) },
  ];

  function _ts(daysAgo) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString();
  }

  function load(store) {
    if (!store) return;

    // Solo cargar demo si no hay datos reales
    if (store.getConversations().length > 0) return;

    // Cargar conversaciones demo
    DEMO_CONVERSATIONS.forEach(c => {
      store.addConversation(c);
    });

    // Forzar ingresos demo
    store.updateIncome(DEMO_INCOME);

    // Salud fiscal demo
    store.updateSaludFiscal({
      buzonTributarioActivo: true,
      eFirmaVigente: true,
      eFirmaExpiry: '2025-12-15',
    });

    console.log('[Demo] Datos de demostración cargados');
  }

  function getProjection(incomeYTD) {
    const mes = new Date().getMonth() + 1;
    if (mes < 2 || incomeYTD <= 0) return null;
    const proyeccion = Math.round((incomeYTD / mes) * 12);
    return proyeccion;
  }

  return { load, getProjection, DEMO_INCOME, DEMO_METRICS };
})();
if (typeof window !== 'undefined') window.MockData = MockData;
