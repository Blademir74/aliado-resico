-- ════════════════════════════════════════════════════════
-- ALIADO RESICO — RLS Definitivo v5.4
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Idempotente: puede correrse múltiples veces sin error
-- ════════════════════════════════════════════════════════

-- ─── 1. HABILITAR RLS EN TODAS LAS TABLAS ───────────────
ALTER TABLE public.conversations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_metrics   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;

-- ─── 2. ELIMINAR POLÍTICAS ANTERIORES (idempotente) ─────
DO $$ DECLARE tbl TEXT; pol TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['conversations','documents','fiscal_metrics','audit_log']
  LOOP
    FOREACH pol IN ARRAY ARRAY[
      'select_own','insert_own','update_own','delete_own',
      'user_isolation','user_isolation_insert'
    ]
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS "%s" ON public.%I', pol, tbl);
    END LOOP;
  END LOOP;
END$$;

-- ─── 3. TABLA: conversations ─────────────────────────────
-- Historial de consultas fiscales — solo el dueño las ve
CREATE POLICY "select_own" ON public.conversations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON public.conversations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE bloqueado globalmente — inmutabilidad fiscal (Art. 30 CFF)
CREATE POLICY "update_own" ON public.conversations
  FOR UPDATE USING (false);

CREATE POLICY "delete_own" ON public.conversations
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 4. TABLA: documents ────────────────────────────────
-- CFDIs y tickets OCR — solo el contribuyente accede
CREATE POLICY "select_own" ON public.documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON public.documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "delete_own" ON public.documents
  FOR DELETE USING (auth.uid() = user_id);

-- ─── 5. TABLA: fiscal_metrics ────────────────────────────
-- Monitor de ingresos Art. 113-E — dato más crítico
-- Prevención de fraude: rol `anon` no puede UPDATE ni INSERT
CREATE POLICY "select_own" ON public.fiscal_metrics
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "insert_own" ON public.fiscal_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "update_own" ON public.fiscal_metrics
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Revocar permisos al rol anon — nadie sin sesión toca las métricas
REVOKE INSERT ON public.fiscal_metrics FROM anon;
REVOKE UPDATE ON public.fiscal_metrics FROM anon;
REVOKE DELETE ON public.fiscal_metrics FROM anon;

-- ─── 6. TABLA: audit_log ────────────────────────────────
-- Trazabilidad CFF Art. 17-K — solo INSERT y SELECT propio
CREATE POLICY "insert_own" ON public.audit_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "select_own" ON public.audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- ─── 7. TRIGGER: auto-asigna user_id en INSERT ──────────
-- El frontend nunca envía user_id manualmente — imposible falsificarlo
CREATE OR REPLACE FUNCTION public.fn_set_user_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.user_id := auth.uid();
  RETURN NEW;
END;
$$;

DO $$ DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['conversations','documents','fiscal_metrics','audit_log']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_set_user_id ON public.%I', tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_set_user_id BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_set_user_id()',
      tbl
    );
  END LOOP;
END$$;

-- ─── 8. ÍNDICES DE RENDIMIENTO ──────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_user_id  ON public.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user_id      ON public.documents(user_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_metrics_user_id ON public.fiscal_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id      ON public.audit_log(user_id);

-- ─── 9. VERIFICACIÓN FINAL ──────────────────────────────
SELECT
  tablename,
  rowsecurity AS rls_activo
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('conversations','documents','fiscal_metrics','audit_log')
ORDER BY tablename;

-- Resultado esperado: rls_activo = true en las 4 tablas
-- ════════════════════════════════════════════════════════
