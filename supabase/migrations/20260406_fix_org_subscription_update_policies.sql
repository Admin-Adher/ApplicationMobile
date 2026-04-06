-- ============================================================
-- Migration : Correction des politiques UPDATE pour organizations et subscriptions
-- Date      : 2026-04-06 (correctif)
--
-- Problème :
--   La migration 20260405_organizations_super_admin_rls.sql a créé des politiques
--   avec des noms légèrement différents (français vs anglais) de ceux ciblés
--   par les DROP POLICY des migrations suivantes.
--   Résultat : des politiques récursives (EXISTS sur profiles) survivaient
--   aux migrations de correction, bloquant silencieusement toutes les
--   opérations UPDATE/INSERT sur organizations et subscriptions pour le
--   super_admin.
--
-- Solution :
--   Supprimer TOUTES les variantes de noms connues, puis recréer
--   les politiques correctes avec auth_user_role() (SECURITY DEFINER).
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- TABLE : organizations — purge complète des anciennes politiques
-- ══════════════════════════════════════════════════════════════

-- SELECT
DROP POLICY IF EXISTS "Organisations lisibles par super_admin"            ON public.organizations;
DROP POLICY IF EXISTS "Organisation lisible par ses membres"              ON public.organizations;
DROP POLICY IF EXISTS "Organizations lisibles par leurs membres"          ON public.organizations;
DROP POLICY IF EXISTS "Organizations lisibles par super_admin"            ON public.organizations;

-- INSERT
DROP POLICY IF EXISTS "Organisations créables par super_admin"            ON public.organizations;
DROP POLICY IF EXISTS "Organizations créables par super_admin"            ON public.organizations;

-- UPDATE
DROP POLICY IF EXISTS "Organisations modifiables par super_admin"         ON public.organizations;
DROP POLICY IF EXISTS "Organizations modifiables par super_admin"         ON public.organizations;

-- ALL (catch-all)
DROP POLICY IF EXISTS "Organizations modifiables par super_admin"         ON public.organizations;

-- Recréation propre avec auth_user_role() SECURITY DEFINER (sans récursion)
-- (DROP IF EXISTS au cas où une exécution partielle les aurait déjà créés)

DROP POLICY IF EXISTS "orgs_select"           ON public.organizations;
DROP POLICY IF EXISTS "orgs_all_super_admin"  ON public.organizations;

CREATE POLICY "orgs_select"
  ON public.organizations FOR SELECT
  USING (
    auth_user_org() = public.organizations.id
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "orgs_all_super_admin"
  ON public.organizations FOR ALL
  USING (auth_user_role() = 'super_admin')
  WITH CHECK (auth_user_role() = 'super_admin');

-- ══════════════════════════════════════════════════════════════
-- TABLE : subscriptions — purge complète des anciennes politiques
-- ══════════════════════════════════════════════════════════════

-- SELECT
DROP POLICY IF EXISTS "Subscriptions lisibles par super_admin"            ON public.subscriptions;
DROP POLICY IF EXISTS "Subscription lisible par ses membres"              ON public.subscriptions;
DROP POLICY IF EXISTS "Subscriptions visibles par membres et super_admin" ON public.subscriptions;

-- INSERT
DROP POLICY IF EXISTS "Subscriptions créables par super_admin"            ON public.subscriptions;

-- UPDATE
DROP POLICY IF EXISTS "Subscriptions modifiables par super_admin"         ON public.subscriptions;

-- ALL
DROP POLICY IF EXISTS "Subscriptions modifiables par super_admin"         ON public.subscriptions;

-- Recréation propre
-- (DROP IF EXISTS au cas où une exécution partielle les aurait déjà créés)

DROP POLICY IF EXISTS "subs_select"           ON public.subscriptions;
DROP POLICY IF EXISTS "subs_all_super_admin"  ON public.subscriptions;

CREATE POLICY "subs_select"
  ON public.subscriptions FOR SELECT
  USING (
    auth_user_org() = public.subscriptions.organization_id
    OR auth_user_role() = 'super_admin'
  );

CREATE POLICY "subs_all_super_admin"
  ON public.subscriptions FOR ALL
  USING (auth_user_role() = 'super_admin')
  WITH CHECK (auth_user_role() = 'super_admin');

-- Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
