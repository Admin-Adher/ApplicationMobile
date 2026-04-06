-- ============================================================
-- Migration : Correction récursion infinie sur profiles RLS
--             + correction de toutes les politiques dépendantes
-- Date      : 2026-04-06
--
-- Problèmes corrigés :
--
--  1. La migration 20260417 a introduit une politique SELECT récursive
--     sur profiles (sous-requête sur profiles dans la politique profiles).
--     → PostgreSQL renvoie "infinite recursion detected in policy for
--       relation profiles" → fetchProfile() renvoie null → "Profil
--       introuvable" à la connexion.
--
--  2. Les politiques de toutes les autres tables (companies, chantiers,
--     reserves, tasks, documents, photos, organizations, subscriptions…)
--     contiennent un EXISTS (...profiles... role = 'super_admin') qui
--     déclenche à son tour la récursion RLS de profiles.
--     → Le super_admin ne peut pas lire les entreprises ni les chantiers.
--     → Le chargement de l'écran Administration ne se termine jamais.
--
-- Solution :
--   a. Créer auth_user_role() SECURITY DEFINER : retourne le rôle de
--      l'utilisateur courant sans appel récursif.
--   b. Créer get_profile_for_current_user() SECURITY DEFINER : RPC de
--      secours pour fetchProfile() côté client.
--   c. Remplacer toutes les occurrences de :
--        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid()
--                AND role = 'super_admin')
--      par :
--        auth_user_role() = 'super_admin'
--   d. Remplacer les sous-requêtes inline sur profiles par auth_user_org()
--      et auth_user_role() dans les politiques des autres tables.
--
-- Idempotent : oui (DROP IF EXISTS / CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 0. FONCTIONS D'AIDE SECURITY DEFINER (idempotentes)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- Retourne le rôle de l'utilisateur courant sans récursion RLS.
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION auth_user_role() TO authenticated;

-- RPC de secours : fetchProfile() côté client l'appelle si la requête
-- directe échoue (RLS cassé). SECURITY DEFINER contourne les politiques.
CREATE OR REPLACE FUNCTION get_profile_for_current_user()
RETURNS SETOF public.profiles LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION get_profile_for_current_user() TO authenticated;

-- ══════════════════════════════════════════════════════════════
-- 1. TABLE PROFILES — corriger la politique SELECT récursive
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Profiles visibles par tous les utilisateurs connectés" ON public.profiles;
CREATE POLICY "Profiles visibles par tous les utilisateurs connectés"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id                                    -- propre profil
    OR (organization_id IS NOT NULL
        AND organization_id = auth_user_org())         -- même organisation
    OR auth_user_role() = 'super_admin'                -- super_admin voit tout
  );

DROP POLICY IF EXISTS "Profil modifiable par son propriétaire" ON public.profiles;
DROP POLICY IF EXISTS "Profil modifiable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil modifiable par admin de la même organisation"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
  );

DROP POLICY IF EXISTS "Profil supprimable par admin de la même organisation" ON public.profiles;
CREATE POLICY "Profil supprimable par admin de la même organisation"
  ON public.profiles FOR DELETE
  USING (
    auth.uid() = id
    OR (auth_user_org() = organization_id AND auth_user_role() IN ('admin', 'super_admin'))
  );

-- Colonnes ajoutées par les migrations intermédiaires (idempotent)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_id            text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS permissions_override  jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pinned_channels        jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_read_by_channel   jsonb NOT NULL DEFAULT '{}';

-- ══════════════════════════════════════════════════════════════
-- 2. TABLE ORGANIZATIONS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Organizations lisibles par leurs membres" ON public.organizations;
CREATE POLICY "Organizations lisibles par leurs membres"
  ON public.organizations FOR SELECT
  USING (
    auth_user_org() = public.organizations.id
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Organizations modifiables par super_admin" ON public.organizations;
CREATE POLICY "Organizations modifiables par super_admin"
  ON public.organizations FOR ALL
  USING (auth_user_role() = 'super_admin');

-- ══════════════════════════════════════════════════════════════
-- 3. TABLE SUBSCRIPTIONS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Subscriptions visibles par membres et super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions visibles par membres et super_admin"
  ON public.subscriptions FOR SELECT
  USING (
    auth_user_org() = public.subscriptions.organization_id
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Subscriptions modifiables par super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions modifiables par super_admin"
  ON public.subscriptions FOR ALL
  USING (auth_user_role() = 'super_admin');

-- ══════════════════════════════════════════════════════════════
-- 4. TABLE PLANS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Plans lisibles par tous les authentifiés" ON public.plans;
CREATE POLICY "Plans lisibles par tous les authentifiés"
  ON public.plans FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Plans modifiables par super_admin" ON public.plans;
CREATE POLICY "Plans modifiables par super_admin"
  ON public.plans FOR ALL USING (auth_user_role() = 'super_admin');

-- ══════════════════════════════════════════════════════════════
-- 5. TABLE COMPANIES
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Companies lisibles par tous" ON public.companies;
DROP POLICY IF EXISTS "Companies visibles par organisation" ON public.companies;
CREATE POLICY "Companies visibles par organisation"
  ON public.companies FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Companies modifiables par admin/conducteur" ON public.companies;
DROP POLICY IF EXISTS "Companies modifiables par admin/conducteur de la même org" ON public.companies;
CREATE POLICY "Companies modifiables par admin/conducteur de la même org"
  ON public.companies FOR ALL
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

-- ══════════════════════════════════════════════════════════════
-- 6. TABLE CHANTIERS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Chantiers lisibles par tous les authentifiés" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers visibles par organisation" ON public.chantiers;
CREATE POLICY "Chantiers visibles par organisation"
  ON public.chantiers FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur de la même org" ON public.chantiers;
CREATE POLICY "Chantiers modifiables par admin/conducteur de la même org"
  ON public.chantiers FOR ALL
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('admin', 'conducteur'))
    OR auth_user_role() = 'super_admin'
  );

