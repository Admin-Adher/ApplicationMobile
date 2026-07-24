-- Production migration: stop the reserve/photo retry loop from amplifying into audit, WAL and
-- Realtime saturation on the production nano compute.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Several historical migrations shared the same 20260424 version, so this
-- column never reached production even though the cron/API already uses it.
ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS overdue_last_notified_date date;

ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0;

-- Do not serialize and store full OLD/NEW rows when an UPSERT does not change
-- anything. This also prevents an unnecessary audit-table write.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_org uuid := NULL;
  v_actor_role text := NULL;
  v_reason text := NULLIF(current_setting('app.audit_reason', true), '');
BEGIN
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NEW;
  END IF;

  v_old := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD)
    ELSE NULL
  END;
  v_new := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW)
    ELSE NULL
  END;
  v_row := COALESCE(v_new, v_old);

  BEGIN
    v_actor_role := public.auth_user_role();
  EXCEPTION WHEN OTHERS THEN
    v_actor_role := NULL;
  END;

  BEGIN
    IF v_row ? 'organization_id'
       AND NULLIF(v_row->>'organization_id', '') IS NOT NULL THEN
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
$function$;

REVOKE ALL ON FUNCTION public.audit_row_change()
  FROM PUBLIC, anon, authenticated;

-- Consolidate the accumulated FOR ALL policies. Realtime evaluates SELECT RLS
-- for every change; FOR ALL policies were making those checks both duplicated
-- and much more expensive than necessary.
DO $block$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('reserves', 'photos')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  END LOOP;
END;
$block$;

CREATE POLICY reserves_select
ON public.reserves
FOR SELECT
TO authenticated
USING (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role()) = 'sous_traitant'
    AND public.reserve_matches_current_user_company(
      reserves.company,
      reserves.companies
    )
  )
  OR (
    (SELECT public.auth_user_role()) IS NOT NULL
    AND (SELECT public.auth_user_role()) <> 'sous_traitant'
    AND (
      reserves.organization_id = (SELECT public.auth_user_org())
      OR EXISTS (
        SELECT 1
        FROM public.chantiers c
        WHERE c.id = reserves.chantier_id
          AND c.organization_id = (SELECT public.auth_user_org())
      )
    )
  )
);

CREATE POLICY reserves_insert
ON public.reserves
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      organization_id = (SELECT public.auth_user_org())
      OR EXISTS (
        SELECT 1
        FROM public.chantiers c
        WHERE c.id = reserves.chantier_id
          AND c.organization_id = (SELECT public.auth_user_org())
      )
    )
  )
);

CREATE POLICY reserves_update
ON public.reserves
FOR UPDATE
TO authenticated
USING (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      organization_id = (SELECT public.auth_user_org())
      OR EXISTS (
        SELECT 1
        FROM public.chantiers c
        WHERE c.id = reserves.chantier_id
          AND c.organization_id = (SELECT public.auth_user_org())
      )
    )
  )
)
WITH CHECK (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      organization_id = (SELECT public.auth_user_org())
      OR EXISTS (
        SELECT 1
        FROM public.chantiers c
        WHERE c.id = reserves.chantier_id
          AND c.organization_id = (SELECT public.auth_user_org())
      )
    )
  )
);

CREATE POLICY reserves_delete
ON public.reserves
FOR DELETE
TO authenticated
USING (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      organization_id = (SELECT public.auth_user_org())
      OR EXISTS (
        SELECT 1
        FROM public.chantiers c
        WHERE c.id = reserves.chantier_id
          AND c.organization_id = (SELECT public.auth_user_org())
      )
    )
  )
);

CREATE POLICY reserves_sousstraitant_update
ON public.reserves
FOR UPDATE
TO authenticated
USING (
  (SELECT public.auth_user_role()) = 'sous_traitant'
  AND public.reserve_matches_current_user_company(company, companies)
)
WITH CHECK (
  (SELECT public.auth_user_role()) = 'sous_traitant'
  AND public.reserve_matches_current_user_company(company, companies)
);

CREATE POLICY photos_select
ON public.photos
FOR SELECT
TO authenticated
USING (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role()) = 'sous_traitant'
    AND reserve_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.reserves r
      WHERE r.id = photos.reserve_id
        AND public.reserve_matches_current_user_company(r.company, r.companies)
    )
  )
  OR (
    (SELECT public.auth_user_role()) IS NOT NULL
    AND (SELECT public.auth_user_role()) <> 'sous_traitant'
    AND (
      organization_id = (SELECT public.auth_user_org())
      OR EXISTS (
        SELECT 1
        FROM public.reserves r
        LEFT JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id
          AND COALESCE(r.organization_id, c.organization_id)
            = (SELECT public.auth_user_org())
      )
    )
  )
);

