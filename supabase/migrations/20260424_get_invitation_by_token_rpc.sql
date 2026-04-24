-- ============================================================
-- Migration : RPC public get_invitation_by_token(token)
-- Date : 2026-04-24
--
-- But :
--   Permettre à la page d'accueil d'invitation (deep link) de
--   récupérer l'email + le nom de l'organisation à partir du token
--   d'invitation, AVANT que l'utilisateur soit authentifié, afin
--   de pré-remplir le formulaire d'inscription.
--
-- Sécurité :
--   SECURITY DEFINER → lit public.invitations en bypassant les RLS.
--   Ne retourne que email, organization_name, invited_by_name, role
--   (aucune donnée sensible). Le token agit comme un secret partagé,
--   donc seul le destinataire de l'email peut faire l'appel.
--   Accessible à anon et authenticated.
--
-- Idempotent : oui (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS TABLE (
  email text,
  role text,
  organization_name text,
  invited_by_name text,
  expires_at timestamptz,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.email,
    i.role,
    COALESCE(o.name, '') AS organization_name,
    COALESCE(p.full_name, '') AS invited_by_name,
    i.expires_at,
    i.status
  FROM public.invitations i
  LEFT JOIN public.organizations o ON o.id = i.organization_id
  LEFT JOIN public.profiles p ON p.id = i.invited_by
  WHERE i.token = p_token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
