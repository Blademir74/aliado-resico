-- ============================================================
-- ALIADO RESICO — Script RLS DEFINITIVO v3.0 (Certificación Producción)
-- Fecha: 2026-07-18
-- Auditoría: Fix CRÍTICO-1 + CRÍTICO-3 + RLS completo
--
-- CORRECCIONES APLICADAS:
--   1. fiscal_metrics: columnas sincronizadas con store.js
--      (cumulative_income, annual_limit, risk_level)
--   2. Política DELETE añadida en fiscal_metrics (faltaba en fix anterior)
--   3. Tabla diagnostic_results con RLS (usada por FiscalWizard)
--   4. REVOKE SELECT de anon en fiscal_metrics (parche incompleto anterior)
--   5. Índice compuesto en audit_log para trazabilidad eficiente
--
-- ⚠️ EJECUTAR COMPLETO en: Supabase Dashboard → SQL Editor → Run
-- ⚠️ ESTE SCRIPT RECREA fiscal_metrics — Respaldar datos antes.
-- ============================================================

-- ============================================================
-- SECCIÓN 1: LIMPIAR TABLAS EXISTENTES (orden de dependencias)
-- ============================================================
DROP TABLE IF EXISTS public.audit_log             CASCADE;
DROP TABLE IF EXISTS public.diagnostic_results    CASCADE;
DROP TABLE IF EXISTS public.isr_rates_resico      CASCADE;
DROP TABLE IF EXISTS public.documents             CASCADE;
DROP TABLE IF EXISTS public.fiscal_metrics        CASCADE;
DROP TABLE IF EXISTS public.conversations         CASCADE;

