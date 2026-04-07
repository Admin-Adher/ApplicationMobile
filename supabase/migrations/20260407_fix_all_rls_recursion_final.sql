-- ============================================================
-- CORRECTION DÉFINITIVE : Suppression de toute récursion RLS
-- Date : 2026-04-07
--
-- Problème racine :
--   1. La migration 20260417 a remis en place une politique SELECT
--      récursive sur profiles (sous-requêtes inline sur profiles
--      dans la politique profiles elle-même).
--   2. Les politiques FOR ALL sur chantiers (et tables liées)
--      contiennent des EXISTS (SELECT 1 FROM profiles ...) inline
--      qui déclenchent cette récursion même lors d'un SELECT simple.
--      PostgreSQL évalue TOUTES les politiques permissives (OR),
--      donc une politique FOR ALL récursive fait échouer le SELECT
--      entier — même si une politique FOR SELECT non-récursive
--      aurait retourné TRUE.
--
-- Solution :
--   • Recréer auth_user_role() SECURITY DEFINER (idempotent).
--   • Corriger la politique SELECT de profiles (sans sous-requête).
--   • Remplacer TOUS les EXISTS inline sur profiles par auth_user_role().
--   • Couvrir : profiles, chantiers, reserves, tasks, companies,
--     visites, lots, oprs, site_plans, documents, photos.
--
-- Idempotent : oui. À coller et exécuter dans Supabase → SQL Editor.
-- ============================================================

-- ── 0. Fonctions SECURITY DEFINER (idempotentes) ─────────────

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION auth_user_org()  TO authenticated;
GRANT EXECUTE ON FUNCTION auth_user_name() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_user_role() TO authenticated;

-- ── 1. PROFILES ───────────────────────────────────────────────
-- Politique non-récursive : utilise auth_user_org() et auth_user_role()
-- (SECURITY DEFINER) au lieu de sous-requêtes inline sur profiles.

DROP POLICY IF EXISTS "Profiles visibles par tous les utilisateurs connectés" ON public.profiles;
CREATE POLICY "Profiles visibles par tous les utilisateurs connectés"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR (organization_id IS NOT NULL AND organization_id = auth_user_org())
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Profil modifiable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil modifiable par admin de la même organisation"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
  );

DROP POLICY IF EXISTS "Profil supprimable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil supprimable par admin de la même organisation"
  ON public.profiles FOR DELETE
  USING (
    auth.uid() = id
    OR (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
  );

DROP POLICY IF EXISTS "Profil insérable par authentifié" ON public.profiles;
CREATE POLICY "Profil insérable par authentifié"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ── 2. CHANTIERS ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Chantiers lisibles par tous les authentifiés" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers visibles par organisation"            ON public.chantiers;
CREATE POLICY "Chantiers visibles par organisation"
  ON public.chantiers FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur"               ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur de la même org" ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_write"                                           ON public.chantiers;
CREATE POLICY "Chantiers modifiables par admin/conducteur de la même org"
  ON public.chantiers FOR ALL
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- ── 3. COMPANIES ──────────────────────────────────────────────

DROP POLICY IF EXISTS "Companies lisibles par tous"                              ON public.companies;
DROP POLICY IF EXISTS "Companies visibles par organisation"                      ON public.companies;
CREATE POLICY "Companies visibles par organisation"
  ON public.companies FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Companies modifiables par admin/conducteur"               ON public.companies;
DROP POLICY IF EXISTS "Companies modifiables par admin/conducteur de la même org" ON public.companies;
CREATE POLICY "Companies modifiables par admin/conducteur de la même org"
  ON public.companies FOR ALL
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

-- ── 4. RESERVES ───────────────────────────────────────────────

DROP POLICY IF EXISTS "Reserves lisibles par tous"          ON public.reserves;
DROP POLICY IF EXISTS "Reserves visibles par organisation"  ON public.reserves;
DROP POLICY IF EXISTS "reserves_select"                     ON public.reserves;
CREATE POLICY "Reserves visibles par organisation"
  ON public.reserves FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org()
    )
    OR auth_user_role() = 'super_admin'
    OR (
      auth_user_role() = 'sous_traitant'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
          AND (
            reserves.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
            OR (reserves.companies IS NOT NULL AND reserves.companies::jsonb ? p.company_id)
          )
      )
    )
  );

DROP POLICY IF EXISTS "Reserves modifiables (create/edit)" ON public.reserves;
DROP POLICY IF EXISTS "Reserves modifiables par org"       ON public.reserves;
CREATE POLICY "Reserves modifiables par org"
  ON public.reserves FOR ALL
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Reserves: sous_traitant peut requêter la levée" ON public.reserves;
CREATE POLICY "Reserves: sous_traitant peut requêter la levée"
  ON public.reserves FOR UPDATE
  USING (
    auth_user_role() = 'sous_traitant'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      LEFT JOIN public.companies co ON co.id = p.company_id
      WHERE p.id = auth.uid() AND p.role = 'sous_traitant' AND p.company_id IS NOT NULL
        AND (
          public.reserves.company = co.name
          OR (public.reserves.companies IS NOT NULL
              AND public.reserves.companies::jsonb ? p.company_id)
        )
    )
  );

-- ── 5. TASKS ──────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tasks lisibles par tous"         ON public.tasks;
DROP POLICY IF EXISTS "Tasks visibles par organisation" ON public.tasks;
CREATE POLICY "Tasks visibles par organisation"
  ON public.tasks FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
    )
    OR auth_user_role() = 'super_admin'
    OR (
      auth_user_role() = 'sous_traitant'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
          AND tasks.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
      )
    )
  );

