-- ════════════════════════════════════════════════════════════
-- ALIADO RESICO — Migración v2 (ejecutar si hay error 400)
-- Problema: la tabla fiscal_metrics puede tener columnas con
-- NOT NULL constraint sin DEFAULT, causando error 400 en upsert
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════

-- 1. Asegurar que alert_level y updated_at tengan DEFAULT
--    para que el upsert no falle cuando no se envían

ALTER TABLE public.fiscal_metrics
  ALTER COLUMN alert_level SET DEFAULT 'safe';

ALTER TABLE public.fiscal_metrics
  ALTER COLUMN updated_at SET DEFAULT NOW();

-- Si la columna updated_at no existe, crearla
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fiscal_metrics'
    AND column_name='updated_at') THEN
    ALTER TABLE public.fiscal_metrics
      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END$$;

-- 2. Asegurar que todas las columnas tengan DEFAULT o sean NULLABLE
--    para que el upsert parcial funcione

ALTER TABLE public.fiscal_metrics
  ALTER COLUMN income_ytd    SET DEFAULT 0,
  ALTER COLUMN total_processed SET DEFAULT 0,
  ALTER COLUMN avg_confidence  SET DEFAULT 0;

-- También hacer alert_level NULLABLE por si acaso
ALTER TABLE public.fiscal_metrics
  ALTER COLUMN alert_level DROP NOT NULL;

-- 3. Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.fn_update_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_timestamp ON public.fiscal_metrics;
CREATE TRIGGER trg_update_timestamp
  BEFORE UPDATE ON public.fiscal_metrics
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();

-- 4. Verificar estructura final
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'fiscal_metrics'
ORDER BY ordinal_position;
