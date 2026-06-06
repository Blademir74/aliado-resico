infraestructura de Blindaje Fiscal v2.6 (Actualizado 2026)

1. Visión del Producto
Transformar la gestión fiscal del Régimen Simplificado de Confianza (RESICO) de una carga administrativa manual de 20 horas semanales a un flujo automatizado de "grado bancario"

El sistema no solo informa, sino que gobierna decisiones para evitar multas y la expulsión del régimen

2. Mapa de Dolores del Contribuyente (Nicho México 2026)
Basado en auditorías de foros y práctica contable actual, el PRD resuelve:
Confusión en la Declaración Anual: Incertidumbre sobre quién está exento y quién obligado (ingresos mixtos vs. puros)

Miedo a la Expulsión (Art. 113-E LISR): Pánico a rebasar los 3.5 MDP y perder las tasas del 1% al 2.5%

Amnesia Administrativa: Olvido de la vigencia de la e.firma y desatención del Buzón Tributario

Complejidad del IVA: Error común de creer que en RESICO no se declaran gastos, cuando el ISR es sobre ingresos brutos pero el IVA es indispensable acreditarlo con facturas

3. Especificaciones Funcionales (Lógica 2026)
A. Monitor de Ingresos Estratégico (Art. 113-E LISR)
Funcionalidad: Rastreo en tiempo real de ingresos acumulados contra el límite de $3,500,000 MXN

Regla 2026: Implementación de Semáforo Preventivo Escalonado:
🟢 Seguro: < 80% del límite.
🟡 Preventivo (80% - $2.8M): Dispara alerta de planeación fiscal

🟠 Riesgo Alto (90% - $3.15M): Alerta crítica de proximidad

🔴 Riesgo de Expulsión (94% - $3.3M): Advertencia de migración forzosa a Actividad Empresarial

B. Asistente Condicional de Declaración Anual (Art. 113-F LISR)
Funcionalidad: Wizard inteligente que determina la obligación de la anual en abril

Lógica 2026: No afirmar que es obligatoria para todos. El sistema debe preguntar:
¿Tuviste ingresos solo por RESICO? (Exento si cumple condiciones)

¿Tuviste salarios > $400,000, intereses o dividendos? (Obligado)

C. Auditoría de Salud Fiscal (Art. 17-K CFF)
Funcionalidad: Validación proactiva de canales de comunicación oficial

Regla 2026: Alerta específica de multa de hasta $10,260 MXN por Buzón Tributario inactivo y advertencia de duplicidad por reincidencia (Art. 86-C CFF)

Monitoreo de e.firma: Alertas preventivas 90, 30 y 15 días antes del vencimiento (Art. 17-D CFF)

D. Motor OCR Multi-Acreditamiento
Funcionalidad: Extracción de datos con 97% de precisión mediante Gemini 1.5 Flash Vision

Lógica 2026: Separación pedagógica ISR vs IVA.
ISR: Informar que el gasto no deduce para el pago del 1% al 2.5%

IVA: Validar el gasto como INDISPENSABLE para acreditar el 16%

Safety Flag: Si la confianza es < 85%, el sistema bloquea el registro automático y exige "Verificación Humana"

E. Módulo "Mi Carpeta Fiscal" (Centralización)
Funcionalidad: Repositorio cifrado para:
e.firma (.cer y .key)

Constancia de Situación Fiscal actualizada

Opinión de Cumplimiento (Debe ser Positiva para permanecer en RESICO)

4. Requerimientos Técnicos y de Seguridad
Infraestructura: Vercel con Runtime Node.js 24 [Conversation History].
Aislamiento de Datos: Implementación obligatoria de Row Level Security (RLS) en Supabase: auth.uid() = user_id. Prohibido el acceso anónimo a métricas fiscales

Blindaje de Secretos: Uso de Proxy Serverless (/api/gemini-proxy) para ocultar la API Key de Gemini del frontend

UX/UI: Estética Premium Contable (Glassmorphism), Mobile-First para eliminar el scroll horizontal en dispositivos móviles

5. Modelo de Negocio "Done-for-you"
Setup Fee: $7,500 a $15,000 MXN por configuración técnica inicial

Retainer Mensual: $3,500 a $5,500 MXN por vigilancia activa 24/7

