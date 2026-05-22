-- Fix invitation linking after signup/login.
--
-- Run this in Supabase SQL Editor with "Run without RLS" if prompted.
-- It does not create tables; it replaces RPC functions.

DROP FUNCTION IF EXISTS public.link_invitation_for_current_user();
DROP FUNCTION IF EXISTS public.link_invitation_for_current_user(text);

CREATE OR REPLACE FUNCTION public.link_invitation_for_current_user(
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $body$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_inv record;
  v_name text;
  v_role_label text;
  v_accepted_now boolean := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'not_authenticated');
  END IF;

  SELECT email
  INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  IF v_user_email IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'user_not_found');
  END IF;

  SELECT *
  INTO v_inv
  FROM public.invitations
  WHERE lower(email) = lower(v_user_email)
    AND (
      (status = 'pending' AND expires_at > now())
      OR (status = 'accepted' AND expires_at > now())
    )
  ORDER BY
    CASE WHEN status = 'pending' THEN 0 ELSE 1 END,
    created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'no_invitation');
  END IF;

  v_name := NULLIF(trim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    SELECT name INTO v_name FROM public.profiles WHERE id = v_user_id;
  END IF;
  IF v_name IS NULL OR v_name = '' THEN
    SELECT COALESCE(
      raw_user_meta_data->>'name',
      raw_user_meta_data->>'full_name',
      split_part(email, '@', 1)
    )
    INTO v_name
    FROM auth.users
    WHERE id = v_user_id;
  END IF;

  v_role_label := CASE v_inv.role
    WHEN 'super_admin' THEN 'Super Administrateur'
    WHEN 'admin' THEN 'Administrateur'
    WHEN 'conducteur' THEN 'Conducteur de travaux'
    WHEN 'chef_equipe' THEN 'Chef d''equipe'
    WHEN 'observateur' THEN 'Observateur'
    WHEN 'sous_traitant' THEN 'Sous-traitant'
    ELSE v_inv.role
  END;

  INSERT INTO public.profiles (id, name, email, role, role_label, organization_id, company_id)
  VALUES (
    v_user_id,
    v_name,
    lower(v_user_email),
    v_inv.role,
    v_role_label,
    v_inv.organization_id,
    v_inv.company_id
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(NULLIF(EXCLUDED.name, ''), public.profiles.name),
    email = COALESCE(public.profiles.email, EXCLUDED.email),
    role = EXCLUDED.role,
    role_label = EXCLUDED.role_label,
    organization_id = EXCLUDED.organization_id,
    company_id = COALESCE(EXCLUDED.company_id, public.profiles.company_id);

  IF v_inv.status = 'pending' THEN
    UPDATE public.invitations
    SET status = 'accepted'
    WHERE id = v_inv.id;
    v_accepted_now := true;
  END IF;

  BEGIN
    UPDATE public.channels
    SET members = members || jsonb_build_array(v_name)
    WHERE organization_id = v_inv.organization_id
      AND type = 'general'
      AND NOT (members @> jsonb_build_array(v_name));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'linked', true,
    'organization_id', v_inv.organization_id,
    'role', v_inv.role,
    'invitation_id', v_inv.id,
    'invitation_status', v_inv.status,
    'accepted_now', v_accepted_now
  );
END;
$body$;

GRANT EXECUTE ON FUNCTION public.link_invitation_for_current_user(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_pending_invitation(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $body$
  SELECT EXISTS (
    SELECT 1
    FROM public.invitations i
    WHERE lower(i.email) = lower(nullif(trim(p_email), ''))
      AND (
        (i.status = 'pending' AND i.expires_at > now())
        OR (
          i.status = 'accepted'
          AND i.expires_at > now()
          AND NOT EXISTS (
            SELECT 1
            FROM public.profiles p
            WHERE lower(p.email) = lower(i.email)
              AND p.organization_id IS NOT NULL
          )
        )
      )
  );
$body$;

GRANT EXECUTE ON FUNCTION public.check_pending_invitation(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_pending_invitation(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
