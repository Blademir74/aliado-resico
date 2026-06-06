 AppFlow: Aliado RESICO - Flujo de Navegación v2.6 (Producción)
La aplicación está diseñada como una Single Page Application (SPA)

La navegación es instantánea mediante un Router dinámico que alterna entre módulos sin recargar la página, optimizando el tiempo de respuesta a menos de 5 segundos para evitar la pérdida de leads

🔒 Nivel 0: Búnker de Acceso (Auth Guard)
Es la primera capa de seguridad obligatoria para cumplir con la LFPDPPP y activar el Row Level Security (RLS) de Supabase
1
Pantalla de Bienvenida / Login:
Click en "Iniciar Sesión": Valida credenciales contra Supabase Auth. Si es exitoso, rompe el Auth Guard y redirige al Dashboard Principal

Click en "Crear Cuenta": Despliega el formulario de registro (Nombre, RFC, Teléfono). Al finalizar, dispara el Onboarding Wizard

Click en "Ver Demo": Carga un estado global con datos simulados (mock-data) para exploración limitada

🏁 Nivel 1: Onboarding Fiscal (Wizard de Inicio)
Solo se activa tras el primer registro para alimentar la inteligencia del Art. 113-E de la LISR

Paso 1 (Perfil): El usuario ingresa su actividad económica. Siguiente →
Paso 2 (Historial): Ingresa sus ingresos acumulados del año. Esto calibra el Monitor de Ingresos. Siguiente →
Paso 3 (Documentos): El usuario sube su Constancia de Situación Fiscal y e.firma a "Mi Carpeta Fiscal"

Finalizar: Guarda datos en Supabase y abre el Dashboard

📊 Nivel 2: Centro de Mando (Dashboard Principal)
El "corazón" del sistema donde se gobierna la ansiedad fiscal

Módulo Monitor de Ingresos (Art. 113-E):
Click en "Barra de Progreso": Abre el desglose mensual de ingresos y la proyección de cierre anual para evitar la expulsión del régimen (límite $3.5 MDP)

Módulo Salud Fiscal (Art. 17-K):
Click en "Buzón Tributario": Si marca "Inactivo", despliega la advertencia de multa de hasta $10,260 MXN y guía para su activación

Sección de KPIs:
Click en "Resolución Automática": Muestra el reporte de eficiencia del asistente IA

💬 Nivel 3: El Asistente IA (WhatsApp Simulator)
Motor de procesamiento de lenguaje natural que domina el slang fiscal mexicano

Entrada de Texto: El usuario pregunta (ej. "¿Cuánto varo puedo ganar?").
Procesamiento: El Proxy de Vercel conecta con Gemini 1.5 Flash sin exponer las llaves

Respuesta:
Categoría CONSULTA_FISCAL: El bot responde con fundamentos legales 2026

Click en "Asistente de Anual": Inicia el flujo condicional del Art. 113-F LISR (¿Solo RESICO o ingresos mixtos?)

📂 Nivel 4: Gestión Documental (OCR y Carpeta)
Módulo de acreditamiento de IVA y almacenamiento seguro

Dropzone de Archivos:
Acción: Arrastrar ticket de gasto.
Proceso: Gemini Vision extrae RFC e IVA con 97% de precisión

Click en "Validar": Guarda el gasto en la tabla documents de Supabase para el reporte mensual de IVA

Mi Carpeta Fiscal:
Acción: Click en carpeta 📁 "e.firma". Muestra días restantes para el vencimiento y dispara alerta si es menor a 30 días

⚙️ Nivel 5: Configuración y Blindaje (Settings)
Exclusivo para el control de la infraestructura

Panel API Keys: Solo visible en modo desarrollo o para administradores. Permite testear la conexión con Gemini y Supabase

Click en "Cerrar Sesión": Limpia el sessionToken, activa el Auth Guard y borra el estado reactivo del frontend

🗺️ Resumen de Saltos (Si hago click en...)
Si el usuario hace click en...
El sistema lo lleva a...
Propósito Fiscal / Técnico
Buzón Tributario (Dashboard)
Alerta de Salud Fiscal
Prevenir multas del Art. 17-K CFF

Subir Ticket (Documentos)
OCR View
Extraer IVA para acreditamiento

"¿Debo presentar anual?" (Chat)
Asistente Art. 113-F
Determinar obligación según tipo de ingresos

Ajustes (Sidebar)
Configuración de APIs
Habilitar el "Modo Producción"

Logo Aliado RESICO
Dashboard Home
Vista general de riesgos y KPIs
