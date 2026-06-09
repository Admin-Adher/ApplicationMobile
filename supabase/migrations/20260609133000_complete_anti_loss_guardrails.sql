-- Complete anti-loss guardrails for reserves, photos, plans, and projects.
-- This migration keeps critical business rows recoverable, makes reserve
-- creation with photo metadata atomic, and blocks unsafe plan file changes.

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS deleted_reason text;

ALTER TABLE public.site_plans
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS deleted_reason text,
  ADD COLUMN IF NOT EXISTS file_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS file_deleted_by text,
  ADD COLUMN IF NOT EXISTS file_deleted_reason text,
  ADD COLUMN IF NOT EXISTS replaced_by_plan_id text;

ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text,
  ADD COLUMN IF NOT EXISTS deleted_reason text;

CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON public.photos (deleted_at);
CREATE INDEX IF NOT EXISTS idx_site_plans_deleted_at ON public.site_plans (deleted_at);
CREATE INDEX IF NOT EXISTS idx_chantiers_deleted_at ON public.chantiers (deleted_at);
CREATE INDEX IF NOT EXISTS idx_reserves_plan_active
  ON public.reserves (plan_id)
  WHERE deleted_at IS NULL AND archived_at IS NULL;

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
  v_reason text := NULLIF(current_setting('app.audit_reason', true), '');
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
    new_row,
    reason
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
    v_new,
    v_reason
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

CREATE OR REPLACE FUNCTION public.prevent_unsafe_reserve_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.allow_hard_delete_critical', true) = 'on'
     OR current_setting('app.allow_hard_delete_reserves', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Hard delete on reserves is blocked. Use deleted_at soft delete.'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_unsafe_critical_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.allow_hard_delete_critical', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'Hard delete on % is blocked. Use deleted_at soft delete.', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unsafe_photo_hard_delete ON public.photos;
CREATE TRIGGER trg_prevent_unsafe_photo_hard_delete
  BEFORE DELETE ON public.photos
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unsafe_critical_hard_delete();

DROP TRIGGER IF EXISTS trg_prevent_unsafe_site_plan_hard_delete ON public.site_plans;
CREATE TRIGGER trg_prevent_unsafe_site_plan_hard_delete
  BEFORE DELETE ON public.site_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unsafe_critical_hard_delete();

DROP TRIGGER IF EXISTS trg_prevent_unsafe_chantier_hard_delete ON public.chantiers;
CREATE TRIGGER trg_prevent_unsafe_chantier_hard_delete
  BEFORE DELETE ON public.chantiers
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_unsafe_critical_hard_delete();

CREATE OR REPLACE FUNCTION public.enforce_photo_soft_delete_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NOT public.auth_user_has_permission('canDelete') THEN
      RAISE EXCEPTION 'Mise en corbeille photo non autorisee pour ces permissions'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_photo_soft_delete_permission ON public.photos;
CREATE TRIGGER trg_enforce_photo_soft_delete_permission
  BEFORE UPDATE ON public.photos
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_photo_soft_delete_permission();

CREATE OR REPLACE FUNCTION public.enforce_chantier_soft_delete_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_reserve_count integer := 0;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF NOT public.auth_user_has_permission('canDelete') THEN
      RAISE EXCEPTION 'Mise en corbeille chantier non autorisee pour ces permissions'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) INTO v_reserve_count
    FROM public.reserves
    WHERE chantier_id = OLD.id;

    IF v_reserve_count > 0 THEN
      RAISE EXCEPTION 'Mise en corbeille chantier bloquee: % reserve(s) rattachee(s).', v_reserve_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_chantier_soft_delete_permission ON public.chantiers;
CREATE TRIGGER trg_enforce_chantier_soft_delete_permission
  BEFORE UPDATE ON public.chantiers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_chantier_soft_delete_permission();

CREATE OR REPLACE FUNCTION public.enforce_site_plan_file_delete_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_file_changed boolean := false;
  v_file_cleared boolean := false;
  v_soft_deleted boolean := false;
  v_active_reserve_count integer := 0;
  v_controlled_change boolean := false;