-- ══════════════════════════════════════════════════════════════
-- 7. TABLE DOCUMENTS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Documents lisibles par tous" ON public.documents;
DROP POLICY IF EXISTS "Documents visibles par organisation" ON public.documents;
CREATE POLICY "Documents visibles par organisation"
  ON public.documents FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Documents modifiables" ON public.documents;
DROP POLICY IF EXISTS "Documents modifiables par org" ON public.documents;
CREATE POLICY "Documents modifiables par org"
  ON public.documents FOR ALL
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- ══════════════════════════════════════════════════════════════
-- 8. TABLE RESERVES
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Reserves lisibles par tous" ON public.reserves;
DROP POLICY IF EXISTS "Reserves visibles par organisation" ON public.reserves;
CREATE POLICY "Reserves visibles par organisation"
  ON public.reserves FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org()
    )
    OR (reserves.chantier_id IS NULL AND auth_user_org() IS NOT NULL)
    OR auth_user_role() = 'super_admin'
    OR (
      auth_user_role() = 'sous_traitant'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
          AND (
            reserves.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
            OR (reserves.companies IS NOT NULL AND reserves.companies::jsonb ? p.company_id)
          )
      )
    )
  );

DROP POLICY IF EXISTS "Reserves modifiables (create/edit)" ON public.reserves;
DROP POLICY IF EXISTS "Reserves modifiables par org" ON public.reserves;
CREATE POLICY "Reserves modifiables par org"
  ON public.reserves FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org()
      )
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Reserves: sous_traitant peut requêter la levée" ON public.reserves;
CREATE POLICY "Reserves: sous_traitant peut requêter la levée"
  ON public.reserves FOR UPDATE
  USING (
    auth_user_role() = 'sous_traitant'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      LEFT JOIN public.companies co ON co.id = p.company_id
      WHERE p.id = auth.uid()
        AND p.role = 'sous_traitant'
        AND p.company_id IS NOT NULL
        AND (
          public.reserves.company = co.name
          OR (public.reserves.companies IS NOT NULL
              AND public.reserves.companies::jsonb ? p.company_id)
        )
    )
  );

-- ══════════════════════════════════════════════════════════════
-- 9. TABLE TASKS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Tasks lisibles par tous" ON public.tasks;
DROP POLICY IF EXISTS "Tasks visibles par organisation" ON public.tasks;
CREATE POLICY "Tasks visibles par organisation"
  ON public.tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
    )
    OR (tasks.chantier_id IS NULL AND auth_user_org() IS NOT NULL)
    OR auth_user_role() = 'super_admin'
    OR (
      auth_user_role() = 'sous_traitant'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
          AND tasks.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
      )
    )
  );

DROP POLICY IF EXISTS "Tasks modifiables" ON public.tasks;
DROP POLICY IF EXISTS "Tasks modifiables par org" ON public.tasks;
CREATE POLICY "Tasks modifiables par org"
  ON public.tasks FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
      )
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ══════════════════════════════════════════════════════════════
-- 10. TABLE PHOTOS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Photos lisibles par tous" ON public.photos;
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;
CREATE POLICY "Photos visibles par organisation"
  ON public.photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reserves r
      JOIN public.chantiers c ON c.id = r.chantier_id
      WHERE r.id = photos.reserve_id AND c.organization_id = auth_user_org()
    )
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Photos modifiables" ON public.photos;
DROP POLICY IF EXISTS "Photos modifiables par org" ON public.photos;
CREATE POLICY "Photos modifiables par org"
  ON public.photos FOR ALL
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.reserves r
        JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id AND c.organization_id = auth_user_org()
      )
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL
        AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- ══════════════════════════════════════════════════════════════
-- 11. TABLE INVITATIONS
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Invitations visibles par admins de l''organisation" ON public.invitations;
CREATE POLICY "Invitations visibles par admins de l''organisation"
  ON public.invitations FOR SELECT
  USING (
    (auth_user_org() = public.invitations.organization_id
     AND auth_user_role() IN ('admin', 'super_admin'))
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Invitations créables par admins" ON public.invitations;
CREATE POLICY "Invitations créables par admins"
  ON public.invitations FOR INSERT
  WITH CHECK (
    auth_user_org() = public.invitations.organization_id
    AND auth_user_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Invitations modifiables par admins" ON public.invitations;
CREATE POLICY "Invitations modifiables par admins"
  ON public.invitations FOR UPDATE
  USING (
    auth_user_org() = public.invitations.organization_id
    AND auth_user_role() IN ('admin', 'super_admin')
  );

DROP POLICY IF EXISTS "Invitations supprimables par admins" ON public.invitations;
CREATE POLICY "Invitations supprimables par admins"
  ON public.invitations FOR DELETE
  USING (
    auth_user_org() = public.invitations.organization_id
    AND auth_user_role() IN ('admin', 'super_admin')
  );

-- ══════════════════════════════════════════════════════════════
-- FIN — Recharger le cache PostgREST
-- ══════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';
