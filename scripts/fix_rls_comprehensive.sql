-- ============================================================
-- Fix RLS complet — Politiques manquantes pour toutes les tables
-- À exécuter dans le SQL Editor du dashboard Supabase
-- ============================================================
-- Chaque bloc est indépendant. Exécuter bloc par bloc.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- BLOC 1 : Fonctions helper RLS (vérifier qu'elles existent)
-- ════════════════════════════════════════════════════════════

-- Vérifier les fonctions existantes
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('auth_user_org', 'auth_user_role', 'auth_user_name')
ORDER BY routine_name;

-- Si auth_user_org n'existe pas, la créer :
CREATE OR REPLACE FUNCTION public.auth_user_org()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Si auth_user_role n'existe pas, la créer :
CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Si auth_user_name n'existe pas, la créer :
CREATE OR REPLACE FUNCTION public.auth_user_name()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- ════════════════════════════════════════════════════════════
-- BLOC 2 : RESERVES — Politiques manquantes
-- ════════════════════════════════════════════════════════════

-- Vérifier les politiques existantes
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'reserves'
ORDER BY cmd;

-- INSERT : admin/super_admin de l'org + conducteur/chef_equipe peuvent créer
CREATE POLICY "reserves_insert"
  ON public.reserves FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- SELECT : membres de l'org + super_admin
CREATE POLICY "reserves_select"
  ON public.reserves FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

-- UPDATE : admin/super_admin/conducteur de l'org
CREATE POLICY "reserves_update"
  ON public.reserves FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- DELETE : admin/super_admin de l'org
CREATE POLICY "reserves_delete"
  ON public.reserves FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 3 : TASKS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'tasks'
ORDER BY cmd;

CREATE POLICY "tasks_insert"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "tasks_select"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "tasks_update"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "tasks_delete"
  ON public.tasks FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 4 : CHANTIERS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'chantiers'
ORDER BY cmd;

CREATE POLICY "chantiers_insert"
  ON public.chantiers FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "chantiers_select"
  ON public.chantiers FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "chantiers_update"
  ON public.chantiers FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "chantiers_delete"
  ON public.chantiers FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 5 : SITE_PLANS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'site_plans'
ORDER BY cmd;

CREATE POLICY "site_plans_insert"
  ON public.site_plans FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "site_plans_select"
  ON public.site_plans FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "site_plans_update"
  ON public.site_plans FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "site_plans_delete"
  ON public.site_plans FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 6 : VISITES — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'visites'
ORDER BY cmd;

CREATE POLICY "visites_insert"
  ON public.visites FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "visites_select"
  ON public.visites FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "visites_update"
  ON public.visites FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "visites_delete"
  ON public.visites FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 7 : LOTS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'lots'
ORDER BY cmd;

CREATE POLICY "lots_insert"
  ON public.lots FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "lots_select"
  ON public.lots FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "lots_update"
  ON public.lots FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "lots_delete"
  ON public.lots FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 8 : OPRS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'oprs'
ORDER BY cmd;

CREATE POLICY "oprs_insert"
  ON public.oprs FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "oprs_select"
  ON public.oprs FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "oprs_update"
  ON public.oprs FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "oprs_delete"
  ON public.oprs FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 9 : PHOTOS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'photos'
ORDER BY cmd;

CREATE POLICY "photos_insert"
  ON public.photos FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "photos_select"
  ON public.photos FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "photos_update"
  ON public.photos FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "photos_delete"
  ON public.photos FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 10 : DOCUMENTS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'documents'
ORDER BY cmd;

CREATE POLICY "documents_insert"
  ON public.documents FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "documents_select"
  ON public.documents FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "documents_update"
  ON public.documents FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "documents_delete"
  ON public.documents FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 11 : MESSAGES — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'messages'
ORDER BY cmd;

CREATE POLICY "messages_insert"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "messages_select"
  ON public.messages FOR SELECT TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "messages_update"
  ON public.messages FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "messages_delete"
  ON public.messages FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 12 : TIME_ENTRIES — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'time_entries'
ORDER BY cmd;

CREATE POLICY "time_entries_insert"
  ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "time_entries_select"
  ON public.time_entries FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "time_entries_update"
  ON public.time_entries FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "time_entries_delete"
  ON public.time_entries FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 13 : INCIDENTS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'incidents'
ORDER BY cmd;

CREATE POLICY "incidents_insert"
  ON public.incidents FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "incidents_select"
  ON public.incidents FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "incidents_update"
  ON public.incidents FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "incidents_delete"
  ON public.incidents FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 14 : REGULATORY_DOCS — Politiques manquantes
-- ════════════════════════════════════════════════════════════

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'regulatory_docs'
ORDER BY cmd;

CREATE POLICY "regulatory_docs_insert"
  ON public.regulatory_docs FOR INSERT TO authenticated
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "regulatory_docs_select"
  ON public.regulatory_docs FOR SELECT TO authenticated
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "regulatory_docs_update"
  ON public.regulatory_docs FOR UPDATE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "regulatory_docs_delete"
  ON public.regulatory_docs FOR DELETE TO authenticated
  USING (
    (organization_id = auth_user_org() AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 15 : Vérification finale — toutes les tables avec RLS
-- ════════════════════════════════════════════════════════════

SELECT
  t.tablename,
  t.rowsecurity AS rls_enabled,
  COALESCE(p.cnt, 0) AS total_policies,
  COALESCE(p.insert_cnt, 0) AS has_insert,
  COALESCE(p.select_cnt, 0) AS has_select,
  COALESCE(p.update_cnt, 0) AS has_update,
  COALESCE(p.delete_cnt, 0) AS has_delete
FROM pg_tables t
LEFT JOIN (
  SELECT
    tablename,
    COUNT(*) AS cnt,
    COUNT(*) FILTER (WHERE cmd = 'INSERT' OR cmd = 'ALL') AS insert_cnt,
    COUNT(*) FILTER (WHERE cmd = 'SELECT' OR cmd = 'ALL') AS select_cnt,
    COUNT(*) FILTER (WHERE cmd = 'UPDATE' OR cmd = 'ALL') AS update_cnt,
    COUNT(*) FILTER (WHERE cmd = 'DELETE' OR cmd = 'ALL') AS delete_cnt
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) p ON t.tablename = p.tablename
WHERE t.schemaname = 'public'
  AND t.rowsecurity = true
ORDER BY t.tablename;
