-- ============================================================
-- Migration : Correction RLS messages — canaux entreprise virtuels
--             + accès membres canaux custom sans org_id
-- Date      : 2026-04-11
--
-- Problèmes corrigés :
--
--  1. CANAUX ENTREPRISE VIRTUELS (ID = 'company-{text_id}')
--     Ces canaux sont construits côté client à partir de la table
--     `companies` ; ils n'ont AUCUNE ligne dans `channels`.
--     → INSERT et SELECT bloqués par RLS → messages jamais persistés
--       en Supabase → pas de synchronisation possible entre utilisateurs.
--
--  2. CANAUX CUSTOM AVEC organization_id NULL (race condition)
--     Si un canal custom est créé avant que org_id soit récupéré,
--     il est inséré avec organization_id = null.
--     → Seul le créateur pouvait voir ses propres messages ;
--       les autres membres du canal ne les voyaient pas.
--
--  3. REALTIME
--     Supabase applique le RLS SELECT aux événements postgres_changes.
--     Les deux problèmes ci-dessus empêchaient également la livraison
--     temps-réel des messages aux autres utilisateurs.
--
-- Solution :
--   Recréer les politiques INSERT et SELECT en ajoutant :
--   a) Une branche "company-%"   : vérifie la table `companies`.
--   b) Une branche "membres"     : pour les canaux custom/group,
--      l'utilisateur est dans la liste members (JSONB).
--   Toutes les branches existantes sont conservées.
--
-- Idempotent : oui (DROP IF EXISTS avant chaque CREATE).
-- ============================================================

-- S'assurer que les fonctions helper existent
CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- ============================================================
-- Nettoyer toutes les anciennes policies messages
-- ============================================================
DROP POLICY IF EXISTS "Messages lisibles par tous"                 ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables"                       ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par authentifiés"      ON public.messages;
DROP POLICY IF EXISTS "Messages visibles par membres habilités"    ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables par expéditeur"        ON public.messages;

-- ============================================================
-- SELECT : qui peut lire un message ?
-- ============================================================
CREATE POLICY "Messages visibles par membres habilités"
  ON public.messages FOR SELECT
  USING (
    -- 1. L'expéditeur voit toujours ses propres messages
    sender = auth_user_name()

    OR

    -- 2. Canaux généraux / bâtiment persistés dans la table channels,
    --    accès via organisation
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type IN ('general', 'building', 'company')
        AND c.organization_id = auth_user_org()
    )

    OR

    -- 3. Canaux custom : l'utilisateur est listé dans members
    --    (couvre org_id renseigné ET null, et le créateur)
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'custom'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 4. Canaux groupe : l'utilisateur est listé dans members
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'group'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 5. Canaux entreprise VIRTUELS (ID = 'company-{companies.id}')
    --    Accessible à tous les membres de la même organisation.
    --    companies.id est de type TEXT (non uuid).
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
          SELECT 1
          FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 7. Canaux DM locaux (non persistés dans channels)
    --    Format : dm-<NomA>__<NomB>  (noms triés alphabétiquement)
    (
      messages.channel_id LIKE 'dm-%'
      AND NOT EXISTS (
        SELECT 1 FROM public.channels WHERE id = messages.channel_id
      )
      AND (
        messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
        OR messages.channel_id LIKE 'dm-%__' || auth_user_name()
      )
    )
  );

-- ============================================================
-- INSERT : qui peut envoyer un message ?
-- ============================================================
CREATE POLICY "Messages insertables par membres habilités"
  ON public.messages FOR INSERT
  WITH CHECK (
    -- L'expéditeur déclaré doit être l'utilisateur connecté
    sender = auth_user_name()
    AND (
      -- Canal général / bâtiment / company (persisté)
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type IN ('general', 'building', 'company')
          AND c.organization_id = auth_user_org()
      )

      OR

      -- Canal custom : l'utilisateur est membre
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'custom'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )

      OR

      -- Canal groupe : l'utilisateur est membre
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'group'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )

      OR

      -- Canal entreprise virtuel
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

      -- Canal DM persisté
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'dm'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )

      OR

      -- Canal DM local
      (
        messages.channel_id LIKE 'dm-%'
        AND (
          messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
          OR messages.channel_id LIKE 'dm-%__' || auth_user_name()
        )
      )
    )
  );

-- ============================================================
-- UPDATE / DELETE : uniquement ses propres messages
-- ============================================================
CREATE POLICY "Messages modifiables par expéditeur"
  ON public.messages FOR ALL
  USING (sender = auth_user_name());

-- ============================================================
-- Recharger le cache PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';
