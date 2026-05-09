# Estructura Lógica para n8n (Orquestación Aliado RESICO)

Esta es la definición del flujo lógico para importar y construir en n8n. El sistema debe clasificar el mensaje y procesarlo en menos de 5 segundos para mantener el engagement del usuario.

## Nodos y Flujo de Trabajo

### 1. Entrada (Telegram Trigger)
- **Nodo:** `Telegram Trigger`
- **Función:** Recibe los eventos de la API de Telegram.
- **Acción:** Captura el payload entrante de Telegram, que incluye `chat.id` (ID del usuario), `text` (mensaje), y opcionalmente `photo` (imagen/documento).

### 2. Filtro y Preparación de Datos (Set/Switch)
- **Nodo:** `Switch` / `If`
- **Función:** Verifica el tipo de mensaje (Texto vs. Media/Imagen).
- **Acción:**
  - Si es **Texto**: Pasa al Cerebro (Clasificación NLP).
  - Si es **Imagen/Documento**: Extrae el `file_id` (la foto de mayor resolución en el array) y pasa al Cerebro (Clasificación + OCR).

### 3. Cerebro (IA & Procesamiento)
- **Nodo:** `HTTP Request` a la API de Gemini 1.5 Flash (o nodo de Google Gemini si está disponible en tu versión de n8n).
- **Función:** Clasificación de intención y/o OCR rápido.
- **Prompt Base (Texto):** "Clasifica la intención de este mensaje de un contribuyente RESICO: {message_text}. Devuelve un JSON con 'intent' y 'confidence'."
- **Prompt Base (Imagen):** "Extrae los datos fiscales de esta imagen (RFC, IVA, ISR). Devuelve un JSON. Si hay datos confusos o borrosos, establece 'safety_flag' en true."
- **Restricción de Tiempo:** Configurar timeout en n8n para asegurar que Gemini responda rápido (por lo general, Gemini 1.5 Flash responde en ~1-2 segundos).

### 4. Filtro Fiscal y Base de Datos (Supabase)
- **Nodo:** `Supabase` o `HTTP Request` (hacia la API REST de Supabase usando el Service Role Key).
- **Función:** Almacenar la conversación y verificar el estado del usuario.
- **Flujo:**
  - **Insertar** en tabla `conversations` (con `user_id` = `chat.id`, `intent`, `confidence`).
  - **Leer** registro del usuario: Verificar `is_fiscal_audit_completed`.
  - Si `is_fiscal_audit_completed` es `false` (Nuevo Usuario): 
    - Se dispara el flujo de **Auditoría de Salud Fiscal** (solicitar e.firma / revisar Buzón Tributario).
  - Si hay documento: **Insertar** en tabla `documents` con el `extracted_data` (vía `file_id`) y `safety_flag`.
  - **Actualizar** `fiscal_metrics` si se detecta un nuevo ingreso.

### 5. Salida (Telegram Response)
- **Nodo:** `Telegram` (Send Message)
- **Función:** Enviar la respuesta adecuada basada en la intención clasificada.
- **Optimización:**
  - A diferencia de WhatsApp, Telegram Bot API es **gratuito**, lo que permite iteraciones más rápidas para el MVP y el envío ilimitado de "Mensajes de Utilidad" y alertas fiscales sin incurrir en costos operativos por conversación.

---

## Flujo Resumido (Ruta Óptima de < 5 Segundos)
1. `[0.0s]` Telegram envía actualización -> n8n lo recibe (Telegram Trigger).
2. `[0.1s]` n8n extrae variables (`chat_id`, `text` o `file_id`) y envía a Gemini.
3. `[2.0s]` Gemini devuelve el JSON con Intent / OCR data.
4. `[2.5s]` n8n guarda en Supabase.
5. `[3.0s]` n8n evalúa la regla de Salud Fiscal y selecciona la respuesta.
6. `[3.2s]` n8n envía respuesta a la API de Telegram.
7. `[3.5s]` El usuario recibe la respuesta en su Telegram.
