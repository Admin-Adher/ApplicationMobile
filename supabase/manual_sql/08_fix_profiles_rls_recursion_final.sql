-- Copy/paste this whole file in Supabase SQL Editor to fix:
-- "infinite recursion detected in policy for relation profiles".
--
-- If Supabase asks about RLS for newly created tables, cancel: this script does
-- not create tables. Run it exactly as-is.

CREATE OR REPLACE FUNCTION public.auth_user_org()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.organization_id
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.auth_user_name()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.name
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id text;

CREATE OR REPLACE FUNCTION public.auth_user_company_id()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.company_id
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.auth_user_org() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_name() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_company_id() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auth_user_org() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_name() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_company_id() TO authenticated;

DO $$
DECLARE
  v_policy record;
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RETURN;
  END IF;

  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', v_policy.policyname);
  END LOOP;
END
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_safe
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.auth_user_role() = 'super_admin'
    OR (
      organization_id IS NOT NULL
      AND organization_id = public.auth_user_org()
    )
  );

CREATE POLICY profiles_insert_self_or_admin
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    id = auth.uid()
    OR public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'admin'
      AND organization_id = public.auth_user_org()
    )
  );

CREATE POLICY profiles_update_self_or_admin
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'admin'
      AND organization_id = public.auth_user_org()
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'admin'
      AND organization_id = public.auth_user_org()
    )
  );

CREATE POLICY profiles_delete_self_or_admin
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (
    id = auth.uid()
    OR public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'admin'
      AND organization_id = public.auth_user_org()
    )
  );

DO $$
DECLARE
  v_recursive_policy_count integer;
BEGIN
  SELECT count(*)
  INTO v_recursive_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'profiles'
    AND (
      lower(coalesce(qual, '')) LIKE '%from public.profiles%'
      OR lower(coalesce(with_check, '')) LIKE '%from public.profiles%'
      OR lower(coalesce(qual, '')) LIKE '%from profiles%'
      OR lower(coalesce(with_check, '')) LIKE '%from profiles%'
    );

  IF v_recursive_policy_count > 0 THEN
    RAISE EXCEPTION 'Profiles RLS still contains recursive direct profile reads';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';

SELECT 'profiles_rls_recursion_fixed' AS status;