BEGIN
  v_file_changed :=
    NEW.uri IS DISTINCT FROM OLD.uri
    OR NEW.file_type IS DISTINCT FROM OLD.file_type
    OR NEW.dxf_name IS DISTINCT FROM OLD.dxf_name
    OR NEW.size IS DISTINCT FROM OLD.size
    OR NEW.pdf_page_count IS DISTINCT FROM OLD.pdf_page_count;

  v_file_cleared :=
    NEW.uri IS NULL
    AND NEW.file_type IS NULL
    AND NEW.dxf_name IS NULL
    AND NEW.size IS NULL
    AND (
      OLD.uri IS NOT NULL
      OR OLD.file_type IS NOT NULL
      OR OLD.dxf_name IS NOT NULL
      OR OLD.size IS NOT NULL
    );

  v_soft_deleted := NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL;
  v_controlled_change := current_setting('app.allow_controlled_plan_file_change', true) = 'on';

  IF v_file_changed OR v_soft_deleted THEN
    SELECT count(*) INTO v_active_reserve_count
    FROM public.reserves
    WHERE plan_id = OLD.id
      AND deleted_at IS NULL
      AND archived_at IS NULL;
  END IF;

  IF v_soft_deleted THEN
    IF NOT public.auth_user_has_permission('canDelete') THEN
      RAISE EXCEPTION 'Mise en corbeille plan non autorisee pour ces permissions'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_active_reserve_count > 0 THEN
      RAISE EXCEPTION 'Mise en corbeille plan bloquee: % reserve(s) active(s) rattachee(s). Creez une revision et migrez les reserves avant.', v_active_reserve_count
        USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  IF v_file_cleared THEN
    IF NOT public.auth_user_has_permission('canDelete') THEN
      RAISE EXCEPTION 'Suppression du fichier plan non autorisee pour ces permissions'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_active_reserve_count > 0 AND NOT v_controlled_change THEN
      RAISE EXCEPTION 'Suppression/remplacement du fichier plan bloquee: % reserve(s) epinglee(s) seraient fragilisees.', v_active_reserve_count
        USING ERRCODE = 'P0001';
    END IF;

    NEW.file_deleted_at := COALESCE(NEW.file_deleted_at, now());
    NEW.file_deleted_by := COALESCE(NEW.file_deleted_by, public.auth_user_role(), auth.uid()::text, 'system');
    RETURN NEW;
  END IF;

  IF v_file_changed AND v_active_reserve_count > 0 AND NOT v_controlled_change THEN
    RAISE EXCEPTION 'Remplacement du fichier plan bloque: % reserve(s) epinglee(s). Utilisez une revision avec migration controlee.', v_active_reserve_count
      USING ERRCODE = 'P0001';
  END IF;

  IF v_file_changed AND v_active_reserve_count > 0 AND NOT public.auth_user_has_permission('canDelete') THEN
    RAISE EXCEPTION 'Remplacement du fichier plan avec reserves rattachees non autorise pour ces permissions'
      USING ERRCODE = 'P0001';
  END IF;

  IF public.auth_user_has_permission('canCreate') OR public.auth_user_has_permission('canDelete') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Modification du plan non autorisee pour ces permissions'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_photo(
  p_photo_id text,
  p_reason text DEFAULT NULL
)
RETURNS public.photos
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_photo public.photos%ROWTYPE;
BEGIN
  IF NOT public.auth_user_has_permission('canDelete') THEN
    RAISE EXCEPTION 'Mise en corbeille photo non autorisee'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(p_reason, 'soft_delete_photo'), true);

  UPDATE public.photos
  SET deleted_at = COALESCE(deleted_at, now()),
      deleted_by = COALESCE(deleted_by, auth.uid()::text),
      deleted_reason = COALESCE(deleted_reason, p_reason)
  WHERE id = p_photo_id
  RETURNING * INTO v_photo;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Photo introuvable: %', p_photo_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_photo;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_site_plan(
  p_plan_id text,
  p_reason text DEFAULT NULL
)
RETURNS public.site_plans
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_plan public.site_plans%ROWTYPE;
  v_active_reserve_count integer := 0;
BEGIN
  IF NOT public.auth_user_has_permission('canDelete') THEN
    RAISE EXCEPTION 'Mise en corbeille plan non autorisee'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_active_reserve_count
  FROM public.reserves
  WHERE plan_id = p_plan_id
    AND deleted_at IS NULL
    AND archived_at IS NULL;

  IF v_active_reserve_count > 0 THEN
    RAISE EXCEPTION 'Mise en corbeille plan bloquee: % reserve(s) active(s) rattachee(s).', v_active_reserve_count
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(p_reason, 'soft_delete_site_plan'), true);

  UPDATE public.site_plans
  SET deleted_at = COALESCE(deleted_at, now()),
      deleted_by = COALESCE(deleted_by, auth.uid()::text),
      deleted_reason = COALESCE(deleted_reason, p_reason)
  WHERE id = p_plan_id
  RETURNING * INTO v_plan;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan introuvable: %', p_plan_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_plan;
