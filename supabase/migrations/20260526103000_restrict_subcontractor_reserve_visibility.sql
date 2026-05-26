-- Enforce strict reserve visibility for subcontractors.
-- Subcontractors must only see reserves explicitly assigned to their company.

CREATE OR REPLACE FUNCTION public.reserve_matches_current_user_company(
  p_company text,
  p_companies jsonb
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.companies co
    WHERE co.id = public.auth_user_company_id()
      AND (
        NULLIF(BTRIM(COALESCE(p_company, '')), '') = co.name
        OR COALESCE(p_companies, '[]'::jsonb) ? co.id
        OR COALESCE(p_companies, '[]'::jsonb) ? co.name
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.reserve_matches_current_user_company(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_matches_current_user_company(text, jsonb) TO authenticated;

ALTER TABLE public.reserves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

DO $block$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reserves'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.reserves', v_policy.policyname);
  END LOOP;
END;
$block$;

DO $block$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'reserves'
      AND cmd = 'UPDATE'
      AND (
        lower(policyname) LIKE '%sous%'
        OR lower(policyname) LIKE '%traitant%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.reserves', v_policy.policyname);
  END LOOP;
END;
$block$;

CREATE POLICY reserves_select
  ON public.reserves
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'sous_traitant'
      AND public.reserve_matches_current_user_company(reserves.company, reserves.companies)
    )
    OR (
      public.auth_user_role() IS NOT NULL
      AND public.auth_user_role() <> 'sous_traitant'
      AND (
        reserves.organization_id = public.auth_user_org()
        OR EXISTS (
          SELECT 1
          FROM public.chantiers c
          WHERE c.id = reserves.chantier_id
            AND c.organization_id = public.auth_user_org()
        )
      )
    )
  );

CREATE POLICY reserves_sousstraitant_update
  ON public.reserves
  FOR UPDATE
  TO authenticated
  USING (
    public.auth_user_role() = 'sous_traitant'
    AND public.reserve_matches_current_user_company(reserves.company, reserves.companies)
  )
  WITH CHECK (
    public.auth_user_role() = 'sous_traitant'
    AND public.reserve_matches_current_user_company(reserves.company, reserves.companies)
  );

DO $block$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'photos'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.photos', v_policy.policyname);
  END LOOP;
END;
$block$;

CREATE POLICY photos_select
  ON public.photos
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'sous_traitant'
      AND photos.reserve_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.reserves r
        WHERE r.id = photos.reserve_id
          AND public.reserve_matches_current_user_company(r.company, r.companies)
      )
    )
    OR (
      public.auth_user_role() IS NOT NULL
      AND public.auth_user_role() <> 'sous_traitant'
      AND (
        photos.organization_id = public.auth_user_org()
        OR EXISTS (
          SELECT 1
          FROM public.reserves r
          LEFT JOIN public.chantiers c ON c.id = r.chantier_id
          WHERE r.id = photos.reserve_id
            AND COALESCE(r.organization_id, c.organization_id) = public.auth_user_org()
        )
      )
    )
  );

DO $block$
DECLARE
  v_reserve_select_count integer;
  v_photo_select_count integer;
BEGIN
  SELECT count(*)
  INTO v_reserve_select_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'reserves'
    AND cmd = 'SELECT';

  IF v_reserve_select_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 SELECT policy on public.reserves, found %', v_reserve_select_count;
  END IF;

  SELECT count(*)
  INTO v_photo_select_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'photos'
    AND cmd = 'SELECT';

  IF v_photo_select_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 SELECT policy on public.photos, found %', v_photo_select_count;
  END IF;
END;
$block$;

NOTIFY pgrst, 'reload schema';
