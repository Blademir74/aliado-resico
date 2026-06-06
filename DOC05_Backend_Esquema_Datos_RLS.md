Backend: Infraestructura de Persistencia y Gobernanza de Datos
1. Recapitulación Estratégica del Proyecto
Aliado RESICO ha evolucionado de un prototipo visual a una infraestructura de grado de producción. El backend está diseñado para operar bajo una arquitectura Serverless (Vercel) y Database-as-a-Service (Supabase), eliminando costos fijos y garantizando escalabilidad inmediata para los primeros 100 clientes piloto

El objetivo central: Proveer un cerebro de datos que automatice el monitoreo del límite de los $3,500,000 MXN y gestione el acreditamiento de IVA mediante OCR con un 97% de precisión

2. Esquema de Base de Datos (PostgreSQL en Supabase)
La base de datos está organizada en cuatro tablas maestras diseñadas para la trazabilidad fiscal y el aislamiento multi-tenant mediante Row Level Security (RLS)

A. Tabla: conversations (Cerebro de Intenciones)
Almacena cada interacción clasificada por Gemini 1.5 Flash.
id: UUID (Primary Key).
user_id: UUID (Foreign Key a auth.users). Relaciona los datos con el RFC/WhatsApp del cliente

message_text: TEXT. El mensaje original del usuario (incluye slang como "la chiva" o "timbrar")

intent: VARCHAR. Categoría detectada (CONSULTA_FISCAL, SOLICITUD_FACTURA, etc.)

confidence: FLOAT. Nivel de certeza de la IA (Meta: >85% para evitar "alucinaciones")

is_fiscal_audit_completed: BOOLEAN. Rastrea si ya se validó el Buzón Tributario (Art. 17-K CFF)

B. Tabla: documents (Bóveda de Evidencia IVA)
Gestiona la extracción de datos para el acreditamiento de IVA, indispensable según la RMF vigente

conv_id: UUID (Foreign Key a conversations).
file_url: TEXT. Link cifrado al comprobante (Ticket OXXO, PDF de Gasolina).
extracted_data: JSONB. Contiene: RFC Emisor, Subtotal, IVA desglosado y Folio
1
safety_flag: BOOLEAN. Se activa si la confianza OCR es < 85%, requiriendo "Verificación Humana"

C. Tabla: fiscal_metrics (Monitor Art. 113-E LISR)
La tabla más crítica para la permanencia del contribuyente en el régimen

user_id: UUID (Unique).
cumulative_income: NUMERIC. Ingresos efectivamente cobrados en el año actual

annual_limit: NUMERIC (Default: 3,500,000). El umbral legal innegociable

risk_level: VARCHAR. Estados dinámicos: SEGURO, PREVENTIVO (80%), RIESGO_ALTO (90%), EXPULSIÓN (94%)

3. Capa de Seguridad y Blindaje (RLS)
Para cumplir con la LFPDPPP y evitar la fuga cruzada de datos fiscales entre clientes, se implementan políticas Row Level Security que actúan a nivel de motor de base de datos

-- Habilitar RLS en todas las tablas
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_metrics ENABLE ROW LEVEL SECURITY;

-- Política: El usuario solo puede ver y editar sus PROPIOS datos
CREATE POLICY "user_isolation_policy" ON conversations
    FOR ALL USING (auth.uid() = user_id);

-- Restricción de métricas para evitar fraude
CREATE POLICY "metrics_isolation_policy" ON fiscal_metrics
    FOR SELECT USING (auth.uid() = user_id);
Nota: Se revoca el acceso anon_update para evitar que usuarios no autenticados inyecten ingresos falsos en el monitor
28

4. Lógica de Negocio en el Servidor (Vercel Functions)
El backend no expone secretos. Toda la comunicación con Gemini y Supabase se realiza a través de un Proxy Serverless en Node.js 24

Proxy de IA (/api/gemini-proxy.js): Recibe el texto del frontend, inyecta la GEMINI_API_KEY desde las variables de entorno de Vercel y devuelve la clasificación fiscal

Diferenciador Fiscal: El servidor procesa la distinción entre ISR (tasa fija sobre ingreso bruto) e IVA (gestión obligatoria de gastos para acreditamiento), educando al usuario en cada respuesta

Auditoría de Salud: Si la tabla conversations detecta un usuario nuevo, el backend fuerza una respuesta sobre el Buzón Tributario, citando la multa de hasta $10,260 MXN por inactividad

5. Orquestación y Flujo de Datos (n8n)
El sistema utiliza n8n como el "sistema nervioso" para conectar el Dashboard con WhatsApp Cloud API

Mensajes de Utilidad: Los recordatorios de pago del día 17 y las alertas de vencimiento de e.firma se categorizan como "Utilidad" (~0.17 MXN) para maximizar el ROI del despacho contable

Latencia: El flujo completo (Recepción → Clasificación Gemini → Escritura Supabase → Respuesta) debe ocurrir en menos de 5 segundos para retener al 78% de los prospectos
