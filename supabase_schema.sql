-- ============================================================
-- ALIADO RESICO — Supabase Schema + Row Level Security (RLS)
-- Versión 2.0 — Producción blindada (2026)
-- Cumplimiento: LFPDPPP | CFF Art. 17-K, 17-D, 86-C | LISR Art. 113-E, 113-F
--
-- ⚠️ POLÍTICA DE SEGURIDAD:
--   Aislamiento multi-tenant estricto: auth.uid() = user_id en TODAS
--   las tablas con datos fiscales. El rol `anon` NO tiene acceso a
--   conversaciones ni métricas (solo puede leer catálogos públicos).
--   Esto sustituye al esquema anterior que daba USING(true) a anon.
--
-- ⚠️ ESTE SCRIPT ELIMINA Y RECREA LAS TABLAS FISCALES.
--   Ejecutar en: Supabase Dashboard → SQL Editor → Run.
-- ============================================================

-- ============================================================
-- 1. LIMPIAR TABLAS EXISTENTES (orden: dependencias primero)
-- ============================================================
DROP TABLE IF EXISTS public.audit_log       CASCADE;
DROP TABLE IF EXISTS public.isr_rates_resico CASCADE;
DROP TABLE IF EXISTS public.documents        CASCADE;
DROP TABLE IF EXISTS public.fiscal_metrics   CASCADE;
DROP TABLE IF EXISTS public.conversations    CASCADE;

