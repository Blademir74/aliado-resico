-- ════════════════════════════════════════════════════════════
-- ALIADO RESICO — Fix fiscal_metrics DEFINITIVO
-- Error: no unique or exclusion constraint matching
--        the ON CONFLICT specification (código 42P10)
-- Causa: la tabla no tiene columna user_id ni UNIQUE en ella
--
-- EJECUTAR COMPLETO en Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- Paso 1: Eliminar la tabla vieja con todas sus dependencias
DROP TABLE IF EXISTS public.fiscal_metrics CASCADE;

-- Paso 2: Crear con schema correcto — user_id UNIQUE es obligatorio
CREATE TABLE public.fiscal_metrics (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  income_ytd      NUMERIC     NOT NULL DEFAULT 0,
  total_processed INTEGER     NOT NULL DEFAULT 0,
  avg_confidence  NUMERIC     NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Paso 3: Row Level Security
ALTER TABLE public.fiscal_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own" ON public.fiscal_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON public.fiscal_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own" ON public.fiscal_metrics
  FOR UPDATE USING  (auth.uid() = user_id)
  WITH CHECK        (auth.uid() = user_id);

-- Paso 4: Revocar acceso anon a datos fiscales
REVOKE INSERT ON public.fiscal_metrics FROM anon;
REVOKE UPDATE ON public.fiscal_metrics FROM anon;
REVOKE DELETE ON public.fiscal_metrics FROM anon;

-- Paso 5: Trigger para updated_at automático
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

-- Paso 6: Índice de rendimiento
CREATE INDEX idx_fiscal_user_id ON public.fiscal_metrics(user_id);

-- Paso 7: Verificación final — muestra la estructura
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'fiscal_metrics'
ORDER BY ordinal_position;

-- Resultado esperado:
-- id              | uuid    | NO | gen_random_uuid()
-- user_id         | uuid    | NO | (ninguno)
-- income_ytd      | numeric | NO | 0
-- total_processed | integer | NO | 0
-- avg_confidence  | numeric | NO | 0
-- updated_at      | timestamp | NO | now()
