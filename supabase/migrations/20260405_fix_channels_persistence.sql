-- ============================================================
-- Migration : Persistance des canaux custom et group
-- Date      : 2026-04-05
--
-- Problème :
--   La politique ALL sur "channels" permettait l'INSERT d'un
--   canal "custom" UNIQUEMENT si organization_id correspondait
--   à l'org de l'utilisateur.
--   Or, lors de la création d'un canal, l'organization_id peut
--   être NULL côté client (race condition : le profil n'est pas
--   encore chargé), ce qui fait silencieusement échouer l'INSERT.
--   Le canal reste en cache local mais n'est jamais persisté en
--   base → disparaît au prochain chargement d'un appareil vierge.
--
-- Correction :
--   Ajouter la condition "created_by = auth_user_name()" pour
--   les canaux "custom" dans la branche USING/WITH CHECK,
--   en plus du check par organization_id.
--   Ainsi un canal custom créé par l'utilisateur est toujours
--   autorisé à être inséré/mis à jour, même avec org_id NULL.
--
-- Idempotent : oui.
-- ============================================================

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- ── Lecture ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Channels lisibles par tous"              ON public.channels;
DROP POLICY IF EXISTS "Channels visibles par membres habilités" ON public.channels;
CREATE POLICY "Channels visibles par membres habilités"
  ON public.channels FOR SELECT
  USING (
    -- Canaux d'organisation : même org que l'utilisateur
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    -- Canal custom créé par l'utilisateur (même si org_id est NULL
    -- au moment de la création)
    (
      type = 'custom'
      AND created_by = auth_user_name()
    )
    OR
    -- Canaux privés (groupe, DM) : nom de l'utilisateur dans members
    (
      type IN ('group', 'dm')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )
    -- Super-admin voit tout
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ── Écriture (INSERT / UPDATE / DELETE) ─────────────────────
DROP POLICY IF EXISTS "Channels modifiables"                       ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;
CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL
  USING (
    -- Canaux d'organisation : même org
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    -- Canal custom : le créateur peut toujours le gérer
    -- (couvre la race condition où org_id est NULL à la création)
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
          SELECT 1
          FROM jsonb_array_elements_text(members) AS m
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
