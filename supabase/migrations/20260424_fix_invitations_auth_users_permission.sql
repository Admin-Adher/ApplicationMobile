-- ============================================================
-- FIX : permission denied for table users (création d'invitation)
-- Date : 2026-04-24
--
-- Problème :
--   Les policies RLS sur public.invitations contiennent la sous-requête
--     (SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1)
--   Le rôle `authenticated` n'a pas SELECT sur auth.users.email, donc
--   toute opération sur invitations qui déclenche RETURNING (.select()
--   après .insert()) échoue avec :
--     "permission denied for table users".
--
-- Solution :
--   Créer une fonction SECURITY DEFINER public.auth_user_email() qui
--   contourne RLS et permission de la table auth.users (le propriétaire
--   postgres a tous les droits), et remplacer toutes les sous-requêtes
--   directes par cet appel — même pattern que auth_user_org(),
--   auth_user_role(), auth_user_name().
--
-- Idempotent : oui (CREATE OR REPLACE + DROP IF EXISTS).
-- ============================================================

-- ── Fonction SECURITY DEFINER ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auth_user_email()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT email FROM auth.users WHERE id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.auth_user_email() TO authenticated;

-- ── Policies invitations recréées sans accès direct à auth.users ─────

-- SELECT : invité (par email) OU admin/super_admin de l'org
DROP POLICY IF EXISTS "Invitations visibles par admin ou propriétaire" ON public.invitations;
DROP POLICY IF EXISTS "Utilisateur peut voir ses propres invitations" ON public.invitations;
CREATE POLICY "Invitations visibles par admin ou propriétaire"
  ON public.invitations FOR SELECT
  USING (
    lower(email) = lower(auth_user_email())
    OR (auth_user_org() = public.invitations.organization_id
        AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

-- UPDATE : invité (par email) OU admin/super_admin de l'org
DROP POLICY IF EXISTS "Invitations modifiables par admin ou invité" ON public.invitations;
DROP POLICY IF EXISTS "Invité peut accepter sa propre invitation" ON public.invitations;
CREATE POLICY "Invitations modifiables par admin ou invité"
  ON public.invitations FOR UPDATE
  USING (
    lower(email) = lower(auth_user_email())
    OR (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

NOTIFY pgrst, 'reload schema';
