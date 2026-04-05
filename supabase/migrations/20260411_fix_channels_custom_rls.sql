-- ============================================================
-- Migration : Correction RLS canaux custom — race condition org_id
-- Date      : 2026-04-11
--
-- Problème :
--   La migration 20260408_complete_rls_security_fix.sql a écrasé
--   la policy d'écriture des channels avec une version qui ne couvre
--   pas les canaux de type 'custom' créés avant le chargement de
--   l'organization_id (race condition au login).
--
--   Policy incorrecte (20260408) :
--     type IN ('general','building','company','custom')
--       AND organization_id = auth_user_org()          ← bloque si org_id est NULL
--     OR type IN ('group','dm')
--       AND created_by = auth_user_name()              ← 'custom' manquant ici
--
-- Solution :
--   Ajouter une branche dédiée aux canaux 'custom' créés par
--   l'utilisateur, indépendamment de l'organization_id.
--   Cela couvre la race condition où le profil n'est pas encore
--   chargé au moment de la création du canal.
--
-- Idempotent : oui (DROP IF EXISTS avant chaque CREATE).
-- ============================================================

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- ── Lecture ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Channels lisibles par tous"              ON public.channels;
DROP POLICY IF EXISTS "Channels visibles par membres habilités" ON public.channels;
CREATE POLICY "Channels visibles par membres habilités"
  ON public.channels FOR SELECT
  USING (
    -- Canaux d'organisation (general / building / company / custom avec org)
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    -- Canal custom créé par l'utilisateur (org_id peut être NULL : race condition login)
    (
      type = 'custom'
      AND created_by = auth_user_name()
    )
    OR
    -- Canaux privés (groupe, DM) : nom de l'utilisateur dans members
    (
      type IN ('group', 'dm')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )
    -- Super-admin voit tout
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ── Écriture (INSERT / UPDATE / DELETE) ──────────────────────────────────────
DROP POLICY IF EXISTS "Channels modifiables"                       ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;
CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL
  USING (
    -- Canaux d'organisation avec org_id connu
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    -- Canal custom créé par l'utilisateur, même si org_id est NULL (race condition)
    (
      type = 'custom'
      AND created_by = auth_user_name()
    )
    OR
    -- Canaux groupe/DM : créateur ou membre
    (
      type IN ('group', 'dm')
      AND (
        created_by = auth_user_name()
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(members) AS m
          WHERE m = auth_user_name()
        )
      )
    )
    -- Super-admin peut tout gérer
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
