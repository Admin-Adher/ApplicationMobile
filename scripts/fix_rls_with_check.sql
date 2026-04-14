-- ============================================================
-- Fix RLS : with_check NULL + politiques trop permissives
-- CRITIQUE : sans with_check, INSERT bypass le filtre organization_id
-- Exécuter chaque bloc SÉPARÉMENT dans le SQL Editor
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- BLOC 1 : RESERVES — Ajouter with_check à reserves_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS reserves_write ON public.reserves;
CREATE POLICY "reserves_write" ON public.reserves FOR ALL TO authenticated
  USING (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 2 : TASKS — Ajouter with_check à tasks_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS tasks_write ON public.tasks;
CREATE POLICY "tasks_write" ON public.tasks FOR ALL TO authenticated
  USING (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 3 : VISITES — Ajouter with_check à visites_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS visites_write ON public.visites;
CREATE POLICY "visites_write" ON public.visites FOR ALL TO authenticated
  USING (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 4 : SITE_PLANS — Ajouter with_check à site_plans_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS site_plans_write ON public.site_plans;
CREATE POLICY "site_plans_write" ON public.site_plans FOR ALL TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = site_plans.chantier_id AND c.organization_id = auth_user_org()))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = site_plans.chantier_id AND c.organization_id = auth_user_org()))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 5 : LOTS — Ajouter with_check à lots_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS lots_write ON public.lots;
CREATE POLICY "lots_write" ON public.lots FOR ALL TO authenticated
  USING (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 6 : OPRS — Ajouter with_check à oprs_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS oprs_write ON public.oprs;
CREATE POLICY "oprs_write" ON public.oprs FOR ALL TO authenticated
  USING (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    ((organization_id = auth_user_org()) OR (EXISTS (SELECT 1 FROM chantiers c WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org())))
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 7 : DOCUMENTS — Ajouter with_check à documents_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS documents_write ON public.documents;
CREATE POLICY "documents_write" ON public.documents FOR ALL TO authenticated
  USING (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 8 : INCIDENTS — Ajouter with_check à incidents_write
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS incidents_write ON public.incidents;
CREATE POLICY "incidents_write" ON public.incidents FOR ALL TO authenticated
  USING (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 9 : PHOTOS — Mettre à jour pour utiliser organization_id direct
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS photos_write ON public.photos;
CREATE POLICY "photos_write" ON public.photos FOR ALL TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR (reserve_id IS NOT NULL AND EXISTS (SELECT 1 FROM reserves r WHERE r.id = photos.reserve_id AND r.organization_id = auth_user_org()))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    OR (reserve_id IS NOT NULL AND EXISTS (SELECT 1 FROM reserves r WHERE r.id = photos.reserve_id AND r.organization_id = auth_user_org()))
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS photos_select ON public.photos;
CREATE POLICY "photos_select" ON public.photos FOR SELECT TO authenticated
  USING (
    (organization_id = auth_user_org())
    OR (reserve_id IS NOT NULL AND EXISTS (SELECT 1 FROM reserves r WHERE r.id = photos.reserve_id AND (r.organization_id = auth_user_org() OR auth_user_role() = 'super_admin')))
    OR (reserve_id IS NULL AND organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 10 : REGULATORY_DOCS — Fix politique trop permissive
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Docs réglementaires modifiables" ON public.regulatory_docs;
CREATE POLICY "regulatory_docs_write" ON public.regulatory_docs FOR ALL TO authenticated
  USING (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org())
    AND auth_user_role() = ANY (ARRAY['admin', 'conducteur', 'chef_equipe'])
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 11 : SUBSCRIPTIONS — Restreindre INSERT aux admins
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Subscriptions créables par tout utilisateur authentifié" ON public.subscriptions;
-- Seuls les admins/super_admins de l'org peuvent créer des subscriptions
-- (createOrganization dans l'app insère avec le profil super_admin)
CREATE POLICY "subscriptions_insert" ON public.subscriptions FOR INSERT TO authenticated
  WITH CHECK (
    (auth_user_org() = organization_id AND auth_user_role() = ANY (ARRAY['admin', 'super_admin']))
    OR auth_user_role() = 'super_admin'
  );

-- ════════════════════════════════════════════════════════════
-- BLOC 12 : MESSAGES — Ajouter with_check à messages_update
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS messages_update ON public.messages;
CREATE POLICY "messages_update" ON public.messages FOR ALL TO authenticated
  USING (sender = auth_user_name())
  WITH CHECK (sender = auth_user_name());

-- ════════════════════════════════════════════════════════════
-- BLOC 13 : Vérification finale — toutes les politiques avec with_check
-- ════════════════════════════════════════════════════════════
SELECT
  tablename,
  policyname,
  cmd,
  CASE WHEN with_check IS NOT NULL THEN '✅' ELSE '🔴 NULL' END AS has_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (cmd = 'ALL' OR cmd = 'INSERT' OR cmd = 'UPDATE')
ORDER BY tablename, policyname;
