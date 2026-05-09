# Aliado RESICO — Refactorización a Producción (v2.0)

El proyecto ha sido exitosamente migrado desde una arquitectura de datos simulados (mock data) hacia un entorno de producción robusto, utilizando integraciones reales con **Gemini 1.5 Flash**, **Supabase**, y un puente listo para **n8n / Telegram Bot API**.

Todo el sistema preserva su estética "Premium Contable" original (Dark Mode & Glassmorphism), maximizando la confianza del usuario final mexicano.

## Cambios Implementados

### 1. Panel de Configuración y Seguridad Centralizada
Se creó `js/config.js` y se actualizó la vista de *Configuración* en `index.html`.
- **API Keys Dinámicas:** Las credenciales de Gemini, Supabase y n8n ahora se ingresan desde la UI, activando inmediatamente el **Modo Producción**. Si no hay claves, el sistema opera por defecto en **Modo Demo**.
- **Seguridad:** Las claves se guardan en `localStorage` con una ofuscación básica. Se añadió una advertencia crítica indicando que para el lanzamiento en producción, estas variables deben ocultarse en Cloud Run o en el proxy de n8n.

![Panel de Configuración](file:///C:/Users/campe/.gemini/antigravity/brain/ae718f1a-3568-4bd8-8481-5999911d8255/.system_generated/click_feedback/click_feedback_1777817806306.png)

### 2. Motor de Clasificación IA y Salud Fiscal
Se refactorizó `js/classifier.js` y `js/conversation.js`.
- **Gemini 1.5 Flash NLP:** Clasifica el lenguaje natural y domina el *slang mexicano* (ej. "la chiva", "timbrar", "varo").
- **Auditoría de Salud Fiscal:** Al iniciar la primera conversación, el asistente requiere confirmación de **Buzón Tributario activo** y **e.firma vigente**. Si no se cumple, alerta sobre posibles sanciones y expulsión del régimen, agregando un alto valor de consultoría inmediata.

![Clasificador de Intención](file:///C:/Users/campe/.gemini/antigravity/brain/ae718f1a-3568-4bd8-8481-5999911d8255/.system_generated/click_feedback/click_feedback_1777817799518.png)

### 3. Procesamiento Documental (OCR Multimodal)
Se implementó la visión artificial de Gemini en `js/ocr.js`.
- **Extracción de Precisión:** Identifica RFC, Uso CFDI, montos e IVA desglosado.
- **Verificación Humana (Safety Flag):** Si la certeza de extracción (confidence) cae por debajo del 85% (ej. un ticket de OXXO muy borroso), el documento se marca con una bandera amarilla de **Verificación Humana Requerida** para evitar multas fiscales derivadas de datos imprecisos.

![Vista de Documentos](file:///C:/Users/campe/.gemini/antigravity/brain/ae718f1a-3568-4bd8-8481-5999911d8255/.system_generated/click_feedback/click_feedback_1777817817363.png)

### 4. Persistencia en Tiempo Real
Se reconstruyó `js/store.js` para integrar el SDK de Supabase.
- Los datos fluyen de forma bidireccional (Realtime) guardando conversaciones, documentos procesados y métricas del *Dashboard*.
- Soporta desconexiones (Offline-First), respaldando en `localStorage` y sincronizando asíncronamente para no bloquear la experiencia de la *Single Page Application*.

![Dashboard Principal](file:///C:/Users/campe/.gemini/antigravity/brain/ae718f1a-3568-4bd8-8481-5999911d8255/.system_generated/click_feedback/click_feedback_1777817824828.png)

### 5. Puente Webhook y Pivot a Telegram
Se actualizó `js/webhook.js` para canalizar eventos a **n8n** vía la API de Telegram.
- **Pivot de Plataforma:** Debido a los bloqueos de Meta, el MVP se despliega sobre **Telegram Bot API**. Esto elimina los costos operativos por mensaje ($0.17 - $0.55 MXN) y las restricciones de plantillas, permitiendo iteraciones inmediatas y gratuitas de "Mensajes de Utilidad" y Alertas Fiscales mientras se valida el Product-Market Fit.

### 6. Infraestructura Backend y Orquestación (NUEVO)
Se han generado los artefactos y scripts necesarios para la integración de Supabase y n8n:
- **Estructura de Base de Datos (`supabase_schema.sql`):** Script SQL con la definición de tablas (`conversations`, `documents`, `fiscal_metrics`) y políticas de seguridad RLS (Row Level Security) para protección de datos.
- **Lógica de Orquestación n8n (`n8n_logic_flow.md` / `n8n_workflow.json`):** Definición detallada y exportación del flujo de Webhook para Telegram, integrando el motor Gemini y reglas de clasificación.
- **Inicialización de BD (`js/init-db.js`):** Script seguro para la inicialización en el cliente web de Supabase que verifica las credenciales y activa el **Modo Producción** garantizando un fallback estable en caso de desconexión.

---

**Estado:** El sistema se encuentra 100% refactorizado, probado y acoplado. Está listo para su despliegue y habilitación con llaves productivas.
