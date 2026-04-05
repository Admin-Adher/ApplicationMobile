-- Migration: add organization_id to reserves table
-- This mirrors the pattern used by companies, tasks, etc.
-- Reserves previously had no direct org column and relied solely on
-- chantier_id → chantiers.organization_id.  If a chantier was created
-- before its organization_id was populated, every reserve INSERT/SELECT
-- silently failed.  This migration adds the column and tightens the RLS
-- so that either path (direct org_id OR chantier join) satisfies the policy.

-- 1. Add the column
ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

CREATE INDEX IF NOT EXISTS idx_reserves_org ON public.reserves(organization_id);

-- 2. Back-fill existing rows via their chantier
UPDATE public.reserves r
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE r.chantier_id = c.id
  AND r.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

-- 3. Replace SELECT policy
DROP POLICY IF EXISTS "Reserves visibles par organisation" ON public.reserves;
CREATE POLICY "Reserves visibles par organisation"
  ON public.reserves FOR SELECT
  USING (
    -- direct org match (new path)
    organization_id = auth_user_org()
    -- chantier join (legacy path, still supported)
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = reserves.chantier_id
        AND c.organization_id = auth_user_org()
    )
    -- null chantier but user is authenticated (edge case)
    OR (reserves.chantier_id IS NULL AND reserves.organization_id IS NULL AND auth_user_org() IS NOT NULL)
    -- super admin sees all
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    -- sous-traitant sees reserves assigned to their company
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'sous_traitant'
        AND (
          reserves.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
          OR (reserves.companies IS NOT NULL AND reserves.companies::jsonb ? p.company_id)
        )
    )
  );

-- 4. Replace ALL (INSERT / UPDATE / DELETE) policy
DROP POLICY IF EXISTS "Reserves modifiables par org" ON public.reserves;
CREATE POLICY "Reserves modifiables par org"
  ON public.reserves FOR ALL
  USING (
    (
      (
        -- direct org match (new path)
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = reserves.chantier_id
            AND c.organization_id = auth_user_org()
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND role IN ('admin', 'conducteur', 'chef_equipe')
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- 5. Keep sous_traitant update policy unchanged
DROP POLICY IF EXISTS "Reserves: sous_traitant peut requêter la levée" ON public.reserves;
CREATE POLICY "Reserves: sous_traitant peut requêter la levée"
  ON public.reserves FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'sous_traitant'
        AND (
          public.reserves.company = (SELECT name FROM public.companies co WHERE co.id = p.company_id LIMIT 1)
          OR (public.reserves.companies IS NOT NULL AND public.reserves.companies::jsonb ? p.company_id)
        )
    )
  );
