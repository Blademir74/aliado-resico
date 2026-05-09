-- ============================================================
-- ALIADO RESICO — Supabase Schema + Row Level Security (RLS)
-- Producción — Ninguna tabla es de libre acceso
-- Cumplimiento: CFF Art. 17-K, LISR Art. 113-E
-- ============================================================

-- ============================================================
-- 1. TABLAS PRINCIPALES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,              -- WhatsApp/Telegram ID
    text TEXT NOT NULL,
    sender TEXT DEFAULT 'Usuario',
    time TEXT,
    intent TEXT NOT NULL,               -- Classified intent by Gemini
    confidence NUMERIC,                 -- Confidence level 0-1
    keywords TEXT[],
    explanation TEXT,
    response TEXT,
    source TEXT DEFAULT 'local',
    is_fiscal_audit_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conv_id UUID,
    user_id TEXT,                       -- Owner for RLS scoping
    file_name TEXT,
    file_url TEXT,
    doc_type TEXT,
    extracted_data JSONB,               -- JSON: RFC, IVA, totals, etc.
    confidence NUMERIC,
    validation_status TEXT DEFAULT 'pendiente',
    needs_review BOOLEAN DEFAULT FALSE, -- True if confidence < 85%
    safety_flag BOOLEAN DEFAULT FALSE,
    source TEXT DEFAULT 'unknown',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fiscal_metrics (
    id TEXT PRIMARY KEY DEFAULT 'primary',
    user_id TEXT NOT NULL,              -- WhatsApp/Telegram ID
    income_ytd NUMERIC DEFAULT 0,      -- Ingresos acumulados anuales
    total_processed INT DEFAULT 0,
    by_category JSONB DEFAULT '{}',
    avg_confidence NUMERIC DEFAULT 0,
    is_near_limit BOOLEAN DEFAULT FALSE, -- Alerta umbral 3.5 MDP
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 2. TABLA DE AUDITORÍA (Integridad CFF)
-- Registra cambios críticos en datos fiscales
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL,               -- INSERT, UPDATE, DELETE
    old_data JSONB,
    new_data JSONB,
    performed_by TEXT DEFAULT current_user,
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================
-- 3. TABLA DE TASAS ISR RESICO (Art. 113-E LISR)
-- Referencia inmutable para cálculos
-- ============================================================

CREATE TABLE IF NOT EXISTS public.isr_rates_resico (
    id SERIAL PRIMARY KEY,
    lower_limit NUMERIC NOT NULL,       -- Límite inferior mensual
    upper_limit NUMERIC NOT NULL,       -- Límite superior mensual
    rate_pct NUMERIC NOT NULL,          -- Tasa ISR (%)
    description TEXT,
    valid_from DATE DEFAULT '2022-01-01',
    valid_until DATE DEFAULT '2099-12-31'
);

-- Insertar tasas oficiales Art. 113-E LISR (solo si tabla vacía)
INSERT INTO public.isr_rates_resico (lower_limit, upper_limit, rate_pct, description)
SELECT * FROM (VALUES
    (0.00,       25000.00,    1.00, 'Hasta $25,000 mensuales'),
    (25000.01,   50000.00,    1.10, 'De $25,000.01 a $50,000'),
    (50000.01,   83333.33,    1.50, 'De $50,000.01 a $83,333.33'),
    (83333.34,   208333.33,   2.00, 'De $83,333.34 a $208,333.33'),
    (208333.34,  3500000.00,  2.50, 'De $208,333.34 hasta límite anual')
) AS v(lower_limit, upper_limit, rate_pct, description)
WHERE NOT EXISTS (SELECT 1 FROM public.isr_rates_resico LIMIT 1);

-- ============================================================
-- 4. ENABLE ROW LEVEL SECURITY EN TODAS LAS TABLAS
-- ============================================================

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isr_rates_resico ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. POLÍTICAS RLS — CONVERSATIONS
-- Principio: mínimo privilegio por rol
-- ============================================================

-- Limpiar políticas existentes (idempotencia)
DROP POLICY IF EXISTS "Service role full access to conversations" ON public.conversations;
DROP POLICY IF EXISTS "Anon denied conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated read own conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated insert own conversations" ON public.conversations;

-- service_role: acceso total (n8n, backend)
CREATE POLICY "Service role full access to conversations"
    ON public.conversations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- anon: SIN ACCESO (denegación explícita)
CREATE POLICY "Anon denied conversations"
    ON public.conversations
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- authenticated: leer solo sus propias conversaciones
CREATE POLICY "Authenticated read own conversations"
    ON public.conversations
    FOR SELECT
    TO authenticated
    USING (user_id = auth.jwt() ->> 'sub');

-- authenticated: insertar solo con su propio user_id
CREATE POLICY "Authenticated insert own conversations"
    ON public.conversations
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.jwt() ->> 'sub');

