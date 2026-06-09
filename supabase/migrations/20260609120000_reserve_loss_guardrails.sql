-- Anti-loss guardrails for reserves and their media.
-- Adds an audit trail, blocks unsafe hard deletes, and tightens Storage writes.

CREATE TABLE IF NOT EXISTS public.data_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  operation text NOT NULL,
  row_id text,
  organization_id uuid,
  chantier_id text,
  plan_id text,
  actor_id uuid DEFAULT auth.uid(),
  actor_role text,
  old_row jsonb,
  new_row jsonb,
  reason text
);

ALTER TABLE public.data_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_audit_log_select" ON public.data_audit_log;
CREATE POLICY "data_audit_log_select"
  ON public.data_audit_log FOR SELECT TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      organization_id = public.auth_user_org()
      AND public.auth_user_role() IN ('admin', 'conducteur')
    )
  );

REVOKE ALL ON public.data_audit_log FROM PUBLIC;
GRANT SELECT ON public.data_audit_log TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END;
  v_row jsonb := COALESCE(v_new, v_old);
  v_org uuid := NULL;
  v_actor_role text := NULL;
BEGIN
  BEGIN
    v_actor_role := public.auth_user_role();
  EXCEPTION WHEN OTHERS THEN
    v_actor_role := NULL;
  END;

  BEGIN
    IF v_row ? 'organization_id' AND NULLIF(v_row->>'organization_id', '') IS NOT NULL THEN
      v_org := (v_row->>'organization_id')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_org := NULL;
  END;

  INSERT INTO public.data_audit_log (
    table_name,
    operation,
    row_id,
    organization_id,
    chantier_id,
    plan_id,
    actor_id,
    actor_role,
    old_row,
    new_row
  )
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    v_row->>'id',
    v_org,
    v_row->>'chantier_id',
    COALESCE(v_row->>'plan_id', v_row->>'parent_plan_id'),
    auth.uid(),
    v_actor_role,
    v_old,
    v_new
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_reserves_changes ON public.reserves;
CREATE TRIGGER trg_audit_reserves_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.reserves
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit_photos_changes ON public.photos;
CREATE TRIGGER trg_audit_photos_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.photos
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit_site_plans_changes ON public.site_plans;
CREATE TRIGGER trg_audit_site_plans_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.site_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_row_change();

DROP TRIGGER IF EXISTS trg_audit_chantiers_changes ON public.chantiers;
CREATE TRIGGER trg_audit_chantiers_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.chantiers
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_row_change();

CREATE OR REPLACE FUNCTION public.prevent_unsafe_reserve_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF public.auth_user_role() = 'super_admin'
     OR current_setting('app.allow_hard_delete_reserves', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Hard delete on reserves is blocked. Use deleted_at soft delete.'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unsafe_reserve_hard_delete ON public.reserves;
CREATE TRIGGER trg_prevent_unsafe_reserve_hard_delete
  BEFORE DELETE ON public.reserves
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unsafe_reserve_hard_delete();

CREATE OR REPLACE FUNCTION public.prevent_chantier_delete_with_reserves()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.reserves WHERE chantier_id = OLD.id LIMIT 1) THEN
    RAISE EXCEPTION 'Hard delete on chantier is blocked while reserves are attached.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_chantier_delete_with_reserves ON public.chantiers;
CREATE TRIGGER trg_prevent_chantier_delete_with_reserves
  BEFORE DELETE ON public.chantiers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_chantier_delete_with_reserves();

DROP POLICY IF EXISTS "photos_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "photos_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "photos_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "Photos upload authentifie" ON storage.objects;
DROP POLICY IF EXISTS "Photos suppression authentifie" ON storage.objects;
DROP POLICY IF EXISTS "documents_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "documents_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "documents_auth_delete" ON storage.objects;
DROP POLICY IF EXISTS "Documents upload authentifie" ON storage.objects;
DROP POLICY IF EXISTS "Documents suppression authentifie" ON storage.objects;

DROP POLICY IF EXISTS "photos_update_privileged" ON storage.objects;
CREATE POLICY "photos_update_privileged"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'photos'
    AND public.auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
  )
  WITH CHECK (
    bucket_id = 'photos'
    AND public.auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
  );

DROP POLICY IF EXISTS "photos_delete_privileged" ON storage.objects;
CREATE POLICY "photos_delete_privileged"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'photos'
    AND public.auth_user_role() IN ('super_admin', 'admin')
  );

DROP POLICY IF EXISTS "documents_update_privileged" ON storage.objects;
CREATE POLICY "documents_update_privileged"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documents'
    AND public.auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND public.auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
  );

DROP POLICY IF EXISTS "documents_delete_privileged" ON storage.objects;
CREATE POLICY "documents_delete_privileged"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND public.auth_user_role() IN ('super_admin', 'admin')
  );

NOTIFY pgrst, 'reload schema';
