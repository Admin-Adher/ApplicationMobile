-- ============================================================
-- Migration : Correction récursion infinie sur profiles RLS
-- Date      : 2026-04-06
--
-- Problème :
--   La migration 20260417_fix_profiles_columns_and_select_policy.sql
--   a remplacé la politique SELECT sur profiles par une version qui
--   contient une sous-requête récursive sur la même table profiles :
--
--     OR (organization_id IS NOT NULL
--         AND organization_id = (
--           SELECT p.organization_id FROM public.profiles p   ← récursion
--           WHERE p.id = auth.uid() LIMIT 1
--         ))
--     OR EXISTS (SELECT 1 FROM public.profiles p             ← récursion
--                WHERE p.id = auth.uid() AND p.role = 'super_admin')
--
--   PostgreSQL détecte la récursion et abandonne la requête avec
--   "infinite recursion detected in policy for relation profiles".
--   Résultat : fetchProfile() renvoie null → "Profil introuvable".
--
-- Solution :
--   1. Créer auth_user_role() SECURITY DEFINER (contourne le RLS
--      pour lire le rôle de l'utilisateur courant).
--   2. Créer get_profile_for_current_user() SECURITY DEFINER (RPC
--      de secours utilisé par l'app si la query directe échoue).
--   3. Remplacer la politique SELECT récursive par une version saine
--      qui n'utilise que des fonctions SECURITY DEFINER.
--
-- Idempotent : oui (DROP IF EXISTS / CREATE OR REPLACE).
-- ============================================================

-- ── 0. Fonctions d'aide (idempotentes) ──────────────────────────────

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- Nouvelle fonction : retourne le rôle de l'utilisateur courant
-- sans récursion RLS (SECURITY DEFINER contourne les politiques).
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION auth_user_role() TO authenticated;

-- ── 1. RPC de secours pour l'app ─────────────────────────────────────
-- Utilisé par fetchProfile() si la requête directe échoue (RLS cassé).
-- SECURITY DEFINER → lit toujours le profil du user connecté, sans RLS.
CREATE OR REPLACE FUNCTION get_profile_for_current_user()
RETURNS SETOF public.profiles
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION get_profile_for_current_user() TO authenticated;

-- ── 2. Remplacer la politique SELECT récursive ────────────────────────
DROP POLICY IF EXISTS "Profiles visibles par tous les utilisateurs connectés" ON public.profiles;

CREATE POLICY "Profiles visibles par tous les utilisateurs connectés"
  ON public.profiles FOR SELECT
  USING (
    -- Chaque utilisateur voit toujours son propre profil (pas de récursion)
    auth.uid() = id
    -- Membres de la même organisation (via fonction SECURITY DEFINER, pas de récursion)
    OR (
      organization_id IS NOT NULL
      AND organization_id = auth_user_org()
    )
    -- Super-admin voit tout (via fonction SECURITY DEFINER, pas de récursion)
    OR auth_user_role() = 'super_admin'
  );

-- ── 3. Politique UPDATE (inchangée, juste réappliquée proprement) ────
DROP POLICY IF EXISTS "Profil modifiable par son propriétaire" ON public.profiles;
DROP POLICY IF EXISTS "Profil modifiable par admin de la même organisation" ON public.profiles;

CREATE POLICY "Profil modifiable par admin de la même organisation"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR (
      auth_user_org() = organization_id
      AND auth_user_role() IN ('admin', 'super_admin')
    )
  );

-- ── 4. Politique DELETE ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Profil supprimable par admin de la même organisation" ON public.profiles;

CREATE POLICY "Profil supprimable par admin de la même organisation"
  ON public.profiles FOR DELETE
  USING (
    auth.uid() = id
    OR (
      auth_user_org() = organization_id
      AND auth_user_role() IN ('admin', 'super_admin')
    )
  );

-- ── 5. S'assurer que les colonnes ajoutées par 20260417 existent ─────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_id           text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS permissions_override jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pinned_channels       jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_read_by_channel  jsonb NOT NULL DEFAULT '{}';

-- Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
