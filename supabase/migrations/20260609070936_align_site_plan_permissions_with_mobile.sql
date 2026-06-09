-- Align site plan permissions with the mobile ROLE_PERMISSIONS matrix.
-- Plan create/update actions use canCreate. Full plan deletion uses canDelete.
-- File removal is an UPDATE, so a trigger blocks clearing file fields without canDelete.

CREATE OR REPLACE FUNCTION public.auth_user_has_permission(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_override jsonb;
  v_default boolean := false;
  v_override_value jsonb;
BEGIN
  SELECT p.role, COALESCE(p.permissions_override, '{}'::jsonb)
    INTO v_role, v_override
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  v_default := CASE p_permission
    WHEN 'canCreate' THEN v_role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    WHEN 'canEdit' THEN v_role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    WHEN 'canEditOwn' THEN v_role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe', 'sous_traitant')
    WHEN 'canDelete' THEN v_role IN ('super_admin', 'admin')
    WHEN 'canExport' THEN v_role IN ('super_admin', 'admin', 'conducteur', 'observateur')
    WHEN 'canManageTeams' THEN v_role IN ('super_admin', 'admin', 'conducteur')
    WHEN 'canViewTeams' THEN v_role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe', 'observateur')
    WHEN 'canUpdateAttendance' THEN v_role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    WHEN 'canMovePins' THEN v_role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    WHEN 'canEditChantier' THEN v_role IN ('super_admin', 'admin', 'conducteur')
    ELSE false
  END;

  IF v_role = 'super_admin' THEN
    RETURN v_default;
  END IF;

  v_override_value := v_override -> p_permission;
  IF jsonb_typeof(v_override_value) = 'boolean' THEN
    RETURN (v_override_value #>> '{}')::boolean;
  END IF;

  RETURN v_default;
END;
$$;

REVOKE ALL ON FUNCTION public.auth_user_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_has_permission(text) TO authenticated;

DROP POLICY IF EXISTS "Site plans modifiables" ON public.site_plans;
DROP POLICY IF EXISTS "Site plans modifiables par org" ON public.site_plans;
DROP POLICY IF EXISTS "site_plans_write_v3" ON public.site_plans;
DROP POLICY IF EXISTS "Plans de masse modifiables" ON public.site_plans;
DROP POLICY IF EXISTS "Plans de masse modifiables par org" ON public.site_plans;
DROP POLICY IF EXISTS "Plans de masse creables par permission" ON public.site_plans;
DROP POLICY IF EXISTS "Plans de masse modifiables par permission" ON public.site_plans;
DROP POLICY IF EXISTS "Plans de masse supprimables par permission" ON public.site_plans;

CREATE POLICY "Plans de masse creables par permission"
  ON public.site_plans FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_user_role() = 'super_admin'
    OR (
      organization_id = public.auth_user_org()
      AND public.auth_user_has_permission('canCreate')
      AND EXISTS (
        SELECT 1
        FROM public.chantiers AS c
        WHERE c.id = site_plans.chantier_id
          AND c.organization_id = public.auth_user_org()
      )
    )
  );

CREATE POLICY "Plans de masse modifiables par permission"
  ON public.site_plans FOR UPDATE TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      organization_id = public.auth_user_org()
      AND (
        public.auth_user_has_permission('canCreate')
        OR public.auth_user_has_permission('canDelete')
      )
    )
  )
  WITH CHECK (
    public.auth_user_role() = 'super_admin'
    OR (
      organization_id = public.auth_user_org()
      AND (
        public.auth_user_has_permission('canCreate')
        OR public.auth_user_has_permission('canDelete')
      )
    )
  );

CREATE POLICY "Plans de masse supprimables par permission"
  ON public.site_plans FOR DELETE TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      organization_id = public.auth_user_org()
      AND public.auth_user_has_permission('canDelete')
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_site_plan_file_delete_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.auth_user_role() = 'super_admin' THEN
    RETURN NEW;
  END IF;

  IF NEW.uri IS NULL
    AND NEW.file_type IS NULL
    AND NEW.dxf_name IS NULL
    AND NEW.size IS NULL
    AND (
      OLD.uri IS NOT NULL
      OR OLD.file_type IS NOT NULL
      OR OLD.dxf_name IS NOT NULL
      OR OLD.size IS NOT NULL
    )
  THEN
    IF public.auth_user_has_permission('canDelete')
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.chantier_id IS NOT DISTINCT FROM OLD.chantier_id
      AND NEW.name IS NOT DISTINCT FROM OLD.name
      AND NEW.building IS NOT DISTINCT FROM OLD.building
      AND NEW.level IS NOT DISTINCT FROM OLD.level
      AND NEW.building_id IS NOT DISTINCT FROM OLD.building_id
      AND NEW.level_id IS NOT DISTINCT FROM OLD.level_id
      AND NEW.uploaded_at IS NOT DISTINCT FROM OLD.uploaded_at
      AND NEW.revision_code IS NOT DISTINCT FROM OLD.revision_code
      AND NEW.revision_number IS NOT DISTINCT FROM OLD.revision_number
      AND NEW.parent_plan_id IS NOT DISTINCT FROM OLD.parent_plan_id
      AND NEW.is_latest_revision IS NOT DISTINCT FROM OLD.is_latest_revision
      AND NEW.revision_note IS NOT DISTINCT FROM OLD.revision_note
      AND NEW.annotations IS NOT DISTINCT FROM OLD.annotations
      AND NEW.pdf_page_count IS NOT DISTINCT FROM OLD.pdf_page_count
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Suppression du fichier plan non autorisee pour ces permissions';
  END IF;

  IF public.auth_user_has_permission('canCreate') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Modification du plan non autorisee pour ces permissions';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_site_plan_file_delete_permission ON public.site_plans;
CREATE TRIGGER trg_enforce_site_plan_file_delete_permission
  BEFORE UPDATE ON public.site_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_site_plan_file_delete_permission();
