CREATE OR REPLACE FUNCTION public.soft_delete_chantier(
  p_chantier_id text,
  p_reason text DEFAULT NULL
)
RETURNS public.chantiers
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_chantier public.chantiers%ROWTYPE;
  v_reserve_count integer := 0;
BEGIN
  IF NOT public.auth_user_has_permission('canDelete') THEN
    RAISE EXCEPTION 'Mise en corbeille chantier non autorisee'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_reserve_count
  FROM public.reserves
  WHERE chantier_id = p_chantier_id
    AND deleted_at IS NULL
    AND archived_at IS NULL;

  IF v_reserve_count > 0 THEN
    RAISE EXCEPTION 'Mise en corbeille chantier bloquee: % reserve(s) active(s) rattachee(s).', v_reserve_count
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(p_reason, 'soft_delete_chantier'), true);

  UPDATE public.site_plans
  SET deleted_at = COALESCE(deleted_at, now()),
      deleted_by = COALESCE(deleted_by, auth.uid()::text),
      deleted_reason = COALESCE(deleted_reason, COALESCE(p_reason, 'soft_delete_chantier')),
      file_deleted_at = CASE WHEN uri IS NOT NULL THEN COALESCE(file_deleted_at, now()) ELSE file_deleted_at END,
      file_deleted_by = CASE WHEN uri IS NOT NULL THEN COALESCE(file_deleted_by, auth.uid()::text) ELSE file_deleted_by END,
      file_deleted_reason = CASE WHEN uri IS NOT NULL THEN COALESCE(file_deleted_reason, COALESCE(p_reason, 'soft_delete_chantier')) ELSE file_deleted_reason END
  WHERE chantier_id = p_chantier_id
    AND deleted_at IS NULL;

  UPDATE public.chantiers
  SET deleted_at = COALESCE(deleted_at, now()),
      deleted_by = COALESCE(deleted_by, auth.uid()::text),
      deleted_reason = COALESCE(deleted_reason, p_reason)
  WHERE id = p_chantier_id
  RETURNING * INTO v_chantier;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chantier introuvable: %', p_chantier_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_chantier;
END;
$$;

REVOKE ALL ON FUNCTION public.soft_delete_chantier(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_chantier(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
