/* ============================================
   ALIADO RESICO — Input Sanitizer
   Prevención de XSS, SQL Injection, Prompt Injection
   Módulo global para sanitización antes de IA y Supabase
   ============================================ */

const InputSanitizer = (() => {

  // --- Límites de seguridad ---
  const LIMITS = {
    MAX_MESSAGE_LENGTH: 2000,    // Caracteres máximos para mensajes
    MAX_FILENAME_LENGTH: 255,    // Caracteres máximos para nombres de archivo
    MAX_PAYLOAD_SIZE: 10240,     // 10KB máximo para payloads JSON
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB máximo para archivos
  };

  // --- Patrones peligrosos ---
  const DANGEROUS_PATTERNS = {
    // SQL Injection patterns
    sql: [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|EXEC|UNION|TRUNCATE)\b\s)/gi,
      /(--|\/\*|\*\/|;--)/g,
      /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
      /(\bAND\b\s+\d+\s*=\s*\d+)/gi,
      /('\s*OR\s*')/gi,
    ],
    // XSS patterns
    xss: [
      /<script[\s>]/gi,
      /javascript\s*:/gi,
      /on(load|error|click|mouseover|focus|blur)\s*=/gi,
      /<iframe/gi,
      /<object/gi,
      /<embed/gi,
      /<form/gi,
      /data\s*:\s*text\/html/gi,
    ],
    // Prompt injection patterns (para IA)
    promptInjection: [
      /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/gi,
      /disregard\s+(all\s+)?(previous|prior)\s/gi,
      /you\s+are\s+now\s+/gi,
      /new\s+instructions?\s*:/gi,
      /system\s*prompt\s*:/gi,
      /\bact\s+as\b/gi,
      /\brole\s*play\b/gi,
      /pretend\s+you\s+are/gi,
      /forget\s+(everything|all|your)/gi,
    ],
  };

  // =============================================
  // SANITIZE TEXT — Limpieza general para persistencia
  // Uso: antes de guardar en Supabase o mostrar en UI
  // =============================================
  function sanitizeText(input) {
    if (!input || typeof input !== 'string') return '';

    let cleaned = input;

    // 1. Trim y normalizar whitespace
    cleaned = cleaned.trim();
    cleaned = cleaned.replace(/\s+/g, ' ');

    // 2. Remover caracteres de control (excepto newlines y tabs)
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 3. Escape de caracteres HTML peligrosos
    cleaned = escapeHTML(cleaned);

    // 4. Limitar longitud
    if (cleaned.length > LIMITS.MAX_MESSAGE_LENGTH) {
      cleaned = cleaned.substring(0, LIMITS.MAX_MESSAGE_LENGTH);
    }

    return cleaned;
  }

  // =============================================
  // SANITIZE FOR AI — Limpieza antes de enviar a Gemini
  // Preserva el significado pero previene prompt injection
  // =============================================
  function sanitizeForAI(input) {
    if (!input || typeof input !== 'string') return '';

    let cleaned = input.trim();

    // 1. Remover caracteres de control
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 2. Detectar y neutralizar prompt injection
    let injectionDetected = false;
    for (const pattern of DANGEROUS_PATTERNS.promptInjection) {
      if (pattern.test(cleaned)) {
        injectionDetected = true;
        // Reemplazar con versión neutralizada (agregar corchetes)
        cleaned = cleaned.replace(pattern, '[FILTERED]');
      }
    }

    if (injectionDetected) {
      console.warn('%c[Sanitizer] ⚠️ Prompt injection detectado y neutralizado', 'color:#f59e0b;font-weight:bold');
    }

    // 3. Limitar longitud (mensajes muy largos pueden ser ataques)
    if (cleaned.length > LIMITS.MAX_MESSAGE_LENGTH) {
      cleaned = cleaned.substring(0, LIMITS.MAX_MESSAGE_LENGTH);
    }

    // 4. NO escapar HTML aquí — el texto va a Gemini, no al DOM
    return cleaned;
  }

  // =============================================
  // SANITIZE FILENAME — Limpieza de nombres de archivo
  // =============================================
  function sanitizeFileName(name) {
    if (!name || typeof name !== 'string') return 'unnamed_file';

    let cleaned = name.trim();

    // 1. Remover path traversal
    cleaned = cleaned.replace(/\.\.\//g, '');
    cleaned = cleaned.replace(/\.\.\\/g, '');

    // 2. Remover caracteres peligrosos en nombres de archivo
    cleaned = cleaned.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

    // 3. Limitar longitud
    if (cleaned.length > LIMITS.MAX_FILENAME_LENGTH) {
      const ext = cleaned.lastIndexOf('.') > -1 ? cleaned.slice(cleaned.lastIndexOf('.')) : '';
      cleaned = cleaned.substring(0, LIMITS.MAX_FILENAME_LENGTH - ext.length) + ext;
    }

    // 4. Asegurar que no está vacío después de la limpieza
    if (!cleaned || cleaned === '') return 'unnamed_file';

    return cleaned;
  }

  // =============================================
  // SANITIZE FOR SUPABASE — Limpieza antes de persistir
  // Previene SQL injection en datos que van a la DB
  // =============================================
  function sanitizeForDatabase(input) {
    if (!input || typeof input !== 'string') return '';

    let cleaned = input.trim();

    // 1. Remover caracteres de control
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // 2. Detectar patrones SQL peligrosos (solo log, no bloquear — Supabase usa parametrized queries)
    for (const pattern of DANGEROUS_PATTERNS.sql) {
      if (pattern.test(cleaned)) {
        console.warn('%c[Sanitizer] ⚠️ Patrón SQL sospechoso detectado en input', 'color:#ef4444;font-weight:bold');
        // No bloquear — Supabase ya parametriza, pero registrar
        break;
      }
    }

    // 3. Limitar longitud
    if (cleaned.length > LIMITS.MAX_MESSAGE_LENGTH) {
      cleaned = cleaned.substring(0, LIMITS.MAX_MESSAGE_LENGTH);
    }

    return cleaned;
  }

  // =============================================
  // VALIDATE PAYLOAD SIZE — Para webhooks/API
  // =============================================
  function validatePayloadSize(payload) {
    try {
      const size = new Blob([JSON.stringify(payload)]).size;
      return {
        valid: size <= LIMITS.MAX_PAYLOAD_SIZE,
        size,
        maxSize: LIMITS.MAX_PAYLOAD_SIZE,
        error: size > LIMITS.MAX_PAYLOAD_SIZE
          ? `Payload excede límite: ${(size / 1024).toFixed(1)}KB > ${(LIMITS.MAX_PAYLOAD_SIZE / 1024).toFixed(1)}KB`
          : null,
      };
    } catch {
      return { valid: false, size: 0, error: 'No se pudo calcular el tamaño del payload' };
    }
  }

  // =============================================
  // VALIDATE FILE SIZE — Para uploads OCR
  // =============================================
  function validateFileSize(file) {
    if (!file) return { valid: false, error: 'No se proporcionó archivo' };
    return {
      valid: file.size <= LIMITS.MAX_FILE_SIZE,
      size: file.size,
      maxSize: LIMITS.MAX_FILE_SIZE,
      error: file.size > LIMITS.MAX_FILE_SIZE
        ? `Archivo excede límite: ${(file.size / (1024 * 1024)).toFixed(1)}MB > ${(LIMITS.MAX_FILE_SIZE / (1024 * 1024)).toFixed(1)}MB`
        : null,
    };
  }

  // =============================================
  // ESCAPE HTML — Escape robusto para prevenir XSS
  // Reemplaza las implementaciones duplicadas en dashboard.js y app.js
  // =============================================
  function escapeHTML(str) {
    if (!str || typeof str !== 'string') return '';
    const escapeMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#96;'
    };
    return str.replace(/[&<>"'\/`]/g, char => escapeMap[char]);
  }

  // =============================================
  // DETECT THREATS — Análisis completo de amenazas
  // =============================================
  function detectThreats(input) {
    if (!input || typeof input !== 'string') return { safe: true, threats: [] };

    const threats = [];

    for (const pattern of DANGEROUS_PATTERNS.xss) {
      if (pattern.test(input)) threats.push('xss');
    }
    for (const pattern of DANGEROUS_PATTERNS.sql) {
      if (pattern.test(input)) threats.push('sql_injection');
    }
    for (const pattern of DANGEROUS_PATTERNS.promptInjection) {
      if (pattern.test(input)) threats.push('prompt_injection');
    }

    // Deduplicar
    const unique = [...new Set(threats)];

    if (unique.length > 0) {
      console.warn(
        `%c[Sanitizer] 🚨 Amenazas detectadas: ${unique.join(', ')}`,
        'color:#ef4444;font-weight:bold'
      );
    }

    return { safe: unique.length === 0, threats: unique };
  }

  // =============================================
  // PUBLIC API
  // =============================================
  return {
    sanitizeText,
    sanitizeForAI,
    sanitizeFileName,
    sanitizeForDatabase,
    validatePayloadSize,
    validateFileSize,
    escapeHTML,
    detectThreats,
    LIMITS,
  };
})();

if (typeof window !== 'undefined') window.InputSanitizer = InputSanitizer;
