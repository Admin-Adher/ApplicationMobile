-- ============================================================
-- Migration : RPC public check_pending_invitation(email)
-- Date : 2026-04-19
--
-- But :
--   Permettre à l'écran d'inscription de vérifier, AVANT la
--   création du compte, qu'une invitation en attente existe pour
--   l'email saisi — sans nécessiter d'authentification.
--
--   Cela évite la création de comptes "fantômes" (auth créé mais
--   sans organisation) lorsque l'utilisateur n'a pas d'invitation.
--
-- Sécurité :
--   SECURITY DEFINER → lit public.invitations en bypasse des RLS.
--   Retourne uniquement un booléen — aucune donnée sensible exposée.
--   Accessible à anon et authenticated.
--
-- Idempotent : oui (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_pending_invitation(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invitations
    WHERE lower(email) = lower(p_email)
      AND status = 'pending'
      AND expires_at > now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_pending_invitation(text) TO anon;
GRANT EXECUTE ON FUNCTION public.check_pending_invitation(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