-- ============================================================
-- 2. TABLA: conversations  (Cerebro de Intenciones)
--    Columnas alineadas 1:1 con js/store.js → _upsertConv()
--    y js/auth.js → _injectWelcomeMessage.
--    Importante: message_text (NO "text") + user_id + is_fiscal_audit_completed.
-- ============================================================
CREATE TABLE public.conversations (
    id                            TEXT PRIMARY KEY,
    user_id                       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_text                  TEXT NOT NULL,
    sender                        TEXT DEFAULT 'Usuario',
    time                          TEXT,
    intent                        TEXT NOT NULL,
    confidence                    FLOAT DEFAULT 0,
    keywords                      TEXT[] DEFAULT '{}',
    explanation                   TEXT DEFAULT '',
    response                      TEXT DEFAULT '',
    source                        TEXT DEFAULT 'local',
    is_fiscal_audit_completed     BOOLEAN DEFAULT FALSE,
    created_at                    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. TABLA: documents  (Bóveda de Evidencia IVA)
--    Alineada con store.js → saveDocument() y ocr.js.
--    user_id obligatorio para que el RLS aísle cada contribuyente.
-- ============================================================
CREATE TABLE public.documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name       TEXT,
    doc_type        TEXT,
    extracted_data  JSONB DEFAULT '{}',
    confidence      FLOAT DEFAULT 0,
    safety_flag     BOOLEAN DEFAULT FALSE,   -- OCR < 85% → requiere verificación humana
    validation_status TEXT DEFAULT 'pendiente',
    needs_review    BOOLEAN DEFAULT FALSE,
    source          TEXT DEFAULT 'unknown',
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. TABLA: fiscal_metrics  (Monitor Art. 113-E LISR)
--    user_id UNIQUE → el onConflict:'user_id' del store.js funciona.
--    CRÍTICO: control del límite de $3,500,000 MXN.
-- ============================================================
CREATE TABLE public.fiscal_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    income_ytd      NUMERIC NOT NULL DEFAULT 0,
    total_processed INTEGER NOT NULL DEFAULT 0,
    avg_confidence  NUMERIC NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. TABLA: audit_log  (Trazabilidad — solo service_role)
-- ============================================================
CREATE TABLE public.audit_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    table_name    TEXT NOT NULL,
    record_id     TEXT NOT NULL,
    action        TEXT NOT NULL,
    old_data      JSONB,
    new_data      JSONB,
    performed_by  TEXT DEFAULT current_user,
    performed_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. TABLA: isr_rates_resico  (Catálogo público Art. 113-E LISR)
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
-- 7. ACTIVAR ROW LEVEL SECURITY EN TODAS LAS TABLAS
-- ============================================================
ALTER TABLE public.conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isr_rates_resico ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 8. RLS — conversations  (auth.uid() = user_id)
--    El contribuyente SOLO ve/edita SUS conversaciones.
--    service_role (n8n backend) tiene acceso total.
-- ============================================================
CREATE POLICY "service_role_all_conversations"
    ON public.conversations FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "owner_select_conversations"
    ON public.conversations FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "owner_insert_conversations"
    ON public.conversations FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update_conversations"
    ON public.conversations FOR UPDATE TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_delete_conversations"
    ON public.conversations FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- 9. RLS — documents  (auth.uid() = user_id)
-- ============================================================
CREATE POLICY "service_role_all_documents"
    ON public.documents FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "owner_select_documents"
    ON public.documents FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "owner_insert_documents"
    ON public.documents FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update_documents"
    ON public.documents FOR UPDATE TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_delete_documents"
    ON public.documents FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- 10. RLS — fiscal_metrics  (auth.uid() = user_id)
--     Restricción de métricas para evitar fraude: el contribuyente
--     no puede inyectar ingresos falsos en otro monitor.
-- ============================================================
CREATE POLICY "service_role_all_fiscal_metrics"
    ON public.fiscal_metrics FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "owner_select_fiscal_metrics"
    ON public.fiscal_metrics FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "owner_insert_fiscal_metrics"
    ON public.fiscal_metrics FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update_fiscal_metrics"
    ON public.fiscal_metrics FOR UPDATE TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 11. RLS — audit_log  (solo service_role; el usuario no lo ve)
-- ============================================================
CREATE POLICY "service_role_all_audit_log"
    ON public.audit_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "no_anon_access_audit_log"
    ON public.audit_log FOR ALL TO authenticated
    USING (false) WITH CHECK (false);

-- ============================================================
-- 12. RLS — isr_rates_resico  (catálogo de lectura pública)
-- ============================================================
CREATE POLICY "public_read_isr_rates"
    ON public.isr_rates_resico FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

CREATE POLICY "service_role_manage_isr_rates"
    ON public.isr_rates_resico FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- 13. REVOCAR PERMISOS PELIGROSOS A anon
--     (blindaje LFPDPPP — el frontend usa `authenticated`, no anon)
-- ============================================================
REVOKE ALL ON public.conversations   FROM anon;
REVOKE ALL ON public.documents       FROM anon;
REVOKE ALL ON public.fiscal_metrics  FROM anon;
REVOKE ALL ON public.audit_log       FROM anon;
GRANT  SELECT ON public.isr_rates_resico TO anon;

-- ============================================================
-- 14. TRIGGER DE AUDITORÍA  (trazabilidad para defensa del contribuyente)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_log (user_id, table_name, record_id, action, old_data)
        VALUES (auth.uid(), TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_log (user_id, table_name, record_id, action, old_data, new_data)
        VALUES (auth.uid(), TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_log (user_id, table_name, record_id, action, new_data)
        VALUES (auth.uid(), TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', to_jsonb(NEW));
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
-- 15. TRIGGER updated_at automático en fiscal_metrics
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_fiscal_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_fiscal_updated
  BEFORE UPDATE ON public.fiscal_metrics
  FOR EACH ROW EXECUTE FUNCTION public.fn_fiscal_updated_at();

-- ============================================================
-- 16. ENABLE REALTIME  (conversaciones y documentos por usuario)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
ALTER PUBLICATION supabase_realtime ADD TABLE fiscal_metrics;

-- ============================================================
-- 17. ÍNDICES DE RENDIMIENTO
-- ============================================================
CREATE INDEX idx_conversations_user_id    ON public.conversations(user_id);
CREATE INDEX idx_conversations_intent      ON public.conversations(intent);
CREATE INDEX idx_conversations_created_at  ON public.conversations(created_at DESC);
CREATE INDEX idx_documents_user_id         ON public.documents(user_id);
CREATE INDEX idx_documents_doc_type        ON public.documents(doc_type);
CREATE INDEX idx_fiscal_user_id            ON public.fiscal_metrics(user_id);
CREATE INDEX idx_audit_log_table           ON public.audit_log(table_name);
CREATE INDEX idx_audit_log_performed_at    ON public.audit_log(performed_at DESC);

-- ============================================================
-- 18. REFRESCAR SCHEMA CACHE
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN — las políticas deberían verse así:
--   conversations  → authenticated USING (auth.uid() = user_id)
--   fiscal_metrics → authenticated USING (auth.uid() = user_id)
--   documents      → authenticated USING (auth.uid() = user_id)
--   audit_log      → solo service_role
--   isr_rates      → lectura pública
-- ============================================================
