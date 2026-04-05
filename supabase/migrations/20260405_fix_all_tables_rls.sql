-- ============================================================
-- Migration : Sécurisation RLS de toutes les tables métier
--
-- Problème : Les politiques "lisibles par tous les authentifiés"
--   exposent toutes les données à n'importe quel compte connecté,
--   quelle que soit son organisation.
--
-- Solution :
--   1. Ajout de organization_id sur les tables racines
--      (chantiers, companies, documents, incidents, time_entries).
--   2. Pour les tables enfants (reserves, tasks, site_plans,
--      visites, lots, oprs, photos) : filtre par jointure sur
--      chantiers.organization_id via chantier_id.
--   3. Réécriture de toutes les politiques SELECT et WRITE
--      pour isoler les données par organisation.
--   4. Conservation de la politique sous-traitant existante
--      sur les réserves.
--
-- Prérequis :
--   Les fonctions auth_user_org() et auth_user_name() doivent
--   exister (migration 20260405_fix_channels_messages_rls.sql).
-- ============================================================

-- ============================================================
-- PARTIE 1 : Ajout des colonnes organization_id manquantes
-- ============================================================

ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- ============================================================
-- PARTIE 2 : Index pour les performances des jointures RLS
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_chantiers_org ON public.chantiers(organization_id);
CREATE INDEX IF NOT EXISTS idx_companies_org  ON public.companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_org  ON public.documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_org  ON public.incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_org ON public.time_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_reserves_chantier ON public.reserves(chantier_id);
CREATE INDEX IF NOT EXISTS idx_tasks_chantier ON public.tasks(chantier_id);
CREATE INDEX IF NOT EXISTS idx_site_plans_chantier ON public.site_plans(chantier_id);
CREATE INDEX IF NOT EXISTS idx_visites_chantier ON public.visites(chantier_id);
CREATE INDEX IF NOT EXISTS idx_lots_chantier ON public.lots(chantier_id);
CREATE INDEX IF NOT EXISTS idx_oprs_chantier ON public.oprs(chantier_id);
CREATE INDEX IF NOT EXISTS idx_photos_reserve ON public.photos(reserve_id);

-- ============================================================
-- PARTIE 3 : Politiques RLS — TABLE chantiers
-- ============================================================

DROP POLICY IF EXISTS "Chantiers lisibles par tous les authentifiés" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers visibles par organisation" ON public.chantiers;
CREATE POLICY "Chantiers visibles par organisation"
  ON public.chantiers FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur de la même org" ON public.chantiers;
CREATE POLICY "Chantiers modifiables par admin/conducteur de la même org"
  ON public.chantiers FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 4 : Politiques RLS — TABLE companies
-- ============================================================

DROP POLICY IF EXISTS "Companies lisibles par tous" ON public.companies;
DROP POLICY IF EXISTS "Companies visibles par organisation" ON public.companies;
CREATE POLICY "Companies visibles par organisation"
  ON public.companies FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Companies modifiables par admin/conducteur" ON public.companies;
DROP POLICY IF EXISTS "Companies modifiables par admin/conducteur de la même org" ON public.companies;
CREATE POLICY "Companies modifiables par admin/conducteur de la même org"
  ON public.companies FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 5 : Politiques RLS — TABLE reserves
-- ============================================================

DROP POLICY IF EXISTS "Reserves lisibles par tous" ON public.reserves;
DROP POLICY IF EXISTS "Reserves visibles par organisation" ON public.reserves;
CREATE POLICY "Reserves visibles par organisation"
  ON public.reserves FOR SELECT
  USING (
    -- Membres de l'organisation (via le chantier associé)
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = reserves.chantier_id
        AND c.organization_id = auth_user_org()
    )
    -- Réserves sans chantier : visibles par tous les membres de l'org via is_not_null check
    OR (
      reserves.chantier_id IS NULL
      AND auth_user_org() IS NOT NULL
    )
    -- Super admin
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    -- Sous-traitant : voit uniquement les réserves de son entreprise
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'sous_traitant'
        AND p.company_id IS NOT NULL
        AND (
          reserves.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
          OR (reserves.companies IS NOT NULL AND reserves.companies::jsonb ? p.company_id)
        )
    )
  );

DROP POLICY IF EXISTS "Reserves modifiables (create/edit)" ON public.reserves;
DROP POLICY IF EXISTS "Reserves modifiables par org" ON public.reserves;
CREATE POLICY "Reserves modifiables par org"
  ON public.reserves FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = reserves.chantier_id
          AND c.organization_id = auth_user_org()
      )
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Conservation de la politique de mise à jour sous-traitant
DROP POLICY IF EXISTS "Reserves: sous_traitant peut requêter la levée" ON public.reserves;
CREATE POLICY "Reserves: sous_traitant peut requêter la levée"
  ON public.reserves FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      LEFT JOIN public.companies co ON co.id = p.company_id
      WHERE p.id = auth.uid()
        AND p.role = 'sous_traitant'
        AND p.company_id IS NOT NULL
        AND (
          public.reserves.company = co.name
          OR (public.reserves.companies IS NOT NULL
              AND public.reserves.companies::jsonb ? p.company_id)
        )
    )
  );

-- ============================================================
-- PARTIE 6 : Politiques RLS — TABLE tasks
-- ============================================================

DROP POLICY IF EXISTS "Tasks lisibles par tous" ON public.tasks;
DROP POLICY IF EXISTS "Tasks visibles par organisation" ON public.tasks;
CREATE POLICY "Tasks visibles par organisation"
  ON public.tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = tasks.chantier_id
        AND c.organization_id = auth_user_org()
    )
    OR (tasks.chantier_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
    -- Sous-traitant : voit les tâches de son entreprise
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'sous_traitant'
        AND p.company_id IS NOT NULL
        AND tasks.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
    )
  );

