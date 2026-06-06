TRD: Aliado RESICO - Documento de Definiciones Técnicas v2.6
1. Arquitectura del Sistema (Stack de Producción)
El sistema opera bajo una arquitectura de Infraestructura de Confianza Fiscal distribuida, diseñada para garantizar disponibilidad 24/7 y costo operativo cercano a cero en fases iniciales

Entorno de Ejecución: Node.js 24.x desplegado en Vercel mediante funciones serverless independientes [User History, 527].
Cerebro de IA: Google Gemini 1.5 Flash (Modelo Multimodal) para procesamiento de lenguaje natural (NLP) y visión artificial (OCR)

Persistencia y Autenticación: Supabase (PostgreSQL) con motor de tiempo real (Realtime) y aislamiento de datos a nivel de fila (RLS)

Orquestación Transaccional: n8n autohospedado como puente entre WhatsApp Cloud API y el núcleo del sistema

2. Glosario de Definiciones Técnicas y Fiscales
A. Capa de Inteligencia Artificial (NLP & Vision)
Intent Classifier (Clasificador de Intenciones): Motor lógico que decodifica el slang fiscal mexicano (ej. "la chiva", "timbrar", "varo") para categorizar consultas en: CONSULTA_FISCAL, SOLICITUD_FACTURA, REGISTRO_GASTO, REPORTE_PAGO y OTROS

OCR Multimodal (Gemini Vision): Proceso de extracción de datos de comprobantes fiscales (PDF/JPG/PNG) con una precisión del 97%

El sistema extrae: RFC emisor/receptor, subtotal, IVA desglosado y número de autorización

Safety Flag (Verificación Humana): Umbral de confianza técnica configurado al 85% (0.85)

Si la IA tiene una certeza menor al procesar un ticket, el registro se marca para auditoría manual del contador, evitando errores ante el SAT

B. Capa de Datos y Seguridad (Búnker Técnico)
Row Level Security (RLS): Política de seguridad innegociable en la base de datos que aplica el filtro auth.uid() = user_id

Garantiza que los datos fiscales de un contribuyente sean invisibles para otros, cumpliendo con la LFPDPPP

Proxy Serverless (/api/gemini-proxy): Intermediario en el servidor que oculta las API Keys del cliente [User History, 530]. Ninguna credencial (GEMINI_API_KEY, SUPABASE_ANON_KEY) reside en el frontend

Auth Guard: Overlay de autenticación que bloquea la renderización del dashboard hasta que existe un token de sesión válido emitido por Supabase Auth

C. Capa de Negocio RESICO (LISR & CFF)
Monitor de Ingresos (Art. 113-E LISR): Algoritmo de rastreo de ingresos efectivamente cobrados contra el límite de $3,500,000 MXN anuales

Diferenciador Fiscal ISR/IVA: Lógica de negocio que educa al usuario: el ISR se paga sobre ingresos brutos (sin deducciones, tasas 1% a 2.5%), mientras que el IVA requiere gestión de gastos indispensable para su acreditamiento

Auditoría de Salud (Art. 17-K CFF): Módulo de validación proactiva que verifica la vigencia de la e.firma y la activación del Buzón Tributario, alertando sobre la multa específica de $10,260 MXN

3. Esquema de Datos (Diccionario de Tablas)
Tabla
Propósito Técnico
Relación Fiscal
conversations
Historial de interacciones clasificadas.
Evidencia de consultas y asesoría recibida.
documents
Almacenamiento de metadatos OCR y URLs de archivos.
Repositorio de gastos para acreditamiento de IVA.
fiscal_metrics
Acumulados de ingresos y proyecciones de cierre.
Control del límite de permanencia (Art. 113-E LISR).
audit_log
Registro de cambios en el perfil fiscal.
Trazabilidad para la defensa del contribuyente.

4. Protocolos de Comunicación y Costos
Webhook Bridge: Canal de comunicación que utiliza el estándar "Mensajes de Utilidad" de WhatsApp Cloud API (~0.17MXN),optimizandoelROIfrentealosmensajesdemarketing( 0.55 MXN)
Latencia de Respuesta: El sistema está diseñado para procesar, clasificar y responder en menos de 5 segundos para evitar la pérdida del 78% de los prospectos