CREATE POLICY photos_insert
ON public.photos
FOR INSERT
TO authenticated
WITH CHECK (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role()) = 'sous_traitant'
    AND reserve_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.reserves r
      WHERE r.id = photos.reserve_id
        AND public.reserve_matches_current_user_company(r.company, r.companies)
    )
  )
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      (reserve_id IS NULL
       AND organization_id = (SELECT public.auth_user_org()))
      OR EXISTS (
        SELECT 1
        FROM public.reserves r
        LEFT JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id
          AND COALESCE(r.organization_id, c.organization_id)
            = (SELECT public.auth_user_org())
      )
    )
  )
);

CREATE POLICY photos_update
ON public.photos
FOR UPDATE
TO authenticated
USING (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role()) = 'sous_traitant'
    AND reserve_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.reserves r
      WHERE r.id = photos.reserve_id
        AND public.reserve_matches_current_user_company(r.company, r.companies)
    )
  )
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      (reserve_id IS NULL
       AND organization_id = (SELECT public.auth_user_org()))
      OR EXISTS (
        SELECT 1
        FROM public.reserves r
        LEFT JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id
          AND COALESCE(r.organization_id, c.organization_id)
            = (SELECT public.auth_user_org())
      )
    )
  )
)
WITH CHECK (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role()) = 'sous_traitant'
    AND reserve_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.reserves r
      WHERE r.id = photos.reserve_id
        AND public.reserve_matches_current_user_company(r.company, r.companies)
    )
  )
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      (reserve_id IS NULL
       AND organization_id = (SELECT public.auth_user_org()))
      OR EXISTS (
        SELECT 1
        FROM public.reserves r
        LEFT JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id
          AND COALESCE(r.organization_id, c.organization_id)
            = (SELECT public.auth_user_org())
      )
    )
  )
);

CREATE POLICY photos_delete
ON public.photos
FOR DELETE
TO authenticated
USING (
  (SELECT public.auth_user_role()) = 'super_admin'
  OR (
    (SELECT public.auth_user_role()) = 'sous_traitant'
    AND reserve_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.reserves r
      WHERE r.id = photos.reserve_id
        AND public.reserve_matches_current_user_company(r.company, r.companies)
    )
  )
  OR (
    (SELECT public.auth_user_role())
      IN ('admin', 'conducteur', 'chef_equipe')
    AND (
      (reserve_id IS NULL
       AND organization_id = (SELECT public.auth_user_org()))
      OR EXISTS (
        SELECT 1
        FROM public.reserves r
        LEFT JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id
          AND COALESCE(r.organization_id, c.organization_id)
            = (SELECT public.auth_user_org())
      )
    )
  )
);

-- Put an idempotency guard in front of the existing implementation. A replay
-- that was already committed becomes a primary-key read instead of another
-- UPDATE + audit row + FULL replica WAL event.
ALTER FUNCTION public.create_reserve_with_photos(jsonb, jsonb)
  RENAME TO create_reserve_with_photos_unconditional_v1;

