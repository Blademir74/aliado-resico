/* ============================================
   ALIADO RESICO — Mock Data
   Datos de demostración realistas MX
   ============================================ */

const MOCK_MESSAGES = [
  // Bloque 1: Consultas y Slang
  { text: "¿Cuánto es lo máximo que puedo ganar en RESICO sin que me saquen?", sender: "Juan Pérez", time: "09:15", expected: "CONSULTA_FISCAL" },
  { text: "La chiva me mandó un correo al buzón, ¿qué hago?", sender: "María García", time: "09:22", expected: "CONSULTA_FISCAL" },
  { text: "¿Si gano 3 millones al año todavía entro en este régimen?", sender: "Carlos Ruiz", time: "09:30", expected: "CONSULTA_FISCAL" },
  { text: "Oye, ¿tengo que declarar cada mes o es cada año?", sender: "Ana Torres", time: "09:45", expected: "CONSULTA_FISCAL" },
  { text: "El fisco me está buscando por una declaración de 2023.", sender: "Pedro Gómez", time: "10:01", expected: "CONSULTA_FISCAL" },
  { text: "¿Qué pasa si me paso del límite de los 3.5 millones?", sender: "Roberto Díaz", time: "10:15", expected: "CONSULTA_FISCAL" },
  
  // Bloque 2: Facturación y Timbrado
  { text: "Quiero timbrar una factura de 10 mil pesos más IVA.", sender: "Laura Sánchez", time: "10:28", expected: "SOLICITUD_FACTURA" },
  { text: "Hazme un CFDI para un cliente que me pagó ayer.", sender: "Miguel Flores", time: "10:40", expected: "SOLICITUD_FACTURA" },
  { text: "¿Me puedes generar una factura para el RFC: ABC123456T1?", sender: "Diana Morales", time: "10:55", expected: "SOLICITUD_FACTURA" },
  { text: "Necesito emitir un recibo de honorarios urgente.", sender: "Jorge Hernández", time: "11:10", expected: "SOLICITUD_FACTURA" },
  { text: "Oye, mi cliente quiere factura 4.0, ¿ya la manejas?", sender: "Sofía Castillo", time: "11:22", expected: "SOLICITUD_FACTURA" },
  { text: "Quiero facturar una venta, pero no tengo los datos completos.", sender: "Fernando López", time: "11:35", expected: "SOLICITUD_FACTURA" },
  
  // Bloque 3: Gastos e IVA
  { text: "Te mando este ticket de la gasolina para deducir el IVA.", sender: "Claudia Reyes", time: "11:48", expected: "REGISTRO_GASTO" },
  { text: "Gasté 500 pesos en papelería, ¿esto cuenta para mis gastos?", sender: "Arturo Vega", time: "12:00", expected: "REGISTRO_GASTO" },
  { text: "Tengo una nota de venta de una comida, ¿me sirve?", sender: "Gabriela Medina", time: "12:15", expected: "REGISTRO_GASTO" },
  { text: "Acabo de comprar una laptop para la oficina, aquí está el PDF.", sender: "Ricardo Navarro", time: "12:30", expected: "REGISTRO_GASTO" },
  { text: "¿Si estoy en RESICO puedo deducir mi renta?", sender: "Patricia Ortega", time: "12:42", expected: "CONSULTA_FISCAL" },
  { text: "Pagué la luz del local, te mando la foto.", sender: "Eduardo Ramírez", time: "13:00", expected: "REGISTRO_GASTO" },
  
  // Bloque 4: Pagos y Cobranza
  { text: "Ya te mandé el varo por transferencia, aquí está el comprobante.", sender: "Lucía Mendoza", time: "13:15", expected: "REPORTE_PAGO" },
  { text: "Fui al OXXO a depositar, te paso la foto del ticket.", sender: "Andrés Jiménez", time: "13:28", expected: "REPORTE_PAGO" },
  { text: "Liquidado el saldo de este mes, confírmame porfa.", sender: "Mónica Guerrero", time: "13:40", expected: "REPORTE_PAGO" },
  { text: "Te mando la captura de pantalla de mi app del banco.", sender: "Raúl Castro", time: "13:55", expected: "REPORTE_PAGO" },
  { text: "¿A qué cuenta te deposito lo de mis impuestos?", sender: "Isabel Vargas", time: "14:05", expected: "REPORTE_PAGO" },
  { text: "Ya quedó el pago, valídame el folio por favor.", sender: "Francisco Luna", time: "14:18", expected: "REPORTE_PAGO" },
  
  // Bloque 5: Casos de Borde y Auditoría
  { text: "Hola, buenas tardes, ¿quién eres?", sender: "Verónica Ríos", time: "14:30", expected: "OTROS" },
  { text: "No tengo mi e.firma, ¿todavía puedo estar en RESICO?", sender: "Alejandro Soto", time: "14:45", expected: "SALUD_FISCAL" },
  { text: "Gracias por la ayuda, me salvaste de la multa.", sender: "Teresa Aguilar", time: "15:00", expected: "OTROS" },
  { text: "Adiós, hablamos luego.", sender: "Héctor Domínguez", time: "15:12", expected: "OTROS" },
  { text: "Quiero saber si mi Buzón Tributario está bien.", sender: "Carmen Peña", time: "15:25", expected: "CONSULTA_FISCAL" },
  { text: "¿Qué servicios ofreces para mi negocio?", sender: "Óscar Silva", time: "15:38", expected: "OTROS" }
];

const MOCK_CLIENTS = [
  { name: "Juan Pérez López", rfc: "PELJ850315KT2", regime: "RESICO", income_ytd: 1250000 },
  { name: "María García Hernández", rfc: "GAHM900420PL8", regime: "RESICO", income_ytd: 890000 },
  { name: "Carlos Ruiz Martínez", rfc: "RUMC780612QS5", regime: "RESICO", income_ytd: 2100000 },
  { name: "Ana Torres Vega", rfc: "TOVA880915HN3", regime: "RESICO", income_ytd: 450000 },
  { name: "Distribuidora López SA de CV", rfc: "DLO120301AB9", regime: "General", income_ytd: 8500000 },
];

const CATEGORY_CONFIG = {
  CONSULTA_FISCAL: { label: "Consulta Fiscal", color: "#3b82f6", icon: "📘", cssClass: "consulta" },
  SOLICITUD_FACTURA: { label: "Solicitud Factura", color: "#8b5cf6", icon: "📑", cssClass: "factura" },
  REGISTRO_GASTO: { label: "Registro Gasto", color: "#f59e0b", icon: "🧾", cssClass: "gasto" },
  REPORTE_PAGO: { label: "Reporte Pago", color: "#10b981", icon: "💳", cssClass: "pago" },
  OTROS: { label: "Otros", color: "#64748b", icon: "💬", cssClass: "otros" },
};

const ISR_RESICO_TABLE = [
  { min: 0, max: 25000, rate: 1.00 },
  { min: 25000.01, max: 50000, rate: 1.10 },
  { min: 50000.01, max: 83333.33, rate: 1.50 },
  { min: 83333.34, max: 208333.33, rate: 2.00 },
  { min: 208333.34, max: 3500000, rate: 2.50 },
];

const RESICO_INCOME_LIMIT = 3500000;

if (typeof window !== 'undefined') {
  window.MOCK_MESSAGES = MOCK_MESSAGES;
  window.MOCK_CLIENTS = MOCK_CLIENTS;
  window.CATEGORY_CONFIG = CATEGORY_CONFIG;
  window.ISR_RESICO_TABLE = ISR_RESICO_TABLE;
  window.RESICO_INCOME_LIMIT = RESICO_INCOME_LIMIT;
}
