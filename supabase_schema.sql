-- ============================================================
-- ALIADO RESICO — Supabase Schema + Row Level Security (RLS)
-- Producción — Script limpio DROP + CREATE
-- Cumplimiento: CFF Art. 17-K, LISR Art. 113-E
-- ============================================================
-- ⚠️ ESTE SCRIPT ELIMINA Y RECREA TODAS LAS TABLAS
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- ============================================================
-- 1. LIMPIAR TABLAS EXISTENTES (orden: dependencias primero)
-- ============================================================

DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.isr_rates_resico CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.fiscal_metrics CASCADE;
DROP TABLE IF EXISTS public.conversations CASCADE;

-- ============================================================
-- 2. TABLA: conversations
-- Columnas alineadas con store.js → upsertConversation()
-- ============================================================

CREATE TABLE public.conversations (
    id           TEXT PRIMARY KEY,
    text         TEXT NOT NULL,
    sender       TEXT DEFAULT 'Usuario',
    time         TEXT,
    intent       TEXT NOT NULL,
    confidence   FLOAT,
    keywords     TEXT[],
    explanation  TEXT,
    response     TEXT,
    source       TEXT DEFAULT 'telegram',
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. TABLA: documents
-- Columnas alineadas con store.js → saveDocument()
-- ============================================================

CREATE TABLE public.documents (
    id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    file_name           TEXT,
    doc_type            TEXT,
    extracted_data      JSONB,
    confidence          FLOAT,
    validation_status   TEXT DEFAULT 'pendiente',
    needs_review        BOOLEAN DEFAULT FALSE,
    source              TEXT DEFAULT 'unknown',
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. TABLA: fiscal_metrics
-- Columnas alineadas con store.js → syncMetricsToSupabase()
-- ============================================================

CREATE TABLE public.fiscal_metrics (
    id               TEXT PRIMARY KEY DEFAULT 'primary',
    income_ytd       NUMERIC DEFAULT 0,
    total_processed  INT DEFAULT 0,
    by_category      JSONB DEFAULT '{}',
    avg_confidence   FLOAT DEFAULT 0,
    updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. TABLA: audit_log (Integridad CFF)
-- ============================================================

CREATE TABLE public.audit_log (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_name    TEXT NOT NULL,
    record_id     TEXT NOT NULL,
    action        TEXT NOT NULL,
    old_data      JSONB,
    new_data      JSONB,
    performed_by  TEXT DEFAULT current_user,
    performed_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. TABLA: isr_rates_resico (Art. 113-E LISR)
-- ============================================================

CREATE TABLE public.isr_rates_resico (
    id          SERIAL PRIMARY KEY,
    lower_limit NUMERIC NOT NULL,
    upper_limit NUMERIC NOT NULL,
    rate_pct    NUMERIC NOT NULL,
    description TEXT,
    valid_from  DATE DEFAULT '2022-01-01',
    valid_until DATE DEFAULT '2099-12-31'
);

INSERT INTO public.isr_rates_resico (lower_limit, upper_limit, rate_pct, description) VALUES
    (0.00,       25000.00,    1.00, 'Hasta $25,000 mensuales'),
    (25000.01,   50000.00,    1.10, 'De $25,000.01 a $50,000'),
    (50000.01,   83333.33,    1.50, 'De $50,000.01 a $83,333.33'),
    (83333.34,   208333.33,   2.00, 'De $83,333.34 a $208,333.33'),
    (208333.34,  3500000.00,  2.50, 'De $208,333.34 hasta límite anual');

-- ============================================================
-- 7. ENABLE ROW LEVEL SECURITY (todas las tablas)
-- ============================================================

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isr_rates_resico ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. RLS — conversations
-- anon: leer + insertar (frontend usa anon key)
-- service_role: acceso total (n8n backend)
-- ============================================================

CREATE POLICY "service_role_all_conversations"
    ON public.conversations FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "anon_select_conversations"
    ON public.conversations FOR SELECT TO anon
    USING (true);

CREATE POLICY "anon_insert_conversations"
    ON public.conversations FOR INSERT TO anon
    WITH CHECK (true);

-- anon NO puede UPDATE ni DELETE
CREATE POLICY "anon_no_update_conversations"
    ON public.conversations FOR UPDATE TO anon
    USING (false) WITH CHECK (false);

CREATE POLICY "anon_no_delete_conversations"
    ON public.conversations FOR DELETE TO anon
    USING (false);

-- ============================================================
-- 9. RLS — documents
-- anon: leer + insertar (frontend sube documentos OCR)
-- ============================================================

CREATE POLICY "service_role_all_documents"
    ON public.documents FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "anon_select_documents"
    ON public.documents FOR SELECT TO anon
    USING (true);

CREATE POLICY "anon_insert_documents"
    ON public.documents FOR INSERT TO anon
    WITH CHECK (true);

CREATE POLICY "anon_no_update_documents"
    ON public.documents FOR UPDATE TO anon
    USING (false) WITH CHECK (false);

CREATE POLICY "anon_no_delete_documents"
    ON public.documents FOR DELETE TO anon
    USING (false);

-- ============================================================
-- 10. RLS — fiscal_metrics
-- anon: leer + upsert (dashboard necesita leer/escribir métricas)
-- ============================================================

CREATE POLICY "service_role_all_fiscal_metrics"
    ON public.fiscal_metrics FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "anon_select_fiscal_metrics"
    ON public.fiscal_metrics FOR SELECT TO anon
    USING (true);

CREATE POLICY "anon_insert_fiscal_metrics"
    ON public.fiscal_metrics FOR INSERT TO anon
    WITH CHECK (true);

CREATE POLICY "anon_no_update_fiscal_metrics"
    ON public.fiscal_metrics FOR UPDATE TO anon
    USING (false) WITH CHECK (false);

-- ============================================================
-- 11. RLS — audit_log (solo service_role)
-- ============================================================

CREATE POLICY "service_role_all_audit_log"
    ON public.audit_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "anon_no_access_audit_log"
    ON public.audit_log FOR ALL TO anon
    USING (false) WITH CHECK (false);

-- ============================================================
-- 12. RLS — isr_rates_resico (lectura pública)
-- ============================================================

CREATE POLICY "public_read_isr_rates"
    ON public.isr_rates_resico FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

CREATE POLICY "service_role_manage_isr_rates"
    ON public.isr_rates_resico FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 13. TRIGGER DE AUDITORÍA
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

CREATE TRIGGER trg_audit_conversations
    AFTER INSERT OR UPDATE OR DELETE ON public.conversations
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_documents
    AFTER INSERT OR UPDATE OR DELETE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

CREATE TRIGGER trg_audit_fiscal_metrics
    AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_metrics
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- ============================================================
-- 14. ENABLE REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE documents;

-- ============================================================
-- 15. ÍNDICES DE RENDIMIENTO
-- ============================================================

CREATE INDEX idx_conversations_intent ON public.conversations(intent);
CREATE INDEX idx_conversations_created_at ON public.conversations(created_at DESC);
CREATE INDEX idx_documents_doc_type ON public.documents(doc_type);
CREATE INDEX idx_audit_log_table ON public.audit_log(table_name);
CREATE INDEX idx_audit_log_performed_at ON public.audit_log(performed_at DESC);

-- ============================================================
-- 16. REFRESCAR SCHEMA CACHE
-- ============================================================

NOTIFY pgrst, 'reload schema';
