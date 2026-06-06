Diseño UI/UX: Aliado RESICO - Bóveda de Confianza Fiscal
1. Fundamentos de Identidad Visual (Design System)
El sistema abandona la sobriedad del "blanco y negro" para adoptar una estética Premium Contable basada en profundidad y colores funcionales

Estilo Core: Glassmorphism profundo. Tarjetas con backdrop-filter: blur(16px), bordes sutiles de 1px y sombras suaves para generar capas de información

Paleta de Colores Funcionales:
Fondo Búnker: #0a0f1c (Azul medianoche profundo)

Verde Esmeralda (Seguridad): #10b981 - Estado de cumplimiento y margen amplio en RESICO

Ámbar Fiscal (Prevención): #f59e0b - Alerta al alcanzar el 80% del límite ($2.8 MDP)

Rojo Alerta (Riesgo Crítico): #ef4444 - 94% del límite ($3.3 MDP), Buzón inactivo o e.firma vencida

Tipografía: Inter para máxima legibilidad en números y fundamentos legales

2. Arquitectura de Pantallas (Flujo de Decisión)
A. Pantalla de Acceso (Auth Guard)
Objetivo: Eliminar la vulnerabilidad de acceso abierto y generar "seguridad percibida" inmediata

Diseño: Overlay centrado sobre un fondo desenfocado del dashboard.
Elementos:
Logo con escudo y brillo exterior (glow) para comunicar protección.
Campos: Email (Placeholder: rfc@empresa.mx) y Contraseña.
Mensaje de Confianza: "Tus datos están blindados con cifrado AES-256 y políticas RLS bajo la LFPDPPP"

Link de recuperación de contraseña (Resolviendo el Bug #5)

B. Dashboard Principal: "El Radar de Riesgos"
Sustituye métricas vanidosas por indicadores de supervivencia fiscal

Monitor de Ingresos Estratégico (Art. 113-E LISR):
Visualización de barra de progreso dinámica que cambia de color según el umbral (Verde → Ámbar → Rojo)

Copy dinámico: "Te quedan $X,XXX MXN antes de que el SAT te migre a Actividad Empresarial"

Módulo de Salud Fiscal (Art. 17-K CFF):
Tarjetas de estado para Buzón Tributario y e.firma.
Botón de acción rápida: "Validar Opinión de Cumplimiento"

KPIs Operativos Reales:
Mensajes procesados por IA.
Ahorro de tiempo estimado (Meta: 18-20 horas semanales)

Confianza promedio del motor (Safety Flag)

C. Módulo "Mi Carpeta Fiscal" (Centralizador)
Resuelve el dolor del desorden documental detectado en las encuestas a contadores

Estructura de Carpetas Visual:
📁 Documentos Oficiales: Constancia de Situación Fiscal, CSD.
📁 Llaves de Acceso: e.firma (con indicador de días restantes para vencimiento)
📁 Historial de Gastos: Tickets procesados por el OCR de Gemini

Lógica de Arrastre: Zona de Drag & Drop para subir tickets de gasolina u OXXO

D. Asistente IA (WhatsApp Simulator)
Interfaz: Burbujas de chat con micro-badges que indican la intención detectada (CONSULTA_FISCAL, REGISTRO_GASTO, etc.)

Diferenciador Pedagógico: Al registrar un gasto, el bot inserta una nota visual:

3. Optimización Mobile-First (Solución de Bugs)
Para resolver el overflow horizontal y el logo cortado en móviles

Layout: Colapso automático del sidebar a un menú de hamburguesa inferior (fácil acceso con el pulgar).
Viewport: Uso estricto de max-width: 100vw y overflow-x: hidden en el contenedor principal.
Tarjetas: Visualización en una sola columna con espaciado de 16px para evitar amontonamiento de datos en pantallas pequeñas

4. El "Momento de la Verdad" (Feedback Visual)
El sistema debe dar respuesta en menos de 5 segundos

Skeleton Screens: Mientras la IA clasifica mediante el proxy de Vercel, se muestran estados de carga animados en las tarjetas para reducir la ansiedad del usuario

Banner de Verificación Humana: Si la confianza del OCR es < 85%, aparece un cintillo ámbar: "⚠️ Datos borrosos detectados. Revisión manual requerida para evitar multas