CREATE FUNCTION public.create_reserve_with_photos(
  p_reserve jsonb,
  p_photo_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS public.reserves
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_reserve public.reserves%ROWTYPE;
  v_org uuid;
  v_photos_match boolean := false;
BEGIN
  IF NULLIF(p_reserve->>'id', '') IS NULL THEN
    RAISE EXCEPTION 'Reserve id is required'
      USING ERRCODE = 'P0001';
  END IF;

  v_org := COALESCE(
    NULLIF(p_reserve->>'organization_id', '')::uuid,
    public.auth_user_org()
  );

  SELECT *
  INTO v_reserve
  FROM public.reserves
  WHERE id = p_reserve->>'id';

  IF FOUND THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(p_photo_rows) = 'array' THEN p_photo_rows
          ELSE '[]'::jsonb
        END
      ) AS incoming(photo)
      LEFT JOIN public.photos current_photo
        ON current_photo.id = NULLIF(incoming.photo->>'id', '')
      WHERE NULLIF(incoming.photo->>'uri', '') IS NOT NULL
        AND (
          NULLIF(incoming.photo->>'id', '') IS NULL
          OR current_photo.id IS NULL
          OR ROW(
            current_photo.comment,
            current_photo.location,
            current_photo.taken_at,
            current_photo.taken_by,
            current_photo.color_code,
            current_photo.uri,
            current_photo.reserve_id,
            current_photo.organization_id,
            current_photo.deleted_at,
            current_photo.deleted_by,
            current_photo.deleted_reason
          ) IS DISTINCT FROM ROW(
            COALESCE(
              NULLIF(incoming.photo->>'comment', ''),
              'Photo reserve ' || v_reserve.id
            ),
            COALESCE(
              NULLIF(incoming.photo->>'location', ''),
              concat_ws(
                ' - ',
                v_reserve.building,
                v_reserve.level,
                v_reserve.zone
              )
            ),
            COALESCE(
              NULLIF(incoming.photo->>'taken_at', ''),
              COALESCE(v_reserve.created_at, now()::date::text)
            ),
            COALESCE(NULLIF(incoming.photo->>'taken_by', ''), 'BuildTrack'),
            COALESCE(
              NULLIF(incoming.photo->>'color_code', ''),
              CASE
                WHEN v_reserve.kind = 'observation' THEN '#0EA5E9'
                ELSE '#EF4444'
              END
            ),
            incoming.photo->>'uri',
            v_reserve.id,
            v_org,
            NULL::timestamptz,
            NULL::text,
            NULL::text
          )
        )
    )
    INTO v_photos_match;

    IF ROW(
      v_reserve.title,
      v_reserve.description,
      v_reserve.building,
      v_reserve.zone,
      v_reserve.level,
      v_reserve.company,
      v_reserve.companies,
      v_reserve.priority,
      v_reserve.status,
      v_reserve.deadline,
      v_reserve.comments,
      v_reserve.history,
      v_reserve.plan_x,
      v_reserve.plan_y,
      v_reserve.photo_uri,
      v_reserve.chantier_id,
      v_reserve.plan_id,
      v_reserve.lot_id,
      v_reserve.kind,
      v_reserve.visite_id,
      v_reserve.linked_task_id,
      v_reserve.photos,
      v_reserve.photo_annotations,
      v_reserve.company_signatures,
      v_reserve.organization_id,
      v_reserve.building_id,
      v_reserve.level_id
    ) IS NOT DISTINCT FROM ROW(
      COALESCE(NULLIF(p_reserve->>'title', ''), 'Reserve'),
      p_reserve->>'description',
      p_reserve->>'building',
      p_reserve->>'zone',
      p_reserve->>'level',
      p_reserve->>'company',
      CASE
        WHEN jsonb_typeof(p_reserve->'companies') = 'array'
          THEN p_reserve->'companies'
        ELSE NULL
      END,
      COALESCE(NULLIF(p_reserve->>'priority', ''), 'medium'),
      COALESCE(NULLIF(p_reserve->>'status', ''), 'open'),
      p_reserve->>'deadline',
      CASE
        WHEN jsonb_typeof(p_reserve->'comments') = 'array'
          THEN p_reserve->'comments'
        ELSE '[]'::jsonb
      END,
      CASE
        WHEN jsonb_typeof(p_reserve->'history') = 'array'
          THEN p_reserve->'history'
        ELSE '[]'::jsonb
      END,
      NULLIF(p_reserve->>'plan_x', '')::integer,
      NULLIF(p_reserve->>'plan_y', '')::integer,
      p_reserve->>'photo_uri',
      p_reserve->>'chantier_id',
      p_reserve->>'plan_id',
      p_reserve->>'lot_id',
      p_reserve->>'kind',
      p_reserve->>'visite_id',
      p_reserve->>'linked_task_id',
      CASE
        WHEN jsonb_typeof(p_reserve->'photos') = 'array'
          THEN p_reserve->'photos'
        ELSE NULL
      END,
      CASE
        WHEN jsonb_typeof(p_reserve->'photo_annotations') = 'array'
          THEN p_reserve->'photo_annotations'
        ELSE NULL
      END,
      CASE
        WHEN jsonb_typeof(p_reserve->'company_signatures') = 'object'
          THEN p_reserve->'company_signatures'
        ELSE NULL
      END,
      v_org,
      p_reserve->>'building_id',
      p_reserve->>'level_id'
    )
    AND v_photos_match THEN
      RETURN v_reserve;
    END IF;
  END IF;

  RETURN public.create_reserve_with_photos_unconditional_v1(
    p_reserve,
    p_photo_rows
  );
END;
$function$;

REVOKE ALL
ON FUNCTION public.create_reserve_with_photos(jsonb, jsonb)
FROM PUBLIC, anon;

REVOKE ALL
ON FUNCTION public.create_reserve_with_photos_unconditional_v1(jsonb, jsonb)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_reserve_with_photos(jsonb, jsonb)
TO authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.create_reserve_with_photos_unconditional_v1(jsonb, jsonb)
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
