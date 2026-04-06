-- ============================================================
-- Migration : Correction RLS canaux — membres avec org_id NULL
-- Date      : 2026-04-13
--
-- Problème :
--   Quand un canal custom ou group est créé AVANT que org_id soit
--   chargé (race condition au login), organization_id = NULL.
--   La policy existante couvre uniquement le créateur dans ce cas.
--   Les autres membres du canal ne le voient pas jusqu'à ce que
--   org_id soit renseigné (quelques secondes).
--
--   De plus, la branche "custom créé par l'utilisateur" permettait
--   au créateur de TOUJOURS voir le canal même si un autre admin
--   le retirait — incohérence avec l'intention métier.
--
-- Solution :
--   Pour les canaux custom ET group avec org_id NULL, vérifier
--   la présence du nom de l'utilisateur dans la liste `members`
--   (JSONB). Cela couvre les non-créateurs pendant la race condition.
--
--   La branche "custom created_by" est conservée pour la rétro-
--   compatibilité mais n'est plus la seule voie d'accès.
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
DROP POLICY IF EXISTS "Channels visibles par membres habilités" ON public.channels;

CREATE POLICY "Channels visibles par membres habilités"
  ON public.channels FOR SELECT
  USING (
    -- 1. Canaux d'organisation avec org_id connu
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )

    OR

    -- 2. Canal custom OU group : utilisateur dans la liste members
    --    (couvre org_id NULL = race condition login, ET les membres
    --     non-créateurs dans tous les cas)
    (
      type IN ('custom', 'group')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )

    OR

    -- 3. Canal custom créé par l'utilisateur — rétro-compatibilité
    --    (pour les anciens canaux sans members correctement renseignés)
    (
      type = 'custom'
      AND created_by = auth_user_name()
    )

    OR

    -- 4. Canal DM : utilisateur dans la liste members
    (
      type = 'dm'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )

    OR

    -- 5. Super-admin voit tout
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ── Écriture (INSERT / UPDATE / DELETE) ──────────────────────────────────────
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;

CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL
  USING (
    -- 1. Canaux d'organisation avec org_id connu
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )

    OR

    -- 2. Canal custom OU group : créateur ou membre
    (
      type IN ('custom', 'group')
      AND (
        created_by = auth_user_name()
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(members) AS m
          WHERE m = auth_user_name()
        )
      )
    )

    OR

    -- 3. Canal DM : créateur ou membre
    (
      type = 'dm'
      AND (
        created_by = auth_user_name()
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(members) AS m
          WHERE m = auth_user_name()
        )
      )
    )

    OR

    -- 4. Super-admin peut tout gérer
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
