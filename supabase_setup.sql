-- ════════════════════════════════════════════════════════════
-- ALIADO RESICO — Setup Completo de Base de Datos v6.3
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Incluye: CREATE TABLES + RLS + POLICIES + INDEXES + TRIGGERS
-- Idempotente: se puede correr múltiples veces sin error
-- ════════════════════════════════════════════════════════════

-- ─── 1. TABLAS ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.conversations (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  sender        TEXT DEFAULT 'Usuario',
  time          TEXT,
  intent        TEXT,
  confidence    NUMERIC(4,3),
  keywords      JSONB DEFAULT '[]',
  explanation   TEXT,
  response      TEXT,
  source        TEXT DEFAULT 'local',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name        TEXT,
  doc_type         TEXT,
  extracted_data   JSONB,
  confidence       NUMERIC(4,3),
  needs_review     BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fiscal_metrics (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  income_ytd         NUMERIC(15,2) DEFAULT 0,
  total_processed    INTEGER DEFAULT 0,
  by_category        JSONB DEFAULT '{}',
  avg_confidence     NUMERIC(4,3) DEFAULT 0,
  monthly_status     JSONB DEFAULT '{}',
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  details    JSONB,
  ip_hash    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. HABILITAR RLS ────────────────────────────────────

ALTER TABLE public.conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log       ENABLE ROW LEVEL SECURITY;

-- ─── 3. ELIMINAR POLÍTICAS ANTERIORES (idempotente) ──────

DO $$ DECLARE tbl TEXT; pol TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['conversations','documents','fiscal_metrics','audit_log'] LOOP
    FOREACH pol IN ARRAY ARRAY['select_own','insert_own','update_own','delete_own','user_isolation','user_isolation_insert'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%s" ON public.%I', pol, tbl);
    END LOOP;
  END LOOP;
END$$;

-- ─── 4. POLÍTICAS — conversations ────────────────────────

CREATE POLICY "select_own" ON public.conversations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE bloqueado: trazabilidad fiscal (Art. 30 CFF)
CREATE POLICY "update_own" ON public.conversations
  FOR UPDATE USING (false);

CREATE POLICY "delete_own" ON public.conversations
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 5. POLÍTICAS — documents ────────────────────────────

CREATE POLICY "select_own" ON public.documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own" ON public.documents
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 6. POLÍTICAS — fiscal_metrics (anti-fraude) ─────────

CREATE POLICY "select_own" ON public.fiscal_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON public.fiscal_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own" ON public.fiscal_metrics
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- REVOKE al rol anon: nadie sin sesión puede modificar métricas fiscales
REVOKE INSERT ON public.fiscal_metrics FROM anon;
REVOKE UPDATE ON public.fiscal_metrics FROM anon;
REVOKE DELETE ON public.fiscal_metrics FROM anon;

-- ─── 7. POLÍTICAS — audit_log ────────────────────────────

CREATE POLICY "insert_own" ON public.audit_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "select_own" ON public.audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- ─── 8. TRIGGER: auto-asignar user_id ────────────────────

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

-- ─── 9. ÍNDICES ──────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_conv_user_id     ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_created     ON public.conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_docs_user_id     ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_user_id  ON public.fiscal_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id    ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created    ON public.audit_log(created_at DESC);

-- ─── 10. VERIFICACIÓN ────────────────────────────────────

SELECT
  t.tablename,
  t.rowsecurity AS rls_activo,
  COUNT(p.policyname) AS num_politicas
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = 'public'
WHERE t.schemaname = 'public'
  AND t.tablename IN ('conversations','documents','fiscal_metrics','audit_log')
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.tablename;

-- Resultado esperado:
-- conversations  | rls_activo: true | num_politicas: 4
-- documents      | rls_activo: true | num_politicas: 3
-- fiscal_metrics | rls_activo: true | num_politicas: 3
-- audit_log      | rls_activo: true | num_politicas: 2
