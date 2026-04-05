-- ============================================================
-- Migration maître : organization_id sur toutes les tables
-- Date : 2026-04-10
-- But  : Fichier unique à exécuter dans Supabase SQL Editor
--        pour appliquer toutes les corrections de RLS liées à
--        l'organization_id manquant sur les tables enfants.
--
-- Ce fichier est idempotent (IF NOT EXISTS / DROP IF EXISTS).
-- Coller et exécuter dans : Supabase → SQL Editor → Run.
-- ============================================================

-- ── 0. Fonctions d'aide (idempotentes) ────────────────────────
CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- ── 1. RESERVES ───────────────────────────────────────────────
ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_reserves_org ON public.reserves(organization_id);

UPDATE public.reserves r
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE r.chantier_id = c.id
  AND r.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

DROP POLICY IF EXISTS "Reserves visibles par organisation" ON public.reserves;
CREATE POLICY "Reserves visibles par organisation"
  ON public.reserves FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org()
    )
    OR (reserves.chantier_id IS NULL AND reserves.organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'sous_traitant' AND p.company_id IS NOT NULL
        AND (
          reserves.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
          OR (reserves.companies IS NOT NULL AND reserves.companies::jsonb ? p.company_id)
        )
    )
  );

DROP POLICY IF EXISTS "Reserves modifiables par org" ON public.reserves;
CREATE POLICY "Reserves modifiables par org"
  ON public.reserves FOR ALL
  USING (
    (
      (
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org()
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe')
      )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Reserves: sous_traitant peut requêter la levée" ON public.reserves;
CREATE POLICY "Reserves: sous_traitant peut requêter la levée"
  ON public.reserves FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'sous_traitant'
        AND (
          public.reserves.company = (SELECT name FROM public.companies co WHERE co.id = p.company_id LIMIT 1)
          OR (public.reserves.companies IS NOT NULL AND public.reserves.companies::jsonb ? p.company_id)
        )
    )
  );

-- ── 2. TASKS ──────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON public.tasks(organization_id);

UPDATE public.tasks t
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE t.chantier_id = c.id
  AND t.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

DROP POLICY IF EXISTS "Tasks visibles par organisation" ON public.tasks;
CREATE POLICY "Tasks visibles par organisation"
  ON public.tasks FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
    )
    OR (tasks.chantier_id IS NULL AND tasks.organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'sous_traitant' AND p.company_id IS NOT NULL
        AND tasks.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
    )
  );

DROP POLICY IF EXISTS "Tasks modifiables par org" ON public.tasks;
CREATE POLICY "Tasks modifiables par org"
  ON public.tasks FOR ALL
  USING (
    (
      (
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe')
      )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 3. VISITES ────────────────────────────────────────────────
ALTER TABLE public.visites
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_visites_org ON public.visites(organization_id);

UPDATE public.visites v
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE v.chantier_id = c.id
  AND v.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

DROP POLICY IF EXISTS "Visites visibles par organisation" ON public.visites;
CREATE POLICY "Visites visibles par organisation"
  ON public.visites FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Visites modifiables par org" ON public.visites;
CREATE POLICY "Visites modifiables par org"
  ON public.visites FOR ALL
  USING (
    (
      (
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org()
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe')
      )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 4. LOTS ───────────────────────────────────────────────────
ALTER TABLE public.lots
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_lots_org ON public.lots(organization_id);

UPDATE public.lots l
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE l.chantier_id = c.id
  AND l.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

DROP POLICY IF EXISTS "Lots visibles par organisation" ON public.lots;
CREATE POLICY "Lots visibles par organisation"
  ON public.lots FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = lots.chantier_id AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Lots modifiables par org" ON public.lots;
CREATE POLICY "Lots modifiables par org"
  ON public.lots FOR ALL
  USING (
    (
      (
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = lots.chantier_id AND c.organization_id = auth_user_org()
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe')
      )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 5. OPRs ───────────────────────────────────────────────────
ALTER TABLE public.oprs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_oprs_org ON public.oprs(organization_id);

UPDATE public.oprs o
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE o.chantier_id = c.id
  AND o.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

DROP POLICY IF EXISTS "OPRs visibles par organisation" ON public.oprs;
CREATE POLICY "OPRs visibles par organisation"
  ON public.oprs FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "OPRs modifiables par org" ON public.oprs;
CREATE POLICY "OPRs modifiables par org"
  ON public.oprs FOR ALL
  USING (
    (
      (
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org()
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe')
      )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 6. SITE_PLANS ─────────────────────────────────────────────
ALTER TABLE public.site_plans
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_site_plans_org ON public.site_plans(organization_id);

UPDATE public.site_plans sp
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE sp.chantier_id = c.id
  AND sp.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

DROP POLICY IF EXISTS "Site plans visibles par organisation" ON public.site_plans;
CREATE POLICY "Site plans visibles par organisation"
  ON public.site_plans FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = site_plans.chantier_id AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Site plans modifiables par org" ON public.site_plans;
CREATE POLICY "Site plans modifiables par org"
  ON public.site_plans FOR ALL
  USING (
    (
      (
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = site_plans.chantier_id AND c.organization_id = auth_user_org()
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe')
      )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ── 7. PHOTOS ─────────────────────────────────────────────────
-- Les photos n'ont pas de organization_id direct — elles passent via reserve → chantier.
-- La politique existante est correcte ; on s'assure juste que l'index existe.
CREATE INDEX IF NOT EXISTS idx_photos_reserve ON public.photos(reserve_id);

-- ── 8. REGULATORY_DOCS ────────────────────────────────────────
ALTER TABLE public.regulatory_docs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_regulatory_docs_org ON public.regulatory_docs(organization_id);

-- Supprimer les anciennes politiques (basées sur le rôle uniquement, sans isolation d'org)
DROP POLICY IF EXISTS "Docs réglementaires lisibles par tous" ON public.regulatory_docs;
DROP POLICY IF EXISTS "Docs réglementaires modifiables" ON public.regulatory_docs;

-- SELECT : seuls les membres de la même organisation
CREATE POLICY "regulatory_docs_select"
  ON public.regulatory_docs FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- INSERT : membres authentifiés avec rôle approprié
CREATE POLICY "regulatory_docs_insert"
  ON public.regulatory_docs FOR INSERT
  WITH CHECK (
    organization_id = auth_user_org()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    )
  );

-- UPDATE : membres de la même organisation avec rôle approprié
CREATE POLICY "regulatory_docs_update"
  ON public.regulatory_docs FOR UPDATE
  USING (
    organization_id = auth_user_org()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    )
  );

-- DELETE : membres de la même organisation avec rôle approprié
CREATE POLICY "regulatory_docs_delete"
  ON public.regulatory_docs FOR DELETE
  USING (
    organization_id = auth_user_org()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    )
  );

-- ── Fin ───────────────────────────────────────────────────────
-- Vérification rapide (exécuter manuellement si besoin) :
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('reserves','tasks','visites','lots','oprs','site_plans','regulatory_docs')
-- ORDER BY tablename, cmd;
