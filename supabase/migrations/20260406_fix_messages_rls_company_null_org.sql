-- ============================================================
-- Migration : Correction RLS messages — canaux company virtuels
--             Suppression de la branche `co.organization_id IS NULL`
-- Date      : 2026-04-06
--
-- Problème de sécurité :
--   Dans la policy SELECT et INSERT sur `messages` (migration
--   20260411_fix_messages_rls_company_channels.sql), la branche
--   couvrant les canaux company virtuels (channel_id LIKE 'company-%')
--   contenait :
--
--     AND (
--       co.organization_id = auth_user_org()
--       OR co.organization_id IS NULL          ← trop permissif
--     )
--
--   La clause `OR co.organization_id IS NULL` permettait à n'importe
--   quel utilisateur authentifié d'accéder aux messages des canaux
--   d'entreprises sans organisation assignée, quelle que soit leur org.
--   Un attaquant connaissant l'UUID d'une entreprise sans org pouvait
--   ainsi lire et écrire dans son canal de messagerie.
--
-- Solution :
--   Remplacer la condition par un test strict :
--     co.organization_id = auth_user_org()
--   (sans la branche IS NULL).
--
--   Si des entreprises ont organization_id = NULL dans votre base,
--   exécutez la requête de backfill suivante AVANT d'appliquer cette
--   migration, en remplaçant <YOUR_ORG_ID> par l'UUID de l'organisation :
--
--     UPDATE public.companies
--     SET organization_id = '<YOUR_ORG_ID>'
--     WHERE organization_id IS NULL;
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

-- ============================================================
-- Nettoyer les policies existantes
-- ============================================================
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
    --    Fix: on exige que l'entreprise appartienne STRICTEMENT à la même
    --    organisation que l'utilisateur (suppression du OR IS NULL permissif).
    (
      messages.channel_id LIKE 'company-%'
      AND auth_user_org() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.companies co
        WHERE co.id = SUBSTRING(messages.channel_id FROM 9)
          AND co.organization_id = auth_user_org()
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
      -- Fix: suppression de OR co.organization_id IS NULL
      (
        messages.channel_id LIKE 'company-%'
        AND auth_user_org() IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.companies co
          WHERE co.id = SUBSTRING(messages.channel_id FROM 9)
            AND co.organization_id = auth_user_org()
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
