-- Private conversations are member-scoped even for tenant administrators.
-- Platform administrators keep their explicit control-plane override.

create or replace function public.auth_can_manage_channel(
  p_organization_id uuid,
  p_channel_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.auth_is_platform_admin()
    or exists (
      select 1
      from public.channels c
      where c.organization_id = p_organization_id
        and c.id = p_channel_id
        and public.auth_has_active_membership(c.organization_id)
        and (
          (
            c.type in ('group', 'dm')
            and c.created_by_user_id = auth.uid()
          )
          or (
            c.type not in ('group', 'dm')
            and (
              public.auth_user_role() = 'admin'
              or c.created_by_user_id = auth.uid()
              or (
                c.type in ('general', 'building', 'company')
                and public.auth_user_role() in ('conducteur', 'chef_equipe')
              )
            )
          )
        )
    )
$$;

revoke all on function public.auth_can_manage_channel(uuid, text) from public, anon;
grant execute on function public.auth_can_manage_channel(uuid, text) to authenticated, service_role;

alter policy channel_members_channel_select_uuid
  on public.channel_members
  using (public.auth_can_access_channel(organization_id, channel_id));
