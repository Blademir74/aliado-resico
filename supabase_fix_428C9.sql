-- ============================================================
-- ALIADO RESICO — CIRUGÍA SQL: Error 428C9 / fiscal_metrics
-- Versión: 2026-PROD-v4.1
-- Fecha   : 2026-07-27
-- Cumplimiento: LISR 2026 Art.113-E | CFF Art.17-D, 17-K | LFPDPPP
--
-- PROBLEMA DETECTADO (error 428C9):
--   income_ytd era una GENERATED COLUMN en producción.
--   PostgreSQL lanza "428C9: column 'income_ytd' is a generated column"
--   cuando store.js intenta hacer un upsert manual sobre ella.
--
-- SOLUCIÓN:
--   1. Recrear fiscal_metrics sin columna generada.
--   2. Garantizar UNIQUE(user_id) para ON CONFLICT funcione.
--   3. RLS definitivo: auth.uid() = user_id en SELECT/INSERT/UPDATE/DELETE.
--   4. Revocar todos los permisos al rol anon (blindaje LFPDPPP).
--
-- INSTRUCCIONES:
--   Supabase Dashboard → SQL Editor → pegar → Run
-- ============================================================

-- PASO 0: SALVAGUARDA (descomenta si tienes datos en producción)
-- CREATE TABLE IF NOT EXISTS public._bak_fiscal_metrics_20260727
--   AS SELECT * FROM public.fiscal_metrics;

-- PASO 1: Eliminar triggers y tabla con cascade
DROP TRIGGER IF EXISTS trg_fiscal_updated       ON public.fiscal_metrics;
DROP TRIGGER IF EXISTS trg_audit_fiscal_metrics  ON public.fiscal_metrics;
DROP TABLE  IF EXISTS public.fiscal_metrics      CASCADE;

-- PASO 2: Recrear fiscal_metrics
--   income_ytd = NUMERIC(15,2) DEFAULT 0 — NO GENERATED
--   user_id UNIQUE — permite ON CONFLICT('user_id')
CREATE TABLE public.fiscal_metrics (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL UNIQUE
                                    REFERENCES auth.users(id) ON DELETE CASCADE,
    income_ytd      NUMERIC(15, 2)  NOT NULL DEFAULT 0,
    total_processed INTEGER         NOT NULL DEFAULT 0,
    avg_confidence  NUMERIC(5,  2)  NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.fiscal_metrics.income_ytd
  IS 'Ingresos YTD — columna mutable (NO GENERATED). Upsert libre desde frontend.';

-- PASO 3: Trigger updated_at
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

-- PASO 4: Habilitar RLS
ALTER TABLE public.fiscal_metrics ENABLE ROW LEVEL SECURITY;

-- PASO 5: Limpiar políticas anteriores (idempotencia)
DROP POLICY IF EXISTS "service_role_all_fiscal_metrics" ON public.fiscal_metrics;
DROP POLICY IF EXISTS "owner_select_fiscal_metrics"     ON public.fiscal_metrics;
DROP POLICY IF EXISTS "owner_insert_fiscal_metrics"     ON public.fiscal_metrics;
DROP POLICY IF EXISTS "owner_update_fiscal_metrics"     ON public.fiscal_metrics;
DROP POLICY IF EXISTS "owner_delete_fiscal_metrics"     ON public.fiscal_metrics;

-- PASO 6: Políticas RLS definitivas

-- service_role: acceso total (n8n, workers internos)
CREATE POLICY "service_role_all_fiscal_metrics"
    ON public.fiscal_metrics FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- SELECT: solo la fila propia
CREATE POLICY "owner_select_fiscal_metrics"
    ON public.fiscal_metrics FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- INSERT: solo para sí mismo
CREATE POLICY "owner_insert_fiscal_metrics"
    ON public.fiscal_metrics FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- UPDATE: solo su fila
CREATE POLICY "owner_update_fiscal_metrics"
    ON public.fiscal_metrics FOR UPDATE TO authenticated
    USING     (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- DELETE: permite reset de métricas propias
CREATE POLICY "owner_delete_fiscal_metrics"
    ON public.fiscal_metrics FOR DELETE TO authenticated
    USING (auth.uid() = user_id);

-- PASO 7: Revocar permisos a anon (blindaje LFPDPPP)
REVOKE ALL PRIVILEGES ON public.fiscal_metrics FROM anon;
REVOKE ALL PRIVILEGES ON public.conversations  FROM anon;
REVOKE ALL PRIVILEGES ON public.documents      FROM anon;
REVOKE ALL PRIVILEGES ON public.audit_log      FROM anon;
-- Solo el catálogo de tasas ISR es público
GRANT SELECT ON public.isr_rates_resico TO anon;

-- PASO 8: Índice de rendimiento
CREATE INDEX IF NOT EXISTS idx_fiscal_user_id
    ON public.fiscal_metrics(user_id);

-- PASO 9: Agregar a Realtime (manejo idempotente de duplicados)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.fiscal_metrics;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

-- PASO 10: Trigger de auditoría
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_log(user_id,table_name,record_id,action,old_data)
        VALUES (auth.uid(),TG_TABLE_NAME,OLD.id::TEXT,'DELETE',to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.audit_log(user_id,table_name,record_id,action,old_data,new_data)
        VALUES (auth.uid(),TG_TABLE_NAME,NEW.id::TEXT,'UPDATE',to_jsonb(OLD),to_jsonb(NEW));
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_log(user_id,table_name,record_id,action,new_data)
        VALUES (auth.uid(),TG_TABLE_NAME,NEW.id::TEXT,'INSERT',to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_audit_fiscal_metrics
    AFTER INSERT OR UPDATE OR DELETE ON public.fiscal_metrics
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- PASO 11: Refrescar schema cache de PostgREST
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACIÓN FINAL — ejecuta estas queries por separado:
--
-- SELECT column_name, data_type, column_default, is_generated
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'fiscal_metrics';
-- -- income_ytd debe mostrar is_generated = 'NEVER'
--
-- SELECT policyname, cmd, roles::text
-- FROM pg_policies
-- WHERE tablename = 'fiscal_metrics';
-- ============================================================