DROP POLICY IF EXISTS "Tasks modifiables" ON public.tasks;
DROP POLICY IF EXISTS "Tasks modifiables par org" ON public.tasks;
CREATE POLICY "Tasks modifiables par org"
  ON public.tasks FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = tasks.chantier_id
          AND c.organization_id = auth_user_org()
      )
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 7 : Politiques RLS — TABLE documents
-- ============================================================

DROP POLICY IF EXISTS "Documents lisibles par tous" ON public.documents;
DROP POLICY IF EXISTS "Documents visibles par organisation" ON public.documents;
CREATE POLICY "Documents visibles par organisation"
  ON public.documents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Documents modifiables" ON public.documents;
DROP POLICY IF EXISTS "Documents modifiables par org" ON public.documents;
CREATE POLICY "Documents modifiables par org"
  ON public.documents FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 8 : Politiques RLS — TABLE photos
-- ============================================================

DROP POLICY IF EXISTS "Photos lisibles par tous" ON public.photos;
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;
CREATE POLICY "Photos visibles par organisation"
  ON public.photos FOR SELECT
  USING (
    -- Jointure via reserve → chantier → org
    EXISTS (
      SELECT 1 FROM public.reserves r
      JOIN public.chantiers c ON c.id = r.chantier_id
      WHERE r.id = photos.reserve_id
        AND c.organization_id = auth_user_org()
    )
    -- Photo sans réserve associée
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Photos modifiables" ON public.photos;
DROP POLICY IF EXISTS "Photos modifiables par org" ON public.photos;
CREATE POLICY "Photos modifiables par org"
  ON public.photos FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.reserves r
        JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id
          AND c.organization_id = auth_user_org()
      )
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe')))
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 9 : Politiques RLS — TABLE site_plans
-- ============================================================

DROP POLICY IF EXISTS "Site plans lisibles par tous" ON public.site_plans;
DROP POLICY IF EXISTS "Site plans visibles par organisation" ON public.site_plans;
CREATE POLICY "Site plans visibles par organisation"
  ON public.site_plans FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = site_plans.chantier_id
        AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Site plans modifiables" ON public.site_plans;
DROP POLICY IF EXISTS "Site plans modifiables par org" ON public.site_plans;
CREATE POLICY "Site plans modifiables par org"
  ON public.site_plans FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = site_plans.chantier_id
          AND c.organization_id = auth_user_org()
      )
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 10 : Politiques RLS — TABLE incidents
-- ============================================================

DROP POLICY IF EXISTS "Incidents lisibles par tous" ON public.incidents;
DROP POLICY IF EXISTS "Incidents visibles par organisation" ON public.incidents;
CREATE POLICY "Incidents visibles par organisation"
  ON public.incidents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Incidents modifiables" ON public.incidents;
DROP POLICY IF EXISTS "Incidents modifiables par org" ON public.incidents;
CREATE POLICY "Incidents modifiables par org"
  ON public.incidents FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 11 : Politiques RLS — TABLE visites
-- ============================================================

DROP POLICY IF EXISTS "Visites lisibles par tous" ON public.visites;
DROP POLICY IF EXISTS "Visites visibles par organisation" ON public.visites;
CREATE POLICY "Visites visibles par organisation"
  ON public.visites FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = visites.chantier_id
        AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Visites modifiables" ON public.visites;
DROP POLICY IF EXISTS "Visites modifiables par org" ON public.visites;
CREATE POLICY "Visites modifiables par org"
  ON public.visites FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = visites.chantier_id
          AND c.organization_id = auth_user_org()
      )
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 12 : Politiques RLS — TABLE lots
-- ============================================================

DROP POLICY IF EXISTS "Lots lisibles par tous" ON public.lots;
DROP POLICY IF EXISTS "Lots visibles par organisation" ON public.lots;
CREATE POLICY "Lots visibles par organisation"
  ON public.lots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = lots.chantier_id
        AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Lots modifiables" ON public.lots;
DROP POLICY IF EXISTS "Lots modifiables par org" ON public.lots;
CREATE POLICY "Lots modifiables par org"
  ON public.lots FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = lots.chantier_id
          AND c.organization_id = auth_user_org()
      )
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 13 : Politiques RLS — TABLE oprs
-- ============================================================

DROP POLICY IF EXISTS "OPRs lisibles par tous" ON public.oprs;
DROP POLICY IF EXISTS "OPRs visibles par organisation" ON public.oprs;
CREATE POLICY "OPRs visibles par organisation"
  ON public.oprs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = oprs.chantier_id
        AND c.organization_id = auth_user_org()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "OPRs modifiables" ON public.oprs;
DROP POLICY IF EXISTS "OPRs modifiables par org" ON public.oprs;
CREATE POLICY "OPRs modifiables par org"
  ON public.oprs FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = oprs.chantier_id
          AND c.organization_id = auth_user_org()
      )
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- ============================================================
-- PARTIE 14 : Politiques RLS — TABLE time_entries (pointage)
-- ============================================================

DROP POLICY IF EXISTS "Pointage lisible par tous" ON public.time_entries;
DROP POLICY IF EXISTS "Pointage visible par organisation" ON public.time_entries;
CREATE POLICY "Pointage visible par organisation"
  ON public.time_entries FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

DROP POLICY IF EXISTS "Pointage modifiable" ON public.time_entries;
DROP POLICY IF EXISTS "Pointage modifiable par org" ON public.time_entries;
CREATE POLICY "Pointage modifiable par org"
  ON public.time_entries FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'conducteur', 'chef_equipe'))
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );
