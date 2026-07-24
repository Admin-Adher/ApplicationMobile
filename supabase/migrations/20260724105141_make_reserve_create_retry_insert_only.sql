CREATE OR REPLACE FUNCTION public.create_reserve_with_photos(
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
  v_reserve_id text;
BEGIN
  v_reserve_id := NULLIF(p_reserve->>'id', '');
  IF v_reserve_id IS NULL THEN
    RAISE EXCEPTION 'Reserve id is required'
      USING ERRCODE = 'P0001';
  END IF;

  -- Serialize concurrent/retried creates for the same logical reserve. The
  -- first transaction performs the insert; every later retry observes and
  -- returns that committed row without replaying a stale creation snapshot.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_reserve_id, 0));

  SELECT *
  INTO v_reserve
  FROM public.reserves
  WHERE id = v_reserve_id;

  IF FOUND THEN
    RETURN v_reserve;
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

GRANT EXECUTE
ON FUNCTION public.create_reserve_with_photos(jsonb, jsonb)
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