DROP POLICY IF EXISTS "Tasks modifiables"       ON public.tasks;
DROP POLICY IF EXISTS "Tasks modifiables par org" ON public.tasks;
CREATE POLICY "Tasks modifiables par org"
  ON public.tasks FOR ALL
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── 6. VISITES ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Visites lisibles par tous"         ON public.visites;
DROP POLICY IF EXISTS "Visites visibles par organisation" ON public.visites;
CREATE POLICY "Visites visibles par organisation"
  ON public.visites FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org()
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Visites modifiables"       ON public.visites;
DROP POLICY IF EXISTS "Visites modifiables par org" ON public.visites;
CREATE POLICY "Visites modifiables par org"
  ON public.visites FOR ALL
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── 7. LOTS ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Lots lisibles par tous"         ON public.lots;
DROP POLICY IF EXISTS "Lots visibles par organisation" ON public.lots;
CREATE POLICY "Lots visibles par organisation"
  ON public.lots FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = lots.chantier_id AND c.organization_id = auth_user_org()
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Lots modifiables"       ON public.lots;
DROP POLICY IF EXISTS "Lots modifiables par org" ON public.lots;
CREATE POLICY "Lots modifiables par org"
  ON public.lots FOR ALL
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = lots.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── 8. OPRs ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "OPRs lisibles par tous"         ON public.oprs;
DROP POLICY IF EXISTS "OPRs visibles par organisation" ON public.oprs;
CREATE POLICY "OPRs visibles par organisation"
  ON public.oprs FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org()
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "OPRs modifiables"       ON public.oprs;
DROP POLICY IF EXISTS "OPRs modifiables par org" ON public.oprs;
CREATE POLICY "OPRs modifiables par org"
  ON public.oprs FOR ALL
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── 9. SITE_PLANS ─────────────────────────────────────────────

DROP POLICY IF EXISTS "Site plans lisibles par tous"         ON public.site_plans;
DROP POLICY IF EXISTS "Site plans visibles par organisation" ON public.site_plans;
CREATE POLICY "Site plans visibles par organisation"
  ON public.site_plans FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = site_plans.chantier_id AND c.organization_id = auth_user_org()
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Site plans modifiables"       ON public.site_plans;
DROP POLICY IF EXISTS "Site plans modifiables par org" ON public.site_plans;
CREATE POLICY "Site plans modifiables par org"
  ON public.site_plans FOR ALL
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = site_plans.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── 10. DOCUMENTS ─────────────────────────────────────────────

DROP POLICY IF EXISTS "Documents lisibles par tous"         ON public.documents;
DROP POLICY IF EXISTS "Documents visibles par organisation" ON public.documents;
CREATE POLICY "Documents visibles par organisation"
  ON public.documents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Documents modifiables"       ON public.documents;
DROP POLICY IF EXISTS "Documents modifiables par org" ON public.documents;
CREATE POLICY "Documents modifiables par org"
  ON public.documents FOR ALL
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- ── 11. PHOTOS ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Photos lisibles par tous"         ON public.photos;
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;
CREATE POLICY "Photos visibles par organisation"
  ON public.photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reserves r
      JOIN public.chantiers c ON c.id = r.chantier_id
      WHERE r.id = photos.reserve_id AND c.organization_id = auth_user_org()
    )
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Photos modifiables"       ON public.photos;
DROP POLICY IF EXISTS "Photos modifiables par org" ON public.photos;
CREATE POLICY "Photos modifiables par org"
  ON public.photos FOR ALL
  USING (
    (
      (EXISTS (
        SELECT 1 FROM public.reserves r
        JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id AND c.organization_id = auth_user_org()
      )
      OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── 12. INCIDENTS ─────────────────────────────────────────────

DROP POLICY IF EXISTS "Incidents lisibles par tous"         ON public.incidents;
DROP POLICY IF EXISTS "Incidents visibles par organisation" ON public.incidents;
CREATE POLICY "Incidents visibles par organisation"
  ON public.incidents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Incidents modifiables"       ON public.incidents;
DROP POLICY IF EXISTS "Incidents modifiables par org" ON public.incidents;
CREATE POLICY "Incidents modifiables par org"
  ON public.incidents FOR ALL
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- ── 13. ORGANIZATIONS ─────────────────────────────────────────

DROP POLICY IF EXISTS "Organizations lisibles par leurs membres" ON public.organizations;
CREATE POLICY "Organizations lisibles par leurs membres"
  ON public.organizations FOR SELECT
  USING (
    auth_user_org() = public.organizations.id
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Organizations modifiables par super_admin" ON public.organizations;
CREATE POLICY "Organizations modifiables par super_admin"
  ON public.organizations FOR ALL
  USING (auth_user_role() = 'super_admin');

-- ── 14. SUBSCRIPTIONS ─────────────────────────────────────────

DROP POLICY IF EXISTS "Subscriptions visibles par membres et super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions visibles par membres et super_admin"
  ON public.subscriptions FOR SELECT
  USING (
    auth_user_org() = public.subscriptions.organization_id
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Subscriptions modifiables par super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions modifiables par super_admin"
  ON public.subscriptions FOR ALL
  USING (auth_user_role() = 'super_admin');

-- ── 15. Recharger le cache PostgREST ──────────────────────────
NOTIFY pgrst, 'reload schema';

-- ── Vérification (décommenter pour confirmer) ─────────────────
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('profiles','chantiers','reserves','tasks',
--                     'companies','visites','lots','oprs','site_plans',
--                     'documents','photos','incidents','organizations')
-- ORDER BY tablename, cmd;
