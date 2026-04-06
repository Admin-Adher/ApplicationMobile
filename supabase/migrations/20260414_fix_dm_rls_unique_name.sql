-- ============================================================
-- Migration : Fix 3 — Pattern DM sans métacaractères LIKE
--           + Fix 4 — Contrainte UNIQUE sur profiles.name
-- Date      : 2026-04-14
--
-- FIX 3 — LIKE et métacaractères SQL
--   Les branches 7 (DM locaux) des policies messages utilisaient
--   LIKE avec la concaténation directe du nom utilisateur.
--   Si un nom contient '%' ou '_' (métacaractères LIKE), le filtre
--   est incorrectement élargi ou réduit.
--
--   Solution : remplacer les LIKE par une décomposition sûre avec
--   string_to_array. Le format DM est 'dm-<NomA>__<NomB>'.
--   On vérifie que auth_user_name() est présent dans le tableau
--   [NomA, NomB] extrait du channel_id.
--
-- FIX 4 — Unicité des noms de profil
--   auth_user_name() (SECURITY DEFINER) retourne profiles.name.
--   Deux utilisateurs avec le même nom verraient les mêmes DMs
--   et seraient confondus dans les listes members JSONB.
--
--   Solution : ajouter une contrainte UNIQUE sur profiles.name.
--   Les doublons existants sont renommés (suffixe _2, _3…) avant
--   l'ajout de la contrainte pour ne pas bloquer la migration.
--
-- Idempotent : oui (DROP IF EXISTS, CREATE IF NOT EXISTS, etc.)
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- FIX 4 : Dédoublonnage des profils puis contrainte UNIQUE
-- ──────────────────────────────────────────────────────────────

DO $$
DECLARE
  dup_name  TEXT;
  dup_id    UUID;
  suffix    INT;
BEGIN
  -- Pour chaque nom en doublon, on garde le profil le plus ancien
  -- et on renomme les suivants avec un suffixe numérique.
  FOR dup_name IN (
    SELECT name
    FROM public.profiles
    GROUP BY name
    HAVING COUNT(*) > 1
  ) LOOP
    suffix := 2;
    FOR dup_id IN (
      SELECT id
      FROM public.profiles
      WHERE name = dup_name
      ORDER BY created_at ASC NULLS LAST
      OFFSET 1  -- sauter le premier (le plus ancien, conservé tel quel)
    ) LOOP
      -- Trouver un suffixe non encore utilisé
      WHILE EXISTS (
        SELECT 1 FROM public.profiles
        WHERE name = dup_name || '_' || suffix
      ) LOOP
        suffix := suffix + 1;
      END LOOP;

      UPDATE public.profiles
         SET name = dup_name || '_' || suffix
       WHERE id = dup_id;

      suffix := suffix + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- Ajouter la contrainte UNIQUE (maintenant qu'il n'y a plus de doublons)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_name_unique_idx
  ON public.profiles (name);

-- ──────────────────────────────────────────────────────────────
-- FIX 3 : Recréer les policies messages avec pattern DM sûr
-- ──────────────────────────────────────────────────────────────

-- S'assurer que les fonctions helper existent
CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- Supprimer les anciennes policies
DROP POLICY IF EXISTS "Messages visibles par membres habilités"    ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables par expéditeur"        ON public.messages;

-- ── SELECT ───────────────────────────────────────────────────
CREATE POLICY "Messages visibles par membres habilités"
  ON public.messages FOR SELECT
  USING (
    -- 1. L'expéditeur voit toujours ses propres messages
    sender = auth_user_name()

    OR

    -- 2. Canaux généraux / bâtiment persistés → même organisation
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type IN ('general', 'building', 'company')
        AND c.organization_id = auth_user_org()
    )

    OR

    -- 3. Canaux custom : l'utilisateur est dans members JSONB
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'custom'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 4. Canaux groupe : l'utilisateur est dans members JSONB
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'group'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 5. Canaux entreprise virtuels (ID = 'company-{companies.id}')
    (
      messages.channel_id LIKE 'company-%'
      AND auth_user_org() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.companies co
        WHERE co.id = SUBSTRING(messages.channel_id FROM 9)
          AND (
            co.organization_id = auth_user_org()
            OR co.organization_id IS NULL
          )
      )
    )

    OR

    -- 6. Canaux DM persistés dans channels (type = 'dm')
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'dm'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 7. Canaux DM locaux (non persistés dans channels)
    --    Format : dm-<NomA>__<NomB>  (noms triés alphabétiquement)
    --    Utilise string_to_array pour éviter les métacaractères LIKE.
    (
      messages.channel_id LIKE 'dm-%'
      AND NOT EXISTS (
        SELECT 1 FROM public.channels WHERE id = messages.channel_id
      )
      AND auth_user_name() = ANY(
        string_to_array(SUBSTRING(messages.channel_id FROM 4), '__')
      )
    )
  );

-- ── INSERT ───────────────────────────────────────────────────
CREATE POLICY "Messages insertables par membres habilités"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender = auth_user_name()
    AND (
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type IN ('general', 'building', 'company')
          AND c.organization_id = auth_user_org()
      )

      OR

      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'custom'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )

      OR

      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'group'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )

      OR

      (
        messages.channel_id LIKE 'company-%'
        AND auth_user_org() IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.companies co
          WHERE co.id = SUBSTRING(messages.channel_id FROM 9)
            AND (
              co.organization_id = auth_user_org()
              OR co.organization_id IS NULL
            )
        )
      )

      OR

      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'dm'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )

      OR

      -- Canal DM local : vérification sûre sans LIKE sur le nom
      (
        messages.channel_id LIKE 'dm-%'
        AND auth_user_name() = ANY(
          string_to_array(SUBSTRING(messages.channel_id FROM 4), '__')
        )
      )
    )
  );

-- ── UPDATE / DELETE ───────────────────────────────────────────
CREATE POLICY "Messages modifiables par expéditeur"
  ON public.messages FOR ALL
  USING (sender = auth_user_name());

-- Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
