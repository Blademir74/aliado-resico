-- ════════════════════════════════════════════════════════════
-- ALIADO RESICO — Setup Completo v6.4
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Idempotente: puede correrse múltiples veces sin error
-- COLUMNAS EXACTAS que usa el código JS:
--   fiscal_metrics: user_id, income_ytd, total_processed, avg_confidence
-- ════════════════════════════════════════════════════════════

-- ─── 1. CREAR TABLAS ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversations (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  text        TEXT        NOT NULL,
  sender      TEXT        DEFAULT 'Usuario',
  time        TEXT,
  intent      TEXT,
  confidence  NUMERIC(4,3),
  keywords    JSONB       DEFAULT '[]',
  explanation TEXT,
  response    TEXT,
  source      TEXT        DEFAULT 'local',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name      TEXT,
  doc_type       TEXT,
  extracted_data JSONB,
  confidence     NUMERIC(4,3),
  needs_review   BOOLEAN     DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- fiscal_metrics: SOLO estas 3 columnas de métricas
-- NO by_category, NO updated_at — el código JS no las usa en upsert
CREATE TABLE IF NOT EXISTS public.fiscal_metrics (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  income_ytd       NUMERIC(15,2) DEFAULT 0,
  total_processed  INTEGER     DEFAULT 0,
  avg_confidence   NUMERIC(4,3) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  action     TEXT        NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. MIGRACIÓN: Si fiscal_metrics ya existe con otras columnas ──

-- Agregar columnas faltantes si no existen (idempotente)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='fiscal_metrics' AND column_name='income_ytd') THEN
    ALTER TABLE public.fiscal_metrics ADD COLUMN income_ytd NUMERIC(15,2) DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='fiscal_metrics' AND column_name='total_processed') THEN
    ALTER TABLE public.fiscal_metrics ADD COLUMN total_processed INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='fiscal_metrics' AND column_name='avg_confidence') THEN
    ALTER TABLE public.fiscal_metrics ADD COLUMN avg_confidence NUMERIC(4,3) DEFAULT 0;
  END IF;
END$$;

-- ─── 3. HABILITAR RLS ─────────────────────────────────────

ALTER TABLE public.conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log       ENABLE ROW LEVEL SECURITY;

-- ─── 4. LIMPIAR POLÍTICAS ANTERIORES ──────────────────────

DO $$ DECLARE tbl TEXT; pol TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['conversations','documents','fiscal_metrics','audit_log'] LOOP
    FOREACH pol IN ARRAY ARRAY['select_own','insert_own','update_own','delete_own','user_isolation'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%s" ON public.%I', pol, tbl);
    END LOOP;
  END LOOP;
END$$;

-- ─── 5. POLÍTICAS RLS ─────────────────────────────────────

-- conversations
CREATE POLICY "select_own" ON public.conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON public.conversations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own" ON public.conversations FOR UPDATE USING (false); -- inmutabilidad fiscal
CREATE POLICY "delete_own" ON public.conversations FOR DELETE USING (auth.uid() = user_id);

-- documents
CREATE POLICY "select_own" ON public.documents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON public.documents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own" ON public.documents FOR DELETE USING (auth.uid() = user_id);

-- fiscal_metrics — anti-fraude: anon no puede modificar ingresos
CREATE POLICY "select_own" ON public.fiscal_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert_own" ON public.fiscal_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own" ON public.fiscal_metrics FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE INSERT ON public.fiscal_metrics FROM anon;
REVOKE UPDATE ON public.fiscal_metrics FROM anon;
REVOKE DELETE ON public.fiscal_metrics FROM anon;

-- audit_log
CREATE POLICY "insert_own" ON public.audit_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "select_own" ON public.audit_log FOR SELECT USING (auth.uid() = user_id);

-- ─── 6. TRIGGER user_id ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_set_user_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN NEW.user_id := auth.uid(); RETURN NEW; END;
$$;

DO $$ DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['conversations','documents','fiscal_metrics','audit_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_user_id ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_set_user_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_set_user_id()', tbl);
  END LOOP;
END$$;

-- ─── 7. ÍNDICES ───────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_conv_user_created ON public.conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_user_id      ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_user_id   ON public.fiscal_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id     ON public.audit_log(user_id);

-- ─── 8. VERIFICACIÓN ──────────────────────────────────────

SELECT
  t.tablename,
  t.rowsecurity AS rls,
  array_agg(p.policyname ORDER BY p.policyname) AS politicas
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename IN ('conversations','documents','fiscal_metrics','audit_log')
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.tablename;

-- Verificar columnas de fiscal_metrics
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'fiscal_metrics' AND table_schema = 'public'
ORDER BY ordinal_position;
