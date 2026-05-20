-- Ensure enterprise/company messaging stays fast and consistent.
-- Company channels are generated in the mobile app as `company-{companies.id}`.
-- Some later RLS policies only checked public.channels, which made those
-- virtual channels fragile. This migration backfills matching channel rows and
-- restores explicit company-channel branches in message policies.

UPDATE public.messages AS m
SET organization_id = co.organization_id
FROM public.companies AS co
WHERE m.channel_id = 'company-' || co.id
  AND m.organization_id IS DISTINCT FROM co.organization_id;

UPDATE public.messages
SET created_at = now()
WHERE created_at IS NULL;

ALTER TABLE public.messages
  ALTER COLUMN created_at SET DEFAULT now();

INSERT INTO public.channels (
  id, name, description, icon, color, type, members, organization_id
)
SELECT
  'company-' || co.id,
  co.name,
  'Canal entreprise ' || co.name,
  'business',
  co.color,
  'company',
  '[]'::jsonb,
  co.organization_id
FROM public.companies AS co
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  color = EXCLUDED.color,
  type = EXCLUDED.type,
  organization_id = EXCLUDED.organization_id;

CREATE INDEX IF NOT EXISTS idx_messages_org_channel_created_at
  ON public.messages (organization_id, channel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_company_channel_created_at
  ON public.messages (channel_id, created_at DESC)
  WHERE channel_id LIKE 'company-%';

CREATE INDEX IF NOT EXISTS idx_channels_type_org
  ON public.channels (type, organization_id);

DROP POLICY IF EXISTS "Messages lisibles par membres du canal" ON public.messages;
DROP POLICY IF EXISTS "Super admin lit tous les messages" ON public.messages;
DROP POLICY IF EXISTS "Messages visibles par membres habilités" ON public.messages;
DROP POLICY IF EXISTS "Messages visibles par membres habilites" ON public.messages;
DROP POLICY IF EXISTS "messages_select" ON public.messages;
DROP POLICY IF EXISTS "messages_select_company_safe_v1" ON public.messages;

CREATE POLICY "messages_select_company_safe_v1"
  ON public.messages FOR SELECT TO authenticated
  USING (
    auth_user_role() = 'super_admin'
    OR sender = auth_user_name()
    OR (
      channel_id LIKE 'company-%'
      AND auth_user_org() IS NOT NULL
      AND organization_id = auth_user_org()
      AND EXISTS (
        SELECT 1
        FROM public.companies co
        WHERE co.id = substring(messages.channel_id from 9)
          AND co.organization_id = auth_user_org()
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.channels c
      WHERE c.id = messages.channel_id
        AND (
          (
            c.type IN ('general', 'building', 'company', 'custom')
            AND c.organization_id = auth_user_org()
          )
          OR (
            c.type IN ('group', 'dm')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(c.members) AS m
              WHERE m = auth_user_name()
            )
          )
        )
    )
    OR (
      channel_id LIKE 'dm-%'
      AND NOT EXISTS (SELECT 1 FROM public.channels c WHERE c.id = messages.channel_id)
      AND auth_user_name() = ANY(string_to_array(substring(messages.channel_id from 4), '__'))
    )
  );

DROP POLICY IF EXISTS "Messages envoyables par membres" ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilites" ON public.messages;
DROP POLICY IF EXISTS "messages_insert" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_company_safe_v1" ON public.messages;

CREATE POLICY "messages_insert_company_safe_v1"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender = auth_user_name()
    AND (
      auth_user_role() = 'super_admin'
      OR (
        channel_id LIKE 'company-%'
        AND auth_user_org() IS NOT NULL
        AND organization_id = auth_user_org()
        AND EXISTS (
          SELECT 1
          FROM public.companies co
          WHERE co.id = substring(messages.channel_id from 9)
            AND co.organization_id = auth_user_org()
        )
      )
      OR EXISTS (
        SELECT 1
        FROM public.channels c
        WHERE c.id = messages.channel_id
          AND (
            (
              c.type IN ('general', 'building', 'company', 'custom')
              AND c.organization_id = auth_user_org()
            )
            OR (
              c.type IN ('group', 'dm')
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(c.members) AS m
                WHERE m = auth_user_name()
              )
            )
          )
      )
      OR (
        channel_id LIKE 'dm-%'
        AND auth_user_name() = ANY(string_to_array(substring(messages.channel_id from 4), '__'))
      )
    )
  );

DROP POLICY IF EXISTS "Messages modifiables par expéditeur" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables par expediteur" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables" ON public.messages;
DROP POLICY IF EXISTS "messages_update" ON public.messages;
DROP POLICY IF EXISTS "messages_update_sender_or_super_admin_v1" ON public.messages;

CREATE POLICY "messages_update_sender_or_super_admin_v1"
  ON public.messages FOR UPDATE TO authenticated
  USING (
    sender = auth_user_name()
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    sender = auth_user_name()
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Messages supprimables par expéditeur ou admin" ON public.messages;
DROP POLICY IF EXISTS "Messages supprimables par expediteur ou admin" ON public.messages;
DROP POLICY IF EXISTS "messages_delete" ON public.messages;
DROP POLICY IF EXISTS "messages_delete_sender_or_admin_v1" ON public.messages;

CREATE POLICY "messages_delete_sender_or_admin_v1"
  ON public.messages FOR DELETE TO authenticated
  USING (
    sender = auth_user_name()
    OR auth_user_role() IN ('admin', 'super_admin')
  );

NOTIFY pgrst, 'reload schema';
