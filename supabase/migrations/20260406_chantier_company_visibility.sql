-- ─────────────────────────────────────────────────────────────────────────────
-- FEATURE: Company-based chantier visibility
--
-- When a chantier has company_ids set, only members of those companies
-- (plus super_admin / admin / conducteur) can see that chantier and all its
-- related data (reserves, tasks, site_plans, visites, lots, oprs).
-- Chantiers with no company_ids remain visible to all org members.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Ensure column exists (safe no-op if already present) ─────────────────────
ALTER TABLE public.chantiers ADD COLUMN IF NOT EXISTS company_ids jsonb;

-- ── Helper: current user's company_id (SECURITY DEFINER bypasses RLS) ────────
CREATE OR REPLACE FUNCTION public.auth_user_company_id()
RETURNS TEXT
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ── Helper: is the current user a privileged role? ────────────────────────────
-- Privileged = super_admin | admin | conducteur → sees all chantiers in org
CREATE OR REPLACE FUNCTION public.auth_user_is_privileged()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT role IN ('super_admin', 'admin', 'conducteur')
  FROM public.profiles
  WHERE id = auth.uid();
$$;

-- ── Core visibility check for a chantier row ──────────────────────────────────
-- A chantier is visible to the current user when:
--   1. User is super_admin (no org restriction)
--   2. User is admin/conducteur in the same org → sees all
--   3. Chantier has no company restriction (company_ids null/empty)
--   4. User's company_id appears in chantier.company_ids (jsonb array)
CREATE OR REPLACE FUNCTION public.chantier_visible_to_current_user(
  chantier_org_id TEXT,
  chantier_company_ids JSONB
)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT
    CASE
      -- Super admin bypasses everything
      WHEN (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin' THEN true
      -- Must be in the same organization (cast text → uuid for comparison)
      WHEN chantier_org_id::uuid IS DISTINCT FROM public.auth_user_org() THEN false
      -- Privileged roles (admin, conducteur) see all in their org
      WHEN public.auth_user_is_privileged() THEN true
      -- No company restriction → visible to all org members
      WHEN chantier_company_ids IS NULL OR jsonb_array_length(chantier_company_ids) = 0 THEN true
      -- User's company appears in the chantier's company list
      WHEN public.auth_user_company_id() IS NOT NULL
        AND chantier_company_ids @> to_jsonb(public.auth_user_company_id()) THEN true
      ELSE false
    END;
$$;

-- ── CHANTIERS — replace SELECT policy ────────────────────────────────────────
DROP POLICY IF EXISTS "chantiers_select" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers visibles par organisation" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers lisibles par tous les authentifiés" ON public.chantiers;

CREATE POLICY "chantiers_select_v2" ON public.chantiers
  FOR SELECT TO authenticated
  USING (
    public.chantier_visible_to_current_user(organization_id::text, company_ids)
  );

-- ── RESERVES — replace SELECT policy ─────────────────────────────────────────
DROP POLICY IF EXISTS "reserves_select" ON public.reserves;

CREATE POLICY "reserves_select_v2" ON public.reserves
  FOR SELECT TO authenticated
  USING (
    -- Super admin sees all
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      -- Reserve in org and its chantier is visible
      (organization_id = public.auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = reserves.chantier_id
           AND c.organization_id = public.auth_user_org()
       ))
      AND (
        -- No chantier restriction on the reserve → always visible within org
        reserves.chantier_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = reserves.chantier_id
            AND public.chantier_visible_to_current_user(c.organization_id::text, c.company_ids)
        )
      )
    )
  );

-- ── TASKS — replace SELECT policy ────────────────────────────────────────────
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;

CREATE POLICY "tasks_select_v2" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (organization_id = public.auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = tasks.chantier_id
           AND c.organization_id = public.auth_user_org()
       ))
      AND (
        tasks.chantier_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = tasks.chantier_id
            AND public.chantier_visible_to_current_user(c.organization_id::text, c.company_ids)
        )
      )
    )
  );

-- ── SITE_PLANS — replace SELECT policy ───────────────────────────────────────
DROP POLICY IF EXISTS "site_plans_select" ON public.site_plans;

CREATE POLICY "site_plans_select_v2" ON public.site_plans
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = site_plans.chantier_id
        AND public.chantier_visible_to_current_user(c.organization_id::text, c.company_ids)
    )
  );

-- ── VISITES — replace SELECT policy ──────────────────────────────────────────
DROP POLICY IF EXISTS "visites_select" ON public.visites;

CREATE POLICY "visites_select_v2" ON public.visites
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (organization_id = public.auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = visites.chantier_id
           AND c.organization_id = public.auth_user_org()
       ))
      AND EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = visites.chantier_id
          AND public.chantier_visible_to_current_user(c.organization_id::text, c.company_ids)
      )
    )
  );

-- ── LOTS — replace SELECT policy ─────────────────────────────────────────────
DROP POLICY IF EXISTS "lots_select" ON public.lots;

CREATE POLICY "lots_select_v2" ON public.lots
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      organization_id = public.auth_user_org()
      AND (
        lots.chantier_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = lots.chantier_id
            AND public.chantier_visible_to_current_user(c.organization_id::text, c.company_ids)
        )
      )
    )
  );

-- ── OPRS — replace SELECT policy ─────────────────────────────────────────────
DROP POLICY IF EXISTS "oprs_select" ON public.oprs;

CREATE POLICY "oprs_select_v2" ON public.oprs
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super_admin'
    OR (
      (organization_id = public.auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = oprs.chantier_id
           AND c.organization_id = public.auth_user_org()
       ))
      AND EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = oprs.chantier_id
          AND public.chantier_visible_to_current_user(c.organization_id::text, c.company_ids)
      )
    )
  );