-- ============================================================
-- 6. POLÍTICAS RLS — DOCUMENTS
-- ============================================================

DROP POLICY IF EXISTS "Service role full access to documents" ON public.documents;
DROP POLICY IF EXISTS "Anon denied documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated read own documents" ON public.documents;
DROP POLICY IF EXISTS "Authenticated insert own documents" ON public.documents;

CREATE POLICY "Service role full access to documents"
    ON public.documents
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Anon denied documents"
    ON public.documents
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

CREATE POLICY "Authenticated read own documents"
    ON public.documents
    FOR SELECT
    TO authenticated
    USING (user_id = auth.jwt() ->> 'sub');

CREATE POLICY "Authenticated insert own documents"
    ON public.documents
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.jwt() ->> 'sub');

-- ============================================================
-- 7. POLÍTICAS RLS — FISCAL_METRICS
-- ============================================================

DROP POLICY IF EXISTS "Service role full access to fiscal_metrics" ON public.fiscal_metrics;
DROP POLICY IF EXISTS "Anon read fiscal_metrics" ON public.fiscal_metrics;
DROP POLICY IF EXISTS "Anon denied write fiscal_metrics" ON public.fiscal_metrics;
DROP POLICY IF EXISTS "Authenticated read own fiscal_metrics" ON public.fiscal_metrics;

CREATE POLICY "Service role full access to fiscal_metrics"
    ON public.fiscal_metrics
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- anon: SOLO lectura (el dashboard público necesita métricas agregadas)
CREATE POLICY "Anon read fiscal_metrics"
    ON public.fiscal_metrics
    FOR SELECT
    TO anon
    USING (true);

-- anon: NO puede escribir
CREATE POLICY "Anon denied write fiscal_metrics"
    ON public.fiscal_metrics
    FOR INSERT
    TO anon
    WITH CHECK (false);

-- authenticated: leer solo sus propias métricas
CREATE POLICY "Authenticated read own fiscal_metrics"
    ON public.fiscal_metrics
    FOR SELECT
    TO authenticated
    USING (user_id = auth.jwt() ->> 'sub');

-- ============================================================
-- 8. POLÍTICAS RLS — AUDIT_LOG
-- ============================================================

DROP POLICY IF EXISTS "Service role full access to audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Anon denied audit_log" ON public.audit_log;
DROP POLICY IF EXISTS "Authenticated denied audit_log" ON public.audit_log;

-- Solo service_role puede leer/escribir auditoría
CREATE POLICY "Service role full access to audit_log"
    ON public.audit_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Anon denied audit_log"
    ON public.audit_log
    FOR ALL
    TO anon
    USING (false)
    WITH CHECK (false);

-- Authenticated tampoco puede modificar auditoría (inmutable)
CREATE POLICY "Authenticated denied audit_log"
    ON public.audit_log
    FOR ALL
    TO authenticated
    USING (false)
    WITH CHECK (false);

-- ============================================================
-- 9. POLÍTICAS RLS — ISR_RATES_RESICO
-- ============================================================

DROP POLICY IF EXISTS "Public read isr_rates" ON public.isr_rates_resico;
DROP POLICY IF EXISTS "Service role manage isr_rates" ON public.isr_rates_resico;

-- Todos pueden leer las tasas (son datos públicos del SAT)
CREATE POLICY "Public read isr_rates"
    ON public.isr_rates_resico
    FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

-- Solo service_role puede modificar tasas
CREATE POLICY "Service role manage isr_rates"
    ON public.isr_rates_resico
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================
-- 10. TRIGGER DE AUDITORÍA
-- Registra automáticamente cambios en tablas críticas
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_log (table_name, record_id, action, old_data)
        VALUES (TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data)
        VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_log (table_name, record_id, action, new_data)
        VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Aplicar trigger a tablas con datos fiscales
DROP TRIGGER IF EXISTS trg_audit_conversations ON public.conversations;
CREATE TRIGGER trg_audit_conversations
    AFTER INSERT OR UPDATE OR DELETE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_documents ON public.documents;
CREATE TRIGGER trg_audit_documents
    AFTER INSERT OR UPDATE OR DELETE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

DROP TRIGGER IF EXISTS trg_audit_fiscal_metrics ON public.fiscal_metrics;
CREATE TRIGGER trg_audit_fiscal_metrics
    AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_metrics
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ============================================================
-- 11. ENABLE REALTIME (para el dashboard en vivo)
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE documents;

-- ============================================================
-- 12. ÍNDICES PARA RENDIMIENTO
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_intent ON public.conversations(intent);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON public.conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_doc_type ON public.documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_table ON public.audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_at ON public.audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_metrics_user_id ON public.fiscal_metrics(user_id);
