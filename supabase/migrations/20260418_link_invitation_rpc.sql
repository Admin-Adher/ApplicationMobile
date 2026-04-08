-- ============================================================
-- Migration : RPC link_invitation_for_current_user
-- Date : 2026-04-18
--
-- Problème :
--   Lors de l'inscription via invitation, le nouvel utilisateur
--   reçoit temporairement le rôle 'observateur' et organization_id = null.
--   La politique RLS sur invitations (SELECT) exige role IN ('admin',
--   'super_admin'), ce qui empêche le code client de lire l'invitation
--   correspondant à l'email de l'utilisateur → linkPendingInvitation()
--   retourne undefined → l'utilisateur reste sans organisation et
--   tombe sur l'écran "En attente d'invitation".
--
-- Solution :
--   Créer un RPC SECURITY DEFINER qui lit et accepte l'invitation
--   directement dans la base, sans passer par les politiques RLS,
--   puis met à jour le profil de l'utilisateur courant.
--
-- Idempotent : oui (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.link_invitation_for_current_user()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid;
  v_user_email text;
  v_inv       record;
  v_result    jsonb;
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

  -- Update the user's profile with org, role, and optional company
  UPDATE public.profiles
  SET
    organization_id = v_inv.organization_id,
    role            = v_inv.role,
    role_label      = CASE v_inv.role
                        WHEN 'super_admin'   THEN 'Super Administrateur'
                        WHEN 'admin'         THEN 'Administrateur'
                        WHEN 'conducteur'    THEN 'Conducteur de travaux'
                        WHEN 'chef_equipe'   THEN 'Chef d''équipe'
                        WHEN 'observateur'   THEN 'Observateur'
                        WHEN 'sous_traitant' THEN 'Sous-traitant'
                        ELSE v_inv.role
                      END,
    company_id      = COALESCE(v_inv.company_id, company_id)
  WHERE id = v_user_id;

  -- Mark the invitation as accepted
  UPDATE public.invitations
  SET status = 'accepted'
  WHERE id = v_inv.id;

  -- Add user to the general channel of the org (best-effort)
  BEGIN
    UPDATE public.channels
    SET members = members || jsonb_build_array(
      (SELECT name FROM public.profiles WHERE id = v_user_id LIMIT 1)
    )
    WHERE organization_id = v_inv.organization_id
      AND type = 'general'
      AND NOT (members @> jsonb_build_array(
        (SELECT name FROM public.profiles WHERE id = v_user_id LIMIT 1)
      ));
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Ignore errors here, channel update is best-effort
  END;

  RETURN jsonb_build_object(
    'linked', true,
    'organization_id', v_inv.organization_id,
    'role', v_inv.role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_invitation_for_current_user() TO authenticated;

-- Add a permissive SELECT policy so an authenticated user can read
-- invitations sent to their own email address.
-- Uses auth.users (not profiles) to avoid the recursive RLS on profiles.
DROP POLICY IF EXISTS "Utilisateur peut voir ses propres invitations" ON public.invitations;
CREATE POLICY "Utilisateur peut voir ses propres invitations"
  ON public.invitations FOR SELECT
  USING (
    lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1))
    OR (auth_user_org() = public.invitations.organization_id
        AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- Allow an invitee to mark their own invitation as accepted.
DROP POLICY IF EXISTS "Invité peut accepter sa propre invitation" ON public.invitations;
CREATE POLICY "Invité peut accepter sa propre invitation"
  ON public.invitations FOR UPDATE
  USING (
    lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1))
  )
  WITH CHECK (status = 'accepted');

NOTIFY pgrst, 'reload schema';
