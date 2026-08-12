-- Pin auth.uid() as an initPlan in the high-volume message/channel policies.
-- The authorization result remains identical while avoiding one JWT lookup
-- per row, as recommended by the Supabase RLS advisor.

alter policy channels_insert_uuid on public.channels
with check (
  public.auth_is_platform_admin()
  or (
    organization_id = public.auth_user_org()
    and public.auth_has_active_membership(organization_id)
    and created_by_user_id = (select auth.uid())
    and (
      type in ('group', 'dm')
      or (
        type in ('general', 'building', 'company', 'custom')
        and public.auth_user_role() in ('admin', 'conducteur', 'chef_equipe')
      )
    )
  )
);

alter policy channels_uuid_insert_restrictive on public.channels
with check (
  public.auth_is_platform_admin()
  or (
    organization_id = public.auth_user_org()
    and public.auth_has_active_membership(organization_id)
    and (
      type not in ('group', 'dm')
      or created_by_user_id = (select auth.uid())
    )
  )
);

alter policy messages_insert_uuid on public.messages
with check (
  sender_id = (select auth.uid())
  and public.auth_can_access_channel(organization_id, channel_id)
);

alter policy messages_update_uuid on public.messages
using (
  public.auth_can_access_channel(organization_id, channel_id)
  and (
    sender_id = (select auth.uid())
    or public.auth_user_role() = 'admin'
    or public.auth_is_platform_admin()
  )
)
with check (
  public.auth_can_access_channel(organization_id, channel_id)
  and (
    sender_id = (select auth.uid())
    or public.auth_user_role() = 'admin'
    or public.auth_is_platform_admin()
  )
);

alter policy messages_delete_uuid on public.messages
using (
  public.auth_can_access_channel(organization_id, channel_id)
  and (
    sender_id = (select auth.uid())
    or public.auth_user_role() = 'admin'
    or public.auth_is_platform_admin()
  )
);

alter policy messages_uuid_insert_restrictive on public.messages
with check (
  sender_id = (select auth.uid())
  and public.auth_can_access_channel(organization_id, channel_id)
);

alter policy messages_uuid_update_restrictive on public.messages
using (
  public.auth_can_access_channel(organization_id, channel_id)
  and (
    sender_id = (select auth.uid())
    or public.auth_user_role() = 'admin'
    or public.auth_is_platform_admin()
  )
)
with check (
  public.auth_can_access_channel(organization_id, channel_id)
  and (
    sender_id = (select auth.uid())
    or public.auth_user_role() = 'admin'
    or public.auth_is_platform_admin()
  )
);

alter policy messages_uuid_delete_restrictive on public.messages
using (
  public.auth_can_access_channel(organization_id, channel_id)
  and (
    sender_id = (select auth.uid())
    or public.auth_user_role() = 'admin'
    or public.auth_is_platform_admin()
  )
);