END;
$$;

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
  WHERE chantier_id = p_chantier_id;

  IF v_reserve_count > 0 THEN
    RAISE EXCEPTION 'Mise en corbeille chantier bloquee: % reserve(s) rattachee(s).', v_reserve_count
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.audit_reason', COALESCE(p_reason, 'soft_delete_chantier'), true);

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

CREATE OR REPLACE FUNCTION public.create_reserve_with_photos(
  p_reserve jsonb,
  p_photo_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS public.reserves
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reserve public.reserves%ROWTYPE;
  v_photo jsonb;
  v_photo_id text;
  v_org uuid;
  v_plan_deleted_at timestamptz;
BEGIN
  IF NULLIF(p_reserve->>'id', '') IS NULL THEN
    RAISE EXCEPTION 'Reserve id is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(p_reserve->>'plan_id', '') IS NOT NULL THEN
    SELECT deleted_at INTO v_plan_deleted_at
    FROM public.site_plans
    WHERE id = p_reserve->>'plan_id';

    IF v_plan_deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'Creation reserve bloquee: le plan % est en corbeille.', p_reserve->>'plan_id'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_org := COALESCE(NULLIF(p_reserve->>'organization_id', '')::uuid, public.auth_user_org());
  PERFORM set_config('app.audit_reason', 'create_reserve_with_photos', true);

  INSERT INTO public.reserves (
    id, title, description, building, zone, level, company, companies,
    priority, status, created_at, deadline, comments, history, plan_x, plan_y,
    photo_uri, responsable_nom, chantier_id, plan_id, lot_id, kind, visite_id,
    linked_task_id, photos, photo_annotations, enterprise_signature,
    enterprise_signataire, enterprise_acknowledged_at, closed_at, closed_by,
    company_signatures, organization_id, archived_at, archived_by, deleted_at,
    deleted_by, building_id, level_id
  )
  VALUES (
    p_reserve->>'id',
    COALESCE(NULLIF(p_reserve->>'title', ''), 'Reserve'),
    p_reserve->>'description',
    p_reserve->>'building',
    p_reserve->>'zone',
    p_reserve->>'level',
    p_reserve->>'company',
    CASE WHEN jsonb_typeof(p_reserve->'companies') = 'array' THEN p_reserve->'companies' ELSE NULL END,
    COALESCE(NULLIF(p_reserve->>'priority', ''), 'medium'),
    COALESCE(NULLIF(p_reserve->>'status', ''), 'open'),
    p_reserve->>'created_at',
    p_reserve->>'deadline',
    CASE WHEN jsonb_typeof(p_reserve->'comments') = 'array' THEN p_reserve->'comments' ELSE '[]'::jsonb END,
    CASE WHEN jsonb_typeof(p_reserve->'history') = 'array' THEN p_reserve->'history' ELSE '[]'::jsonb END,
    NULLIF(p_reserve->>'plan_x', '')::integer,
    NULLIF(p_reserve->>'plan_y', '')::integer,
    p_reserve->>'photo_uri',
    p_reserve->>'responsable_nom',
    p_reserve->>'chantier_id',
    p_reserve->>'plan_id',
    p_reserve->>'lot_id',
    p_reserve->>'kind',
    p_reserve->>'visite_id',
    p_reserve->>'linked_task_id',
    CASE WHEN jsonb_typeof(p_reserve->'photos') = 'array' THEN p_reserve->'photos' ELSE NULL END,
    CASE WHEN jsonb_typeof(p_reserve->'photo_annotations') = 'array' THEN p_reserve->'photo_annotations' ELSE NULL END,
    p_reserve->>'enterprise_signature',
    p_reserve->>'enterprise_signataire',
    p_reserve->>'enterprise_acknowledged_at',
    p_reserve->>'closed_at',
    p_reserve->>'closed_by',
    CASE WHEN jsonb_typeof(p_reserve->'company_signatures') = 'object' THEN p_reserve->'company_signatures' ELSE NULL END,
    v_org,
    NULLIF(p_reserve->>'archived_at', '')::timestamptz,
    p_reserve->>'archived_by',
    NULLIF(p_reserve->>'deleted_at', '')::timestamptz,
    p_reserve->>'deleted_by',
    p_reserve->>'building_id',
    p_reserve->>'level_id'
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    building = EXCLUDED.building,
    zone = EXCLUDED.zone,
    level = EXCLUDED.level,
    company = EXCLUDED.company,
    companies = EXCLUDED.companies,
    priority = EXCLUDED.priority,
    status = EXCLUDED.status,
    deadline = EXCLUDED.deadline,
    comments = EXCLUDED.comments,
    history = EXCLUDED.history,
    plan_x = EXCLUDED.plan_x,
    plan_y = EXCLUDED.plan_y,
    photo_uri = EXCLUDED.photo_uri,
    chantier_id = EXCLUDED.chantier_id,
    plan_id = EXCLUDED.plan_id,
    lot_id = EXCLUDED.lot_id,
    kind = EXCLUDED.kind,
    visite_id = EXCLUDED.visite_id,
    linked_task_id = EXCLUDED.linked_task_id,
    photos = EXCLUDED.photos,
    photo_annotations = EXCLUDED.photo_annotations,
    company_signatures = EXCLUDED.company_signatures,
    organization_id = EXCLUDED.organization_id,
    building_id = EXCLUDED.building_id,
    level_id = EXCLUDED.level_id
  RETURNING * INTO v_reserve;

  IF jsonb_typeof(p_photo_rows) = 'array' THEN
    FOR v_photo IN SELECT * FROM jsonb_array_elements(p_photo_rows)
    LOOP
      IF NULLIF(v_photo->>'uri', '') IS NULL THEN
        CONTINUE;
      END IF;

      v_photo_id := COALESCE(NULLIF(v_photo->>'id', ''), 'PHOTO-' || replace(gen_random_uuid()::text, '-', ''));

      INSERT INTO public.photos (
        id, comment, location, taken_at, taken_by, color_code, uri, reserve_id, organization_id
      )
      VALUES (
        v_photo_id,
        COALESCE(NULLIF(v_photo->>'comment', ''), 'Photo reserve ' || v_reserve.id),
        COALESCE(NULLIF(v_photo->>'location', ''), concat_ws(' - ', v_reserve.building, v_reserve.level, v_reserve.zone)),
        COALESCE(NULLIF(v_photo->>'taken_at', ''), COALESCE(v_reserve.created_at, now()::date::text)),
        COALESCE(NULLIF(v_photo->>'taken_by', ''), 'BuildTrack'),
        COALESCE(NULLIF(v_photo->>'color_code', ''), CASE WHEN v_reserve.kind = 'observation' THEN '#0EA5E9' ELSE '#EF4444' END),
        v_photo->>'uri',
        v_reserve.id,
        v_org
      )
      ON CONFLICT (id) DO UPDATE SET
        comment = EXCLUDED.comment,
        location = EXCLUDED.location,
        taken_at = EXCLUDED.taken_at,
        taken_by = EXCLUDED.taken_by,
        color_code = EXCLUDED.color_code,
        uri = EXCLUDED.uri,
        reserve_id = EXCLUDED.reserve_id,
        organization_id = EXCLUDED.organization_id,
        deleted_at = NULL,
        deleted_by = NULL,
        deleted_reason = NULL;
    END LOOP;
  END IF;

  RETURN v_reserve;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_site_plan_file_safely(
  p_plan_id text,
  p_patch jsonb,
  p_reason text DEFAULT NULL
)
RETURNS public.site_plans
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_plan public.site_plans%ROWTYPE;
  v_updated public.site_plans%ROWTYPE;
  v_active_reserve_count integer := 0;
BEGIN
  SELECT * INTO v_plan
  FROM public.site_plans
  WHERE id = p_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan introuvable: %', p_plan_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Remplacement fichier bloque: le plan est en corbeille.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_active_reserve_count
  FROM public.reserves
  WHERE plan_id = p_plan_id
    AND deleted_at IS NULL
    AND archived_at IS NULL;

  IF v_active_reserve_count > 0 AND NOT public.auth_user_has_permission('canDelete') THEN
    RAISE EXCEPTION 'Remplacement fichier bloque: % reserve(s) rattachee(s), permission suppression requise.', v_active_reserve_count
      USING ERRCODE = 'P0001';
  END IF;

  IF v_active_reserve_count = 0 AND NOT public.auth_user_has_permission('canCreate') THEN
    RAISE EXCEPTION 'Modification du plan non autorisee'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.allow_controlled_plan_file_change', 'on', true);
  PERFORM set_config('app.audit_reason', COALESCE(p_reason, 'replace_site_plan_file_safely'), true);

  UPDATE public.site_plans
  SET
    name = COALESCE(NULLIF(p_patch->>'name', ''), name),
    uri = CASE WHEN p_patch ? 'uri' THEN NULLIF(p_patch->>'uri', '') ELSE uri END,
    file_type = CASE WHEN p_patch ? 'file_type' THEN NULLIF(p_patch->>'file_type', '') ELSE file_type END,
    dxf_name = CASE WHEN p_patch ? 'dxf_name' THEN NULLIF(p_patch->>'dxf_name', '') ELSE dxf_name END,
    size = CASE WHEN p_patch ? 'size' THEN NULLIF(p_patch->>'size', '') ELSE size END,
    uploaded_at = CASE WHEN p_patch ? 'uploaded_at' THEN NULLIF(p_patch->>'uploaded_at', '') ELSE uploaded_at END,
    pdf_page_count = CASE WHEN p_patch ? 'pdf_page_count' THEN NULLIF(p_patch->>'pdf_page_count', '')::integer ELSE pdf_page_count END,
    file_deleted_at = CASE
      WHEN (p_patch ? 'uri') AND NULLIF(p_patch->>'uri', '') IS NULL THEN COALESCE(file_deleted_at, now())
      ELSE file_deleted_at
    END,
    file_deleted_by = CASE
      WHEN (p_patch ? 'uri') AND NULLIF(p_patch->>'uri', '') IS NULL THEN COALESCE(file_deleted_by, auth.uid()::text)
      ELSE file_deleted_by
    END,
    file_deleted_reason = CASE
      WHEN (p_patch ? 'uri') AND NULLIF(p_patch->>'uri', '') IS NULL THEN COALESCE(file_deleted_reason, p_reason)
      ELSE file_deleted_reason
    END
  WHERE id = p_plan_id
  RETURNING * INTO v_updated;

  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_site_plan_revision_with_reserve_migration(
  p_parent_plan_id text,
  p_new_plan jsonb,
  p_migrate_reserves boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_parent public.site_plans%ROWTYPE;
  v_new public.site_plans%ROWTYPE;
  v_revision_number integer;
  v_new_plan_id text;
  v_migrated_count integer := 0;
  v_author text := COALESCE(auth.uid()::text, 'system');
BEGIN
  IF NOT public.auth_user_has_permission('canCreate') THEN
    RAISE EXCEPTION 'Creation de revision non autorisee'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_parent
  FROM public.site_plans
  WHERE id = p_parent_plan_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan parent introuvable: %', p_parent_plan_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_parent.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Creation de revision bloquee: le plan parent est en corbeille.'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_plan_id := COALESCE(NULLIF(p_new_plan->>'id', ''), 'PLAN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)));
  v_revision_number := COALESCE(NULLIF(p_new_plan->>'revision_number', '')::integer, COALESCE(v_parent.revision_number, 1) + 1);

  PERFORM set_config('app.audit_reason', 'create_site_plan_revision_with_reserve_migration', true);

  UPDATE public.site_plans
  SET is_latest_revision = false,
      revision_number = COALESCE(revision_number, COALESCE(v_parent.revision_number, 1))
  WHERE id = p_parent_plan_id;

  INSERT INTO public.site_plans (
    id, chantier_id, name, building, level, building_id, level_id, uri,
    file_type, dxf_name, uploaded_at, size, revision_code, revision_number,
    parent_plan_id, is_latest_revision, revision_note, annotations,
    pdf_page_count, organization_id, replaced_by_plan_id
  )
  VALUES (
    v_new_plan_id,
    COALESCE(NULLIF(p_new_plan->>'chantier_id', ''), v_parent.chantier_id),
    COALESCE(NULLIF(p_new_plan->>'name', ''), v_parent.name),
    COALESCE(NULLIF(p_new_plan->>'building', ''), v_parent.building),
    COALESCE(NULLIF(p_new_plan->>'level', ''), v_parent.level),
    COALESCE(NULLIF(p_new_plan->>'building_id', ''), v_parent.building_id),
    COALESCE(NULLIF(p_new_plan->>'level_id', ''), v_parent.level_id),
    p_new_plan->>'uri',
    p_new_plan->>'file_type',
    p_new_plan->>'dxf_name',
    COALESCE(NULLIF(p_new_plan->>'uploaded_at', ''), now()::date::text),
    p_new_plan->>'size',
    COALESCE(NULLIF(p_new_plan->>'revision_code', ''), 'R' || lpad(v_revision_number::text, 2, '0')),
    v_revision_number,
    p_parent_plan_id,
    true,
    p_new_plan->>'revision_note',
    CASE WHEN jsonb_typeof(p_new_plan->'annotations') = 'array' THEN p_new_plan->'annotations' ELSE '[]'::jsonb END,
    NULLIF(p_new_plan->>'pdf_page_count', '')::integer,
    COALESCE(NULLIF(p_new_plan->>'organization_id', '')::uuid, v_parent.organization_id),
    NULL
  )
  RETURNING * INTO v_new;

  UPDATE public.site_plans
  SET replaced_by_plan_id = v_new.id
  WHERE id = p_parent_plan_id;

  IF p_migrate_reserves THEN
    UPDATE public.reserves
    SET plan_id = v_new.id,
        history = COALESCE(history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', 'plan-migration-' || replace(gen_random_uuid()::text, '-', ''),
          'action', 'Migration vers nouvelle revision plan',
          'author', v_author,
          'createdAt', to_char(now(), 'DD/MM/YYYY HH24:MI'),
          'oldValue', p_parent_plan_id,
          'newValue', v_new.id
        ))
    WHERE plan_id = p_parent_plan_id
      AND deleted_at IS NULL
      AND archived_at IS NULL
      AND status <> 'closed';

    GET DIAGNOSTICS v_migrated_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'plan', to_jsonb(v_new),
    'migrated_count', v_migrated_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_storage_usage_guardrail(
  p_warning_mb numeric DEFAULT 850,
  p_critical_mb numeric DEFAULT 950
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, storage
AS $$
  WITH objects AS (
    SELECT
      bucket_id,
      COALESCE((metadata->>'size')::bigint, 0) AS size_bytes
    FROM storage.objects
  ),
  totals AS (
    SELECT
      COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes,
      ROUND(COALESCE(SUM(size_bytes), 0)::numeric / 1024 / 1024, 2) AS total_mb,
      COUNT(*)::int AS object_count
    FROM objects
  ),
  buckets AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'bucket_id', bucket_id,
      'object_count', object_count,
      'total_mb', total_mb,
      'total_bytes', total_bytes
    ) ORDER BY bucket_id), '[]'::jsonb) AS by_bucket
    FROM (
      SELECT
        bucket_id,
        COUNT(*)::int AS object_count,
        ROUND(SUM(size_bytes)::numeric / 1024 / 1024, 2) AS total_mb,
        SUM(size_bytes)::bigint AS total_bytes
      FROM objects
      GROUP BY bucket_id
    ) b
  )
  SELECT jsonb_build_object(
    'total_bytes', totals.total_bytes,
    'total_mb', totals.total_mb,
    'object_count', totals.object_count,
    'warning_mb', p_warning_mb,
    'critical_mb', p_critical_mb,
    'status', CASE
      WHEN totals.total_mb >= p_critical_mb THEN 'critical'
      WHEN totals.total_mb >= p_warning_mb THEN 'warning'
      ELSE 'ok'
    END,
    'buckets', buckets.by_bucket
  )
  FROM totals, buckets;
$$;

REVOKE ALL ON FUNCTION public.prevent_unsafe_critical_hard_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_photo_soft_delete_permission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_chantier_soft_delete_permission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.soft_delete_photo(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.soft_delete_site_plan(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.soft_delete_chantier(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_reserve_with_photos(jsonb, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.replace_site_plan_file_safely(text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_site_plan_revision_with_reserve_migration(text, jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_storage_usage_guardrail(numeric, numeric) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.soft_delete_photo(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_site_plan(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_chantier(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reserve_with_photos(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_site_plan_file_safely(text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_site_plan_revision_with_reserve_migration(text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_storage_usage_guardrail(numeric, numeric) TO authenticated;

NOTIFY pgrst, 'reload schema';
