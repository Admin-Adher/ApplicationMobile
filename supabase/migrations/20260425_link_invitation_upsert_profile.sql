-- ============================================================
-- FIX : link_invitation_for_current_user crée le profil s'il manque
-- Date : 2026-04-25
--
-- Problème :
--   Lors de l'inscription via lien d'invitation, le client appelait
--   supabase.auth.signUp() puis IMMÉDIATEMENT INSERT INTO profiles.
--   Quand Supabase a "Confirm email" activé (ou sur des connexions
--   lentes où la session n'est pas encore propagée dans les headers
--   du client), supabase.auth.signUp() retourne { session: null }.
--   Le INSERT côté client s'exécute alors avec auth.uid() = NULL et
--   est silencieusement bloqué par la policy RLS
--     "Profil créable par son propriétaire" (auth.uid() = id).
--   Résultat :
--     • L'utilisateur existe dans auth.users
--     • Aucun profil n'est créé dans public.profiles
--     • link_invitation_for_current_user ne peut pas UPDATE 0 ligne
--     • L'utilisateur ne peut pas se connecter (fetchProfile retourne
--       null → AuthContext appelle signOut() → écran de login).
--
-- Solution :
--   1. Surcharger link_invitation_for_current_user pour accepter un
--      paramètre p_name optionnel et faire un UPSERT (INSERT ... ON
--      CONFLICT DO UPDATE) sur public.profiles.
--   2. SECURITY DEFINER → contourne la policy RLS, ce qui permet de
--      créer le profil même quand le INSERT côté client a échoué.
--   3. La nouvelle signature reste rétro-compatible : l'ancien appel
--      sans argument continue de fonctionner (le nom est lu depuis
--      auth.users.raw_user_meta_data ou prend l'email comme fallback).
--
-- Idempotent : oui (CREATE OR REPLACE + DROP IF EXISTS de l'ancienne
-- signature 0-arg pour éviter PostgREST ambiguë).
-- ============================================================

-- Drop the old 0-arg version so PostgREST resolves the new signature
-- without ambiguity (sinon les anciens clients déployés continuent
-- d'appeler la version 0-arg, ce qui est OK car la nouvelle a un
-- paramètre par défaut).
DROP FUNCTION IF EXISTS public.link_invitation_for_current_user();

CREATE OR REPLACE FUNCTION public.link_invitation_for_current_user(
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id    uuid;
  v_user_email text;
  v_inv        record;
  v_name       text;
  v_role_label text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'not_authenticated');
  END IF;

  -- Get the current user's email from auth.users (bypasses RLS on profiles)
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = v_user_id;

  IF v_user_email IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'user_not_found');
  END IF;

  -- Find the most recent pending, non-expired invitation for this email
  SELECT *
  INTO v_inv
  FROM public.invitations
  WHERE email = lower(v_user_email)
    AND status = 'pending'
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_inv IS NULL THEN
    RETURN jsonb_build_object('linked', false, 'reason', 'no_pending_invitation');
  END IF;

  -- Resolve the user's display name: prefer the parameter, else fallback
  -- to an existing profile name, then auth metadata, then the email.
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
                    WHEN 'super_admin'   THEN 'Super Administrateur'
                    WHEN 'admin'         THEN 'Administrateur'
                    WHEN 'conducteur'    THEN 'Conducteur de travaux'
                    WHEN 'chef_equipe'   THEN 'Chef d''équipe'
                    WHEN 'observateur'   THEN 'Observateur'
                    WHEN 'sous_traitant' THEN 'Sous-traitant'
                    ELSE v_inv.role
                  END;

  -- UPSERT the profile so the user can connect even if the client-side
  -- INSERT after signUp() was blocked by RLS (no session yet) or never ran.
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
    name            = COALESCE(NULLIF(EXCLUDED.name, ''), public.profiles.name),
    email           = COALESCE(public.profiles.email, EXCLUDED.email),
    role            = EXCLUDED.role,
    role_label      = EXCLUDED.role_label,
    organization_id = EXCLUDED.organization_id,
    company_id      = COALESCE(EXCLUDED.company_id, public.profiles.company_id);

  -- Mark the invitation as accepted
  UPDATE public.invitations
  SET status = 'accepted'
  WHERE id = v_inv.id;

  -- Add the user to the general channel of the org (best-effort)
  BEGIN
    UPDATE public.channels
    SET members = members || jsonb_build_array(v_name)
    WHERE organization_id = v_inv.organization_id
      AND type = 'general'
      AND NOT (members @> jsonb_build_array(v_name));
  EXCEPTION WHEN OTHERS THEN
    NULL; -- best-effort
  END;

  RETURN jsonb_build_object(
    'linked', true,
    'organization_id', v_inv.organization_id,
    'role', v_inv.role,
    'profile_created', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_invitation_for_current_user(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
