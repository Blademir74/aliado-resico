// Script to update n8n_workflow.json with the new v2.5 prompt
// Run: node update-n8n-workflow.js

const fs = require('fs');
const path = require('path');

const workflowPath = path.join(__dirname, 'n8n_workflow.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// Find the "Construir Payload Gemini" node
const buildNode = workflow.nodes.find(n => n.id === 'build-payload');
if (!buildNode) {
  console.error('ERROR: No se encontró el nodo "build-payload"');
  process.exit(1);
}

// New v2.5 jsCode with Expert Fiscal Mexicano prompt
buildNode.parameters.jsCode = `const msg = $input.first().json;
const text = msg.message?.text || msg.message?.caption || '[IMAGEN ADJUNTA]';
const safeText = text.replace(/"/g, "'").replace(/\\n/g, ' ').replace(/\\\\/g, '');

// === SLANG PREPROCESSOR v2.5 ===
let processed = safeText.toLowerCase();
const slangMap = {
  'la chiva': 'el SAT', 'el chivo': 'el SAT', 'hacienda': 'el SAT', 'el fisco': 'el SAT',
  'timbrar': 'emitir CFDI', 'sellar': 'emitir CFDI',
  'lana': 'dinero', 'varo': 'dinero', 'baro': 'dinero', 'fierro': 'dinero', 'feria': 'dinero', 'billete': 'dinero',
  'chambear': 'trabajar', 'jalar': 'trabajar', 'chamba': 'trabajo',
  'melones': 'millones de pesos', 'melon': 'un millon de pesos', 'mdp': 'millones de pesos',
  'recibito': 'ticket', 'tirilla': 'ticket', 'papelito': 'comprobante',
  'ya le puse': 'ya pague', 'le avente': 'transferi'
};
let slangDetected = [];
for (const [slang, formal] of Object.entries(slangMap)) {
  if (processed.includes(slang)) {
    slangDetected.push(slang + ' = ' + formal);
    processed = processed.replace(new RegExp(slang, 'gi'), formal);
  }
}

const prompt = \`IDENTIDAD: Eres 'Lic. Fiscal IA', Experto Fiscal Mexicano con 15 anios en RESICO. Dominas LISR (Art. 113-E), CFF (Art. 17-D, 17-K) y jerga popular mexicana.

FORMATO: Responde SOLO con JSON puro. Cero texto extra. Cero markdown.

CATEGORIAS (elige UNA):
1. CONSULTA_FISCAL - Impuestos, regimen, tasas, SAT, declaraciones, e.firma, buzon tributario, constancia
2. SOLICITUD_FACTURA - Emitir/cancelar CFDI 4.0, timbrado, complementos, RFC, folio
3. REGISTRO_GASTO - Gastos, tickets, recibos, acreditamiento IVA, facturas de proveedores
4. REPORTE_PAGO - Pagos, transferencias SPEI, depositos, comprobantes bancarios, OXXO
5. SALUD_FISCAL - Buzon tributario, e.firma, constancia, opinion de cumplimiento
6. OTROS - Saludos, despedidas, preguntas no fiscales

REGLAS DE PRIORIDAD:
1. Montos + contexto fiscal -> CONSULTA_FISCAL
2. Timbrar/sellar/CFDI/factura/RFC -> SOLICITUD_FACTURA
3. Ticket/gasto/recibo/compre/gaste -> REGISTRO_GASTO
4. Pague/deposite/transferencia/SPEI/OXXO -> REPORTE_PAGO
5. Buzon/e.firma/constancia -> SALUD_FISCAL
6. Saludo/despedida/no fiscal -> OTROS

JERGA MEXICANA:
- la chiva/el chivo/hacienda/el fisco = SAT
- timbrar/sellar = emitir CFDI
- lana/varo/baro/fierro/feria/billete = dinero
- chambear/jalar/chamba = trabajar
- melon/melones/MDP = millon/millones de pesos
- recibito/tirilla/papelito = ticket/comprobante
- ya le puse/le avente = ya pague/transferi
- meter gasto/aventar gasto = registrar gasto

Cuando detectes jerga, clasifica segun el termino formal. La confianza NO baja de 0.85 si la intencion es clara.

CONTEXTO RESICO (Art. 113-E LISR):
- ISR: sobre INGRESOS BRUTOS (1%-2.5%). SIN deducciones para ISR
- IVA: SI permite acreditamiento con facturas de gastos
- Limite anual: $3,500,000 MXN. Superarlo = expulsion automatica
- e.firma OBLIGATORIA y VIGENTE (Art. 17-D CFF)
- Buzon Tributario ACTIVO. Multas $3,420 a $10,260 MXN si inactivo
- Declaraciones mensuales: dia 17 del mes siguiente

CALIBRACION DE CONFIANZA:
>= 0.95: Terminos fiscales explicitos
0.88-0.94: Jerga/slang con intencion clara
0.80-0.87: Informal con contexto fiscal implicito
0.65-0.79: Ambiguo
< 0.65: Sin contexto fiscal

AUDITORIA AUTOMATICA: Si detectas e.firma vencida, buzon inactivo, ingresos > $3.5M o declaracion omitida, incluye alerta en salud_fiscal_alerta.

Campo explanation: Responde DIRECTO al usuario como su contador de confianza. Incluye datos concretos.

\${slangDetected.length > 0 ? 'JERGA DETECTADA: ' + slangDetected.join(', ') + '\\n\\n' : ''}Formato OBLIGATORIO:
{"intent":"CATEGORIA","confidence":0.95,"explanation":"respuesta directa","resico_context":"contexto o null","salud_fiscal_alerta":"alerta o null"}

Mensaje a clasificar: "\${safeText}"\`;

const payload = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { temperature: 0.1, maxOutputTokens: 400, responseMimeType: 'application/json' }
};

return [{
  json: {
    payload,
    telegram_chat_id: msg.message?.chat?.id?.toString() || 'unknown',
    telegram_message_text: text,
    slang_detected: slangDetected
  }
}];`;

// Also update the model name in the Gemini HTTP Request node to use gemini-1.5-flash
const geminiNode = workflow.nodes.find(n => n.id === 'gemini-classifier');
if (geminiNode) {
  // Update to use gemini-1.5-flash (production model)
  geminiNode.parameters.url = geminiNode.parameters.url.replace('gemini-2.5-flash', 'gemini-1.5-flash');
  geminiNode.name = 'Cerebro Gemini 1.5 Flash';
  console.log('✅ Gemini node updated to 1.5 Flash');
}

// Update workflow name
workflow.name = 'Aliado RESICO - Workflow v2.5 Production';

// Write back
fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2), 'utf8');
console.log('✅ n8n_workflow.json actualizado a v2.5');
console.log('✅ Prompt de Experto Fiscal Mexicano instalado');
console.log('✅ Slang preprocessor v2.5 integrado');
console.log('');
console.log('IMPORTANTE: Importa el workflow actualizado en n8n y:');
console.log('1. Reemplaza "telegram-cred-id" con tu credencial real de Telegram');
console.log('2. Activa el workflow (toggle ON)');
console.log('3. Usa la URL de PRODUCCION del webhook (NO la de Test)');
