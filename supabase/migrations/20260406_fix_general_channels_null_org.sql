-- ============================================================
-- Migration : Correction organisation_id NULL sur canaux généraux
-- Date      : 2026-04-06
--
-- Problème :
--   Les canaux de type 'general' ou 'building' créés sans
--   organization_id (NULL) sont invisibles pour tous les
--   utilisateurs, car la RLS exige :
--     organization_id = auth_user_org()
--   et NULL = <uuid> est toujours FALSE en SQL.
--
-- Solution en deux étapes :
--   1. Mettre à jour organization_id des canaux orphelins en
--      cherchant l'org du créateur, puis des membres.
--   2. Corriger la RLS SELECT pour autoriser les canaux general/
--      building avec org_id NULL à être vus par tous les
--      utilisateurs authentifiés d'une organisation (filet de
--      sécurité si le créateur n'a pas de profil).
--
-- Idempotent : oui.
-- ============================================================

-- ── Étape 1 : Rattacher les canaux orphelins à leur organisation ──────────────

-- Essai 1 : via le créateur du canal
UPDATE public.channels c
SET organization_id = (
  SELECT p.organization_id
  FROM public.profiles p
  WHERE p.name = c.created_by
    AND p.organization_id IS NOT NULL
  LIMIT 1
)
WHERE c.type IN ('general', 'building')
  AND c.organization_id IS NULL
  AND c.created_by IS NOT NULL;

-- Essai 2 : via le premier membre du canal (si créateur introuvable)
UPDATE public.channels c
SET organization_id = (
  SELECT p.organization_id
  FROM public.profiles p
  JOIN jsonb_array_elements_text(c.members) AS m ON m = p.name
  WHERE p.organization_id IS NOT NULL
  LIMIT 1
)
WHERE c.type IN ('general', 'building')
  AND c.organization_id IS NULL
  AND jsonb_array_length(COALESCE(c.members, '[]'::jsonb)) > 0;

-- Essai 3 : s'il n'y a qu'une seule organisation dans la base,
-- rattacher tous les canaux orphelins restants à cette org.
UPDATE public.channels c
SET organization_id = (
  SELECT id FROM public.organizations LIMIT 1
)
WHERE c.type IN ('general', 'building')
  AND c.organization_id IS NULL
  AND (SELECT COUNT(*) FROM public.organizations) = 1;

-- ── Étape 2 : Mettre à jour la RLS pour couvrir le cas NULL résiduel ─────────
-- (filet de sécurité : si des canaux general/building ont encore
--  organization_id NULL après les UPDATE ci-dessus, les rendre
--  visibles à tous les utilisateurs authentifiés appartenant à
--  n'importe quelle organisation.)

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

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

    -- 2. Canaux general/building sans org_id (données legacy) :
    --    visibles à tout utilisateur authentifié ayant un profil
    (
      type IN ('general', 'building')
      AND organization_id IS NULL
      AND auth_user_org() IS NOT NULL
    )

    OR

    -- 3. Canal custom OU group : utilisateur dans la liste members
    --    (couvre org_id NULL = race condition login)
    (
      type IN ('custom', 'group')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )

    OR

    -- 4. Canal custom créé par l'utilisateur — rétro-compatibilité
    (
      type = 'custom'
      AND created_by = auth_user_name()
    )

    OR

    -- 5. Canal DM : utilisateur dans la liste members
    (
      type = 'dm'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )

    OR

    -- 6. Super-admin voit tout
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- La policy d'écriture reste inchangée (org_id requis pour écrire)
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;

CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL
  USING (
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
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
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
