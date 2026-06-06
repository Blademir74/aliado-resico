Plan de Implementación: Aliado RESICO - Infraestructura de Producción
1. Visión General del Despliegue
El objetivo es establecer una Infraestructura de Confianza Fiscal que automatice el cumplimiento de las reglas 2026, eliminando la gestión manual de 20 horas semanales para el contribuyente

. El sistema opera bajo un modelo "Done-for-you", donde el cliente recibe una solución llave en mano

--------------------------------------------------------------------------------
2. Fase 1: Hardening Técnico y Seguridad (Búnker de Datos)
Aislamiento Multi-tenant (RLS): Ejecución obligatoria del script SQL en Supabase para activar la política auth.uid() = user_id. Esto garantiza que los datos fiscales sean privados e invisibles entre contribuyentes, cumpliendo con la LFPDPPP

Blindaje de Secretos: Migración de API Keys del frontend a un Proxy Serverless en Vercel (/api/gemini-proxy.js). Ninguna credencial de Gemini o Supabase debe ser visible en el navegador

Runtime de Producción: Configuración estricta de Node.js 24.x en Vercel para asegurar la compatibilidad con las funciones de IA y procesamiento de documentos [User History].

--------------------------------------------------------------------------------
3. Fase 2: Inteligencia Fiscal Aplicada (Reglas 2026)
Monitor de Ingresos (Art. 113-E LISR): Implementación de alertas escalonadas:
Amarillo (80% - $2.8 MDP): Aviso preventivo

Naranja (90% - $3.15 MDP): Alerta de riesgo alto

Rojo (94% - $3.3 MDP): Riesgo inminente de expulsión al Régimen General

Asistente de Declaración Anual (Art. 113-F LISR): Configuración de la lógica condicional para distinguir entre contribuyentes exentos (RESICO puro) y obligados (ingresos mixtos >$400k) [User History, 420, 470].
Salud Fiscal (Art. 17-K CFF): Activación de alertas por Buzón Tributario inactivo citando la multa exacta de $10,260 MXN y advirtiendo duplicidad por reincidencia (Art. 86-C CFF)

--------------------------------------------------------------------------------
4. Fase 3: Procesamiento Documental y OCR
Extracción Multi-Acreditamiento: Configuración del motor OCR de Gemini 1.5 Flash para extraer RFC, montos e IVA con 97% de precisión

Diferenciador Educativo: El sistema debe marcar los gastos procesados con la nota: "ISR: Sin deducciones (tasa fija). IVA: Gasto INDISPENSABLE para acreditamiento"

Safety Flag: Bloqueo de registros automáticos si la confianza del OCR es inferior al 85%, activando la "Verificación Humana" para evitar sanciones del SAT
16

--------------------------------------------------------------------------------
5. Fase 4: Protocolo de Lanzamiento y "Go-Live"
Prueba de Estrés (Stress Test): Validación de los 30 casos críticos (slang mexicano, límites de 3.5 MDP, e.firma vencida) para certificar que el sistema responde en menos de 5 segundos

Onboarding Wizard: Implementación del flujo inicial de 3 pasos: 1) Perfil Fiscal (RFC), 2) Historial de Ingresos, 3) Carga de e.firma a "Mi Carpeta Fiscal"

Estrategia de Captación: Prospección dirigida a nichos de alta rentabilidad (Inmobiliario, Salud, Micro-retail) ofreciendo la Auditoría de Salud Fiscal Gratuita como gancho comercial

-----------------------------------------------------------------------------------------
6. Modelo de Negocio y ROI
Estructura de Cobro:
Setup Fee: $7,500 a $15,000 MXN (Configuración inicial e infraestructura)

Retainer Mensual: $3,500 a $5,500 MXN (Monitoreo activo y consultoría IA 24/7)

Promesa de Valor: Recuperación de hasta el 92% del tiempo dedicado a facturación y contabilidad manual
