-- ============================================================
-- Migration : Fix invitation INSERT policy for super_admin
-- Date : 2026-04-08
--
-- Problème : le super_admin ne peut pas créer d'invitation pour
--   une organisation dont il n'est pas membre (auth_user_org()
--   retourne son propre org_id, pas celui de la nouvelle org).
--
-- Fix : autoriser le super_admin à insérer dans n'importe quelle org.
-- ============================================================

-- INSERT
DROP POLICY IF EXISTS "Invitations créables par admins" ON public.invitations;
CREATE POLICY "Invitations créables par admins"
  ON public.invitations FOR INSERT
  WITH CHECK (
    auth_user_role() = 'super_admin'
    OR (
      auth_user_org() = public.invitations.organization_id
      AND auth_user_role() IN ('admin', 'super_admin')
    )
  );

-- UPDATE (même correction pour cohérence)
DROP POLICY IF EXISTS "Invitations modifiables par admins" ON public.invitations;
CREATE POLICY "Invitations modifiables par admins"
  ON public.invitations FOR UPDATE
  USING (
    auth_user_role() = 'super_admin'
    OR (
      auth_user_org() = public.invitations.organization_id
      AND auth_user_role() IN ('admin', 'super_admin')
    )
  );

NOTIFY pgrst, 'reload schema';
