-- ============================================================
-- Migration : Ajout organization_id à la table messages
-- Date      : 2026-04-12
--
-- Problème : Le code frontend inclut organization_id dans les
--            INSERT de messages, mais la colonne peut ne pas
--            exister sur la table messages → insert silencieux
--            en échec → messages jamais persistés → pas de
--            livraison realtime aux autres utilisateurs.
--
-- Cette migration est idempotente (IF NOT EXISTS).
-- ============================================================

-- 1. Ajouter la colonne si elle n'existe pas
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 2. Index pour les performances
CREATE INDEX IF NOT EXISTS idx_messages_org ON public.messages(organization_id);

-- 3. Backfill : remplir organization_id depuis le canal associé
--    Pour les canaux persistés (type general/building/company/custom),
--    organization_id vient de la table channels.
--    Pour les DM locaux (dm-XXX__YYY), il n'y a pas de canal persisté
--    → on utilise l'organization_id de l'expéditeur via profiles.
UPDATE public.messages m
SET organization_id = c.organization_id
FROM public.channels c
WHERE m.channel_id = c.id
  AND m.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

-- Pour les messages DM sans canal persisté, backfill via le sender
UPDATE public.messages m
SET organization_id = p.organization_id
FROM public.profiles p
WHERE m.sender = p.name
  AND m.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

-- 4. Mettre à jour la politique SELECT pour inclure organization_id
--    (optimisation : court-circuiter la jointure channels quand
--     organization_id est directement disponible)
DROP POLICY IF EXISTS "Messages visibles par membres habilités" ON public.messages;
CREATE POLICY "Messages visibles par membres habilités"
  ON public.messages FOR SELECT
  USING (
    -- 1. L'expéditeur voit toujours ses propres messages
    sender = auth_user_name()

    OR

    -- 2. Même organisation (organisation_id directement sur le message)
    (
      messages.organization_id = auth_user_org()
      AND EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type IN ('general', 'building', 'company', 'custom')
      )
    )

    OR

    -- 3. Canaux custom : l'utilisateur est listé dans members
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

    OR

    -- 8. Super admin
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- 5. Mettre à jour la politique INSERT
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;
CREATE POLICY "Messages insertables par membres habilités"
  ON public.messages FOR INSERT
  WITH CHECK (
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

-- 6. Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
