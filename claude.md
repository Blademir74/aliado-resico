Aliado RESICO: Documentación Integral del Sistema v2.6
Aliado RESICO es una infraestructura de confianza fiscal diseñada para automatizar el cumplimiento del Régimen Simplificado de Confianza (RESICO) para personas físicas en México
1
2
. El sistema actúa como una "recepcionista contable inteligente" que procesa lenguaje natural, gestiona documentos mediante visión artificial y monitorea límites legales en tiempo real para evitar multas y la expulsión del régimen
3
.

--------------------------------------------------------------------------------
📂 1. Estructura de la Carpeta Local (C:\Users\campe\Desktop\AliadoResico)
La arquitectura sigue el patrón de una Single Page Application (SPA) con funciones de backend serverless para el blindaje de secretos
6
7
.
AliadoResico/
├── api/                        # Funciones Serverless (Backend en Vercel)
│   ├── gemini-proxy.js         # Proxy seguro para ocultar GEMINI_API_KEY [User History]
│   ├── config.js               # Punto de enlace para variables de entorno [8, 9]
│   ├── auth-callback.js        # Manejador de retorno de autenticación [User History]
│   └── telegram-diagnostics.js # Herramientas de diagnóstico de red [10]
├── js/                         # Módulos de Lógica Frontend (Vanilla JS)
│   ├── config.js               # Gestión de estado de configuración y llaves [8, 9]
│   ├── classifier.js           # Motor de NLP con Gemini 1.5 Flash [8, 11]
│   ├── ocr.js                  # Procesamiento de imágenes (Gemini Vision) [8, 12]
│   ├── store.js                # Persistencia reactiva y sincronización con Supabase [8, 13]
│   ├── webhook.js              # Puente de comunicación con n8n/WhatsApp [8, 14]
│   ├── dashboard.js            # Lógica de renderizado de KPIs y gráficas [15]
│   ├── chat.js                 # Interfaz del simulador de WhatsApp [16]
│   ├── auth.js                 # Manejador de sesiones de usuario [17]
│   └── app.js                  # Orquestador principal y enrutador SPA [7]
├── supabase/                   # Configuración de Base de Datos
│   └── migrations/
│       └── 001_rls_security.sql # Scripts de Row Level Security (RLS) [18, 19]
├── index.html                  # Contenedor principal (Dashboard Premium) [6]
├── styles.css                  # Sistema de diseño (Dark Mode/Glassmorphism) [20]
├── package.json                # Configuración de Node.js 24 y dependencias [User History]
├── vercel.json                 # Configuración de despliegue y Runtimes [User History]
└── README.md                   # Resumen ejecutivo del proyecto

--------------------------------------------------------------------------------
⚙️ 2. Stack Tecnológico de Grado Producción
Para garantizar la escalabilidad y el costo operativo cero en fases iniciales, el sistema utiliza:
IA & OCR: Google Gemini 1.5 Flash para clasificación de intenciones con slang mexicano y extracción de datos de tickets con 97% de precisión
8
.
Base de Datos & Auth: Supabase (PostgreSQL) con persistencia en tiempo real y aislamiento de datos mediante Row Level Security (RLS)
11
12
.
Infraestructura: Vercel utilizando el runtime de Node.js 24 para funciones serverless [User History].
Orquestación: n8n para el flujo de mensajes de WhatsApp Cloud API categorizados como "Mensajes de Utilidad" para ahorro de costos
12
13
.

--------------------------------------------------------------------------------
⚖️ 3. Inteligencia Fiscal Aplicada (LISR & CFF)
El sistema no es solo software; es un experto legal programado con la normativa vigente de 2024-2026
14
15
.
A. Monitor de Ingresos (Art. 113-E LISR)
Rastrea el límite de $3,500,000 MXN anuales
16
17
.
Implementa un semáforo de riesgo: Verde (Seguro), Amarillo (80%), Naranja (90%) y Rojo (94%) para prevenir la expulsión automática al Régimen de Actividad Empresarial
16
.
B. Salud Fiscal (Art. 17-K CFF)
Valida proactivamente la activación del Buzón Tributario y la vigencia de la e.firma
20
.
Alerta sobre multas de $10,260 MXN por incumplimiento, advirtiendo que por reincidencia la sanción se duplica conforme al Art. 86-C del CFF
20
.
C. Diferenciación ISR vs. IVA
ISR RESICO: Se paga sobre ingresos brutos efectivamente cobrados (tasas del 1% al 2.5%) sin aplicar deducciones
18
.
IVA: El acreditamiento de gastos es indispensable, por lo que el sistema prioriza el OCR para capturar el IVA de cada ticket facturado
26
.

--------------------------------------------------------------------------------
🔐 4. Protocolo de Seguridad y Confianza
Para mitigar el riesgo de fraude y cumplir con la LFPDPPP, el sistema implementa:
Aislamiento Multi-tenant: La política RLS auth.uid() = user_id en Supabase asegura que ningún contribuyente pueda ver los datos fiscales de otro
29
30
.
Blindaje de API Keys: Las credenciales de Gemini y Supabase se gestionan exclusivamente en el lado del servidor (Vercel Functions), eliminando su exposición en el frontend
31
.
Auth Guard: El acceso al Dashboard está bloqueado hasta que se valide una sesión activa con usuario y contraseña
34
35
.

--------------------------------------------------------------------------------
📈 5. Modelo de Negocio "Done-for-you"
Dada la escasez del 68% de talento técnico en México, Aliado RESICO se comercializa como un servicio llave en mano
20
:
Setup Fee Estratégico: $7,500 a $15,000 MXN por la regularización técnica inicial y configuración de infraestructura
25
.
Retainer Mensual: $3,500 a $5,500 MXN por la consultoría automatizada 24/7 y monitoreo continuo
25
.
Propuesta de Valor: Recuperación de 15 a 20 horas semanales de administración manual para el contribuyente
4
.
Este sistema está certificado para demos y pilotos controlados, con un avance técnico del 97%, restando únicamente la ejecución final de los scripts SQL de seguridad en el dashboard de Supabase para su lanzamiento masivo