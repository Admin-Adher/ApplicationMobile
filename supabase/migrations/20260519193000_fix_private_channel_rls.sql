-- Keep channel RLS aligned with the mobile messaging UX.
-- Users can read private group/DM channels they belong to, while only the
-- creator or an organization admin can rename, update members, or delete them.

DROP POLICY IF EXISTS "Channels lisibles par membres ou org" ON public.channels;
DROP POLICY IF EXISTS "Channels visibles par membres habilités" ON public.channels;
DROP POLICY IF EXISTS "Channels visibles par membres habilites v2" ON public.channels;
CREATE POLICY "Channels visibles par membres habilites v2"
  ON public.channels FOR SELECT
  USING (
    auth_user_role() = 'super_admin'
    OR (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR (
      type IN ('group', 'dm')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )
  );

DROP POLICY IF EXISTS "Channels creables par membres" ON public.channels;
DROP POLICY IF EXISTS "Channels créables par membres" ON public.channels;
DROP POLICY IF EXISTS "Channels creables par membres habilites v2" ON public.channels;
CREATE POLICY "Channels creables par membres habilites v2"
  ON public.channels FOR INSERT
  WITH CHECK (
    auth_user_role() = 'super_admin'
    OR (
      type IN ('general', 'building', 'company')
      AND organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR (
      type = 'custom'
      AND organization_id = auth_user_org()
      AND created_by = auth_user_name()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
    )
    OR (
      type IN ('group', 'dm')
      AND organization_id = auth_user_org()
      AND created_by = auth_user_name()
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )
  );

DROP POLICY IF EXISTS "Channels modifiables par admin" ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables" ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilites v2" ON public.channels;
CREATE POLICY "Channels modifiables par membres habilites v2"
  ON public.channels FOR UPDATE
  USING (
    auth_user_role() = 'super_admin'
    OR (
      organization_id = auth_user_org()
      AND (
        auth_user_role() IN ('admin', 'super_admin')
        OR (
          type IN ('custom', 'group', 'dm')
          AND created_by = auth_user_name()
        )
      )
    )
  )
  WITH CHECK (
    auth_user_role() = 'super_admin'
    OR (
      organization_id = auth_user_org()
      AND (
        auth_user_role() IN ('admin', 'super_admin')
        OR (
          type IN ('custom', 'group', 'dm')
          AND created_by = auth_user_name()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Channels supprimables par admin" ON public.channels;
DROP POLICY IF EXISTS "Channels supprimables par membres habilites v2" ON public.channels;
CREATE POLICY "Channels supprimables par membres habilites v2"
  ON public.channels FOR DELETE
  USING (
    auth_user_role() = 'super_admin'
    OR (
      organization_id = auth_user_org()
      AND (
        auth_user_role() IN ('admin', 'super_admin')
        OR (
          type IN ('custom', 'group', 'dm')
          AND created_by = auth_user_name()
        )
      )
    )
  );
