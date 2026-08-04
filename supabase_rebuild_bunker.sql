-- ============================================================
-- ALIADO RESICO — BUNKER REBUILD v1.0
-- Fix: Error 428C9 — income_ytd GENERATED COLUMN → NUMERIC
-- Autor: Senior Architect | Fecha: 2026-08-03
-- EJECUTAR COMO: rol postgres en Supabase SQL Editor
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- BLOQUE 1: REPARAR fiscal_metrics
-- Eliminar la generated column y recrearla como NUMERIC(15,2)
-- ────────────────────────────────────────────────────────────

-- 1.1 Eliminar columna generada problemática
ALTER TABLE fiscal_metrics DROP COLUMN IF EXISTS income_ytd;

-- 1.2 Recrear como columna estándar con valor inicial 0
ALTER TABLE fiscal_metrics
  ADD COLUMN income_ytd NUMERIC(15,2) NOT NULL DEFAULT 0;

-- 1.3 Garantizar unicidad de user_id para que onConflict funcione
-- (Si ya existe el constraint, el DO NOTHING lo ignora)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fiscal_metrics_user_id_key'
  ) THEN
    ALTER TABLE fiscal_metrics ADD CONSTRAINT fiscal_metrics_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- 1.4 Asegurar columnas total_processed y avg_confidence
ALTER TABLE fiscal_metrics
  ADD COLUMN IF NOT EXISTS total_processed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE fiscal_metrics
  ADD COLUMN IF NOT EXISTS avg_confidence NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE fiscal_metrics
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 1.5 Trigger para updated_at automático
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fiscal_metrics_updated_at ON fiscal_metrics;
CREATE TRIGGER trg_fiscal_metrics_updated_at
  BEFORE UPDATE ON fiscal_metrics
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────
-- BLOQUE 2: RLS DEFINITIVO — Triple aislamiento multi-tenant
-- Cumplimiento LFPDPPP Art. 8 y 9
-- ────────────────────────────────────────────────────────────

-- 2.1 Habilitar RLS en todas las tablas críticas
ALTER TABLE conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_metrics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents        ENABLE ROW LEVEL SECURITY;

-- 2.2 Forzar RLS incluso para el propietario de la tabla
ALTER TABLE conversations    FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal_metrics   FORCE ROW LEVEL SECURITY;
ALTER TABLE documents        FORCE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- TABLA: conversations
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "conv_select_own"  ON conversations;
DROP POLICY IF EXISTS "conv_insert_own"  ON conversations;
DROP POLICY IF EXISTS "conv_update_own"  ON conversations;
DROP POLICY IF EXISTS "conv_delete_own"  ON conversations;

CREATE POLICY "conv_select_own"
  ON conversations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "conv_insert_own"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conv_update_own"
  ON conversations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conv_delete_own"
  ON conversations FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- TABLA: fiscal_metrics
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "fm_select_own"  ON fiscal_metrics;
DROP POLICY IF EXISTS "fm_insert_own"  ON fiscal_metrics;
DROP POLICY IF EXISTS "fm_update_own"  ON fiscal_metrics;
DROP POLICY IF EXISTS "fm_delete_own"  ON fiscal_metrics;

CREATE POLICY "fm_select_own"
  ON fiscal_metrics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "fm_insert_own"
  ON fiscal_metrics FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "fm_update_own"
  ON fiscal_metrics FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "fm_delete_own"
  ON fiscal_metrics FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- TABLA: documents
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "doc_select_own"  ON documents;
DROP POLICY IF EXISTS "doc_insert_own"  ON documents;
DROP POLICY IF EXISTS "doc_update_own"  ON documents;
DROP POLICY IF EXISTS "doc_delete_own"  ON documents;

CREATE POLICY "doc_select_own"
  ON documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "doc_insert_own"
  ON documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "doc_update_own"
  ON documents FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "doc_delete_own"
  ON documents FOR DELETE
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- BLOQUE 3: BLINDAJE — Revocar acceso del rol anon
-- Protección patrimonial LFPDPPP Art. 19
-- ────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE conversations   FROM anon;
REVOKE ALL ON TABLE fiscal_metrics  FROM anon;
REVOKE ALL ON TABLE documents       FROM anon;

-- Solo authenticated puede operar (RLS filtra por uid)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE conversations   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fiscal_metrics  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE documents       TO authenticated;

-- ────────────────────────────────────────────────────────────
-- BLOQUE 4: VERIFICACIÓN POST-MIGRACIÓN
-- ────────────────────────────────────────────────────────────
SELECT
  column_name,
  data_type,
  column_default,
  is_generated
FROM information_schema.columns
WHERE table_name = 'fiscal_metrics'
ORDER BY ordinal_position;

-- Verificar políticas activas
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename IN ('conversations', 'fiscal_metrics', 'documents')
ORDER BY tablename, policyname;

COMMIT;

-- ✅ Si no hay errores: income_ytd es ahora NUMERIC(15,2) estándar
-- ✅ UNIQUE constraint en user_id activo para onConflict
-- ✅ RLS con auth.uid() activo en 3 tablas
-- ✅ Rol anon sin acceso a datos patrimoniales