-- ============================================================
-- Migration : Données legacy avec organization_id NULL
-- Date      : 2026-04-05
--
-- Problème :
--   Toutes les politiques RLS filtrent par
--     organization_id = auth_user_org()
--   ce qui retourne NULL = UUID → false pour les lignes créées
--   avant l'ajout de la colonne organization_id.
--   Résultat : appareil vierge (sans cache AsyncStorage) = 0 données.
--
-- Tables concernées :
--   • chantiers   — RACINE : si NULL, toutes les tables enfants
--                   disparaissent en cascade.
--   • reserves, tasks, visites, lots, oprs, site_plans, photos
--                 — filtrent via chantiers → affectées par cascade.
--   • documents, incidents — filtres directs, même problème.
--   • companies   — déjà corrigé dans 20260405_fix_companies_visibility.sql
--
-- Stratégie :
--   Pour chaque politique SELECT, ajouter :
--     OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
--   ce qui rend les données legacy visibles à tout utilisateur
--   appartenant à une organisation, sans les exposer à des tiers.
--   Le super_admin est toujours couvert par sa propre clause.
--
-- Idempotent : oui (DROP IF EXISTS avant chaque CREATE POLICY).
-- ============================================================

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ============================================================
-- 1. CHANTIERS  (racine — corriger en priorité)
-- ============================================================
DROP POLICY IF EXISTS "Chantiers visibles par organisation" ON public.chantiers;
CREATE POLICY "Chantiers visibles par organisation"
  ON public.chantiers FOR SELECT
  USING (
    organization_id = auth_user_org()
    -- Chantiers legacy sans organisation → visibles par tout utilisateur connecté
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 2. RESERVES
-- ============================================================
DROP POLICY IF EXISTS "Reserves visibles par organisation" ON public.reserves;
CREATE POLICY "Reserves visibles par organisation"
  ON public.reserves FOR SELECT
  USING (
    -- Via organization_id propre
    organization_id = auth_user_org()
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    -- Via chantier (avec ou sans org sur le chantier)
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = reserves.chantier_id
        AND (
          c.organization_id = auth_user_org()
          OR (c.organization_id IS NULL AND auth_user_org() IS NOT NULL)
        )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    -- Sous-traitant : voit ses propres réserves
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'sous_traitant' AND p.company_id IS NOT NULL
        AND (
          reserves.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
          OR (reserves.companies IS NOT NULL AND reserves.companies::jsonb ? p.company_id)
        )
    )
  );

-- ============================================================
-- 3. TASKS
-- ============================================================
DROP POLICY IF EXISTS "Tasks visibles par organisation" ON public.tasks;
CREATE POLICY "Tasks visibles par organisation"
  ON public.tasks FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = tasks.chantier_id
        AND (
          c.organization_id = auth_user_org()
          OR (c.organization_id IS NULL AND auth_user_org() IS NOT NULL)
        )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'sous_traitant' AND p.company_id IS NOT NULL
        AND tasks.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
    )
  );

-- ============================================================
-- 4. VISITES
-- ============================================================
DROP POLICY IF EXISTS "Visites visibles par organisation" ON public.visites;
CREATE POLICY "Visites visibles par organisation"
  ON public.visites FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = visites.chantier_id
        AND (
          c.organization_id = auth_user_org()
          OR (c.organization_id IS NULL AND auth_user_org() IS NOT NULL)
        )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 5. LOTS
-- ============================================================
DROP POLICY IF EXISTS "Lots visibles par organisation" ON public.lots;
CREATE POLICY "Lots visibles par organisation"
  ON public.lots FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = lots.chantier_id
        AND (
          c.organization_id = auth_user_org()
          OR (c.organization_id IS NULL AND auth_user_org() IS NOT NULL)
        )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 6. OPRs
-- ============================================================
DROP POLICY IF EXISTS "OPRs visibles par organisation" ON public.oprs;
CREATE POLICY "OPRs visibles par organisation"
  ON public.oprs FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = oprs.chantier_id
        AND (
          c.organization_id = auth_user_org()
          OR (c.organization_id IS NULL AND auth_user_org() IS NOT NULL)
        )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 7. SITE PLANS
-- ============================================================
DROP POLICY IF EXISTS "Site plans visibles par organisation" ON public.site_plans;
CREATE POLICY "Site plans visibles par organisation"
  ON public.site_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = site_plans.chantier_id
        AND (
          c.organization_id = auth_user_org()
          OR (c.organization_id IS NULL AND auth_user_org() IS NOT NULL)
        )
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 8. PHOTOS  (via reserves → chantiers)
-- ============================================================
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;
CREATE POLICY "Photos visibles par organisation"
  ON public.photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reserves r
      JOIN public.chantiers c ON c.id = r.chantier_id
      WHERE r.id = photos.reserve_id
        AND (
          c.organization_id = auth_user_org()
          OR (c.organization_id IS NULL AND auth_user_org() IS NOT NULL)
        )
    )
    -- Photo sans réserve liée → visible si l'utilisateur appartient à une org
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 9. DOCUMENTS
-- ============================================================
DROP POLICY IF EXISTS "Documents visibles par organisation" ON public.documents;
CREATE POLICY "Documents visibles par organisation"
  ON public.documents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- 10. INCIDENTS
-- ============================================================
DROP POLICY IF EXISTS "Incidents visibles par organisation" ON public.incidents;
CREATE POLICY "Incidents visibles par organisation"
  ON public.incidents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR (organization_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- Recharger le cache PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';