-- ============================================================
-- SECCIÓN 2: conversations  (Cerebro de Intenciones)
--   Columnas 1:1 con store.js → upsertConversation()
-- ============================================================
CREATE TABLE public.conversations (
    id                        TEXT        PRIMARY KEY,
    user_id                   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message_text              TEXT        NOT NULL,
    sender                    TEXT        DEFAULT 'Usuario',
    intent                    TEXT        NOT NULL DEFAULT 'OTROS',
    confidence                FLOAT       DEFAULT 0,
    keywords                  TEXT[]      DEFAULT '{}',
    explanation               TEXT        DEFAULT '',
    response                  TEXT        DEFAULT '',
    source                    TEXT        DEFAULT 'local',
    is_fiscal_audit_completed BOOLEAN     DEFAULT FALSE,
    created_at                TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SECCIÓN 3: documents  (Bóveda de Evidencia IVA)
--   Columnas 1:1 con store.js → saveDocumentRemote()
--   +document_type para compatibilidad con OCR proxy
-- ============================================================
CREATE TABLE public.documents (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name         TEXT,
    doc_type          TEXT,
    document_type     TEXT,               -- alias de doc_type, requerido por OCR proxy
    file_url          TEXT,
    extracted_data    JSONB       DEFAULT '{}',
    confidence        FLOAT       DEFAULT 0,
    safety_flag       BOOLEAN     DEFAULT FALSE,
    validation_status TEXT        DEFAULT 'pendiente',
    needs_review      BOOLEAN     DEFAULT FALSE,
    source            TEXT        DEFAULT 'unknown',
    created_at        TIMESTAMPTZ DEFAULT now(),
    updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SECCIÓN 4: fiscal_metrics  (Monitor Art. 113-E LISR)
--   FIX CRÍTICO-1: columnas sincronizadas con store.js
--   store.js usa: cumulative_income, annual_limit, risk_level
-- ============================================================
CREATE TABLE public.fiscal_metrics (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    -- ↓ Nombres alineados exactamente con store.js → upsertMetrics()
    cumulative_income  NUMERIC     NOT NULL DEFAULT 0,
    annual_limit       NUMERIC     NOT NULL DEFAULT 3500000,
    risk_level         TEXT        NOT NULL DEFAULT 'SEGURO',
    -- Campos legacy mantenidos para compatibilidad
    income_ytd         NUMERIC     GENERATED ALWAYS AS (cumulative_income) STORED,
    total_processed    INTEGER     NOT NULL DEFAULT 0,
    avg_confidence     NUMERIC     NOT NULL DEFAULT 0,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Constraint: risk_level solo puede tener valores válidos
    CONSTRAINT ck_risk_level CHECK (
        risk_level IN ('SEGURO', 'PREVENTIVO', 'RIESGO_ALTO', 'EXPULSION')
    ),
    -- Constraint: límite anual no puede ser negativo ni cero
    CONSTRAINT ck_annual_limit CHECK (annual_limit > 0),
    -- Constraint: ingresos no pueden ser negativos
    CONSTRAINT ck_cumulative_income CHECK (cumulative_income >= 0)
);

-- ============================================================
-- SECCIÓN 5: diagnostic_results  (FiscalWizard Art. 113-F)
--   Nueva tabla — FiscalWizard.saveDiagnostic() la usa
-- ============================================================
CREATE TABLE public.diagnostic_results (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    income_estimated    NUMERIC     NOT NULL DEFAULT 0,
    salarios_estimated  NUMERIC     NOT NULL DEFAULT 0,  -- FIX ALTO-3
    intereses_estimated NUMERIC     NOT NULL DEFAULT 0,  -- FIX ALTO-3 (>$100k → anual)
    has_mixed_income    BOOLEAN     NOT NULL DEFAULT FALSE,
    is_socio_pm         BOOLEAN     NOT NULL DEFAULT FALSE,
    has_cfdi_global     BOOLEAN     NOT NULL DEFAULT TRUE,
    anual_obligatoria   BOOLEAN     NOT NULL DEFAULT FALSE,
    riesgo_multa        BOOLEAN     NOT NULL DEFAULT FALSE,
    recomendacion       TEXT        DEFAULT '',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- SECCIÓN 6: audit_log  (Trazabilidad — solo service_role)
--   Inmutable por diseño: solo INSERT, nunca UPDATE/DELETE
-- ============================================================
CREATE TABLE public.audit_log (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    table_name   TEXT        NOT NULL,
    record_id    TEXT        NOT NULL,
    action       TEXT        NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data     JSONB,
    new_data     JSONB,
    performed_by TEXT        DEFAULT current_user,
    performed_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SECCIÓN 7: isr_rates_resico  (Catálogo público Art. 113-E)
-- ============================================================
CREATE TABLE public.isr_rates_resico (
    id          SERIAL  PRIMARY KEY,
    lower_limit NUMERIC NOT NULL,
    upper_limit NUMERIC NOT NULL,
    rate_pct    NUMERIC NOT NULL,
    description TEXT,
    valid_from  DATE    DEFAULT '2022-01-01',
    valid_until DATE    DEFAULT '2099-12-31'
);

INSERT INTO public.isr_rates_resico (lower_limit, upper_limit, rate_pct, description) VALUES
    (0.00,       25000.00,    1.00, 'Hasta $25,000 mensuales'),
    (25000.01,   50000.00,    1.10, 'De $25,000.01 a $50,000'),
    (50000.01,   83333.33,    1.50, 'De $50,000.01 a $83,333.33'),
    (83333.34,   208333.33,   2.00, 'De $83,333.34 a $208,333.33'),
    (208333.34,  3500000.00,  2.50, 'De $208,333.34 hasta límite anual');

-- ============================================================
-- SECCIÓN 8: ACTIVAR ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_metrics     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.isr_rates_resico   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SECCIÓN 9: RLS — conversations
--   Política: auth.uid() = user_id en TODAS las operaciones
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
-- SECCIÓN 10: RLS — documents
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
-- SECCIÓN 11: RLS — fiscal_metrics
--   FIX: Incluye política DELETE (faltaba en parche anterior)
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

-- FIX: DELETE añadido para evitar registros huérfanos
CREATE POLICY "owner_delete_fiscal_metrics"
    ON public.fiscal_metrics FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- SECCIÓN 12: RLS — diagnostic_results
-- ============================================================
CREATE POLICY "service_role_all_diagnostic"
    ON public.diagnostic_results FOR ALL TO service_role
    USING (true) WITH CHECK (true);

CREATE POLICY "owner_select_diagnostic"
    ON public.diagnostic_results FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "owner_insert_diagnostic"
    ON public.diagnostic_results FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_update_diagnostic"
    ON public.diagnostic_results FOR UPDATE TO authenticated
    USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner_delete_diagnostic"
    ON public.diagnostic_results FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- ============================================================
-- SECCIÓN 13: RLS — audit_log (SOLO service_role)
-- ============================================================
CREATE POLICY "service_role_all_audit_log"
    ON public.audit_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- Bloqueo explícito: ningún usuario autenticado ni anon accede
CREATE POLICY "deny_all_authenticated_audit_log"
    ON public.audit_log FOR ALL TO authenticated
    USING (false) WITH CHECK (false);

-- ============================================================
-- SECCIÓN 14: RLS — isr_rates_resico (catálogo público)
-- ============================================================
CREATE POLICY "public_read_isr_rates"
    ON public.isr_rates_resico FOR SELECT
    TO anon, authenticated, service_role
    USING (true);

CREATE POLICY "service_role_manage_isr_rates"
    ON public.isr_rates_resico FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- ============================================================
-- SECCIÓN 15: REVOCAR permisos anon (blindaje LFPDPPP)
-- ============================================================
REVOKE ALL ON public.conversations      FROM anon;
REVOKE ALL ON public.documents          FROM anon;
REVOKE ALL ON public.fiscal_metrics     FROM anon;
REVOKE ALL ON public.audit_log          FROM anon;
REVOKE ALL ON public.diagnostic_results FROM anon;
-- Solo catálogo público permitido a anon:
GRANT SELECT ON public.isr_rates_resico TO anon;

-- ============================================================
-- SECCIÓN 16: TRIGGERS — Auditoría automática
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_log
            (user_id, table_name, record_id, action, old_data)
        VALUES
            (auth.uid(), TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_log
            (user_id, table_name, record_id, action, old_data, new_data)
        VALUES
            (auth.uid(), TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_log
            (user_id, table_name, record_id, action, new_data)
        VALUES
            (auth.uid(), TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

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
-- SECCIÓN 17: TRIGGER — updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_updated_at_fiscal
    BEFORE UPDATE ON public.fiscal_metrics
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_updated_at_documents
    BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_updated_at_diagnostic
    BEFORE UPDATE ON public.diagnostic_results
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ============================================================
-- SECCIÓN 18: REALTIME (para store.js → subscribeRealtime)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
ALTER PUBLICATION supabase_realtime ADD TABLE fiscal_metrics;

-- ============================================================
-- SECCIÓN 19: ÍNDICES DE RENDIMIENTO
-- ============================================================
CREATE INDEX idx_conversations_user_id    ON public.conversations(user_id);
CREATE INDEX idx_conversations_intent     ON public.conversations(intent);
CREATE INDEX idx_conversations_created    ON public.conversations(created_at DESC);
CREATE INDEX idx_documents_user_id        ON public.documents(user_id);
CREATE INDEX idx_documents_doc_type       ON public.documents(doc_type);
CREATE INDEX idx_documents_created        ON public.documents(created_at DESC);
CREATE INDEX idx_fiscal_user_id           ON public.fiscal_metrics(user_id);
CREATE INDEX idx_diagnostic_user_id       ON public.diagnostic_results(user_id);
CREATE INDEX idx_audit_table              ON public.audit_log(table_name);
CREATE INDEX idx_audit_performed_at       ON public.audit_log(performed_at DESC);
-- Índice compuesto para queries de trazabilidad
CREATE INDEX idx_audit_user_table         ON public.audit_log(user_id, table_name, performed_at DESC);

-- ============================================================
-- SECCIÓN 20: REFRESCAR SCHEMA CACHE
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN FINAL
-- ============================================================
SELECT
    tablename,
    policyname,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('conversations', 'documents', 'fiscal_metrics', 'diagnostic_results', 'audit_log')
ORDER BY tablename, cmd;

-- Resultado esperado por tabla:
--   conversations:      authenticated → USING(auth.uid() = user_id)
--   documents:          authenticated → USING(auth.uid() = user_id)
--   fiscal_metrics:     authenticated → USING(auth.uid() = user_id) [+ DELETE]
--   diagnostic_results: authenticated → USING(auth.uid() = user_id)
--   audit_log:          service_role only (authenticated=USING(false))
