-- Migration: add organization_id to all tables that relied solely on chantier join for RLS
-- Affected tables: tasks, visites, lots, oprs, site_plans
-- These tables had no direct organization_id column.  Their RLS policies used:
--   EXISTS (SELECT 1 FROM chantiers c WHERE c.id = table.chantier_id AND c.organization_id = auth_user_org())
-- If a row was created without a chantier_id (or before the chantier had its organization_id set),
-- the INSERT silently failed and reads returned empty.
-- This migration adds the column, back-fills via chantier, and updates every RLS policy
-- to accept EITHER the direct org check OR the legacy chantier join.

-- ── TASKS ────────────────────────────────────────────────────────────────────
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

-- ── VISITES ──────────────────────────────────────────────────────────────────
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

-- ── LOTS ─────────────────────────────────────────────────────────────────────
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

-- ── OPRs ─────────────────────────────────────────────────────────────────────
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

-- ── SITE_PLANS ───────────────────────────────────────────────────────────────
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
