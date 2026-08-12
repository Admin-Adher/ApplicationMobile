-- Private conversation authorization is UUID based from this migration on.
--
-- channels.members and channels.created_by remain as presentation/legacy
-- mirrors so already-installed APKs can keep writing while they are upgraded.
-- They are never consulted by an authorization policy.

alter table public.channels
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;

create index if not exists channels_created_by_user_id_idx
  on public.channels(created_by_user_id)
  where created_by_user_id is not null;

create index if not exists channel_members_active_user_idx
  on public.channel_members(organization_id, user_id, channel_id)
  where status = 'active';

-- Resolve creators only when the display name maps to exactly one active
-- membership in the channel tenant. Ambiguous names deliberately stay null.
with unique_active_names as (
  select
    om.organization_id,
    lower(btrim(p.name)) as normalized_name,
    (array_agg(p.id order by p.id::text))[1] as user_id
  from public.organization_memberships om
  join public.profiles p on p.id = om.user_id
  where om.status = 'active'
  group by om.organization_id, lower(btrim(p.name))
  having count(*) = 1
)
update public.channels c
set created_by_user_id = u.user_id
from unique_active_names u
where c.created_by_user_id is null
  and c.organization_id = u.organization_id
  and lower(btrim(c.created_by)) = u.normalized_name;

-- Conservative membership backfill. We accept three independent pieces of
-- evidence: a unique legacy label, the immutable creator UUID, or a sender UUID
-- that was previously allowed to post in the private channel.
with unique_active_names as (
  select
    om.organization_id,
    lower(btrim(p.name)) as normalized_name,
    (array_agg(p.id order by p.id::text))[1] as user_id
  from public.organization_memberships om
  join public.profiles p on p.id = om.user_id
  where om.status = 'active'
  group by om.organization_id, lower(btrim(p.name))
  having count(*) = 1
), resolved_legacy_members as (
  select distinct c.organization_id, c.id as channel_id, u.user_id
  from public.channels c
  cross join lateral jsonb_array_elements_text(coalesce(c.members, '[]'::jsonb)) member(name)
  join unique_active_names u
    on u.organization_id = c.organization_id
   and u.normalized_name = lower(btrim(member.name))
  where c.type in ('group', 'dm')
), evidenced_members as (
  select organization_id, channel_id, user_id from resolved_legacy_members
  union
  select c.organization_id, c.id, c.created_by_user_id
  from public.channels c
  where c.type in ('group', 'dm') and c.created_by_user_id is not null
  union
  select distinct m.organization_id, m.channel_id, m.sender_id
  from public.messages m
  join public.channels c
    on c.organization_id = m.organization_id
   and c.id = m.channel_id
   and c.type in ('group', 'dm')
  join public.organization_memberships om
    on om.organization_id = m.organization_id
   and om.user_id = m.sender_id
   and om.status = 'active'
  where m.sender_id is not null
)
insert into public.channel_members(
  organization_id, channel_id, user_id, status, joined_at, added_by
)
select organization_id, channel_id, user_id, 'active', now(), null::uuid
from evidenced_members
where organization_id is not null and user_id is not null
on conflict (organization_id, channel_id, user_id) do update
set status = 'active';

-- A policy-safe authorization primitive. It accepts an object identifier but
-- derives the actor exclusively from auth.uid(). The owner executes it with an
-- empty search_path so policies can inspect channel_members without recursive
-- RLS evaluation.
create or replace function public.auth_can_access_channel(
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
          c.type not in ('group', 'dm')
          or exists (
            select 1
            from public.channel_members cm
            where cm.organization_id = c.organization_id
              and cm.channel_id = c.id
              and cm.user_id = auth.uid()
              and cm.status = 'active'
          )
        )
    )
$$;

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

revoke all on function public.auth_can_access_channel(uuid, text) from public, anon;
revoke all on function public.auth_can_manage_channel(uuid, text) from public, anon;
grant execute on function public.auth_can_access_channel(uuid, text) to authenticated, service_role;
grant execute on function public.auth_can_manage_channel(uuid, text) to authenticated, service_role;

-- Compatibility bridge for old APKs. New clients pass a transaction-local
-- UUID array through upsert_private_channel. Old clients still send display
-- names; those are accepted only when every label has one unique active match.
create or replace function private.enforce_channel_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_org uuid;
  v_actor_name text;
  v_creator_name text;
  v_member_ids uuid[] := '{}'::uuid[];
  v_trusted_members text;
  v_label_count integer := 0;
  v_resolved_label_count integer := 0;
  v_preserve_incomplete_legacy boolean := false;
  v_is_self_leave boolean := false;
  v_old_member_ids uuid[] := '{}'::uuid[];
  v_expected_member_ids uuid[] := '{}'::uuid[];
begin
  perform set_config('app.resolved_channel_member_ids', '[]', true);

  if v_actor_id is null then
    return new;
  end if;

  if public.auth_is_platform_admin() then
    v_actor_org := coalesce(
      case when tg_op = 'UPDATE' then old.organization_id else null end,
      new.organization_id,
      public.auth_user_org()
    );
  else
    v_actor_org := public.auth_user_org();
  end if;

  if v_actor_org is null then
    raise exception 'An active organization is required' using errcode = '42501';
  end if;

  select p.name into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;

  if v_actor_name is null then
    raise exception 'Profile not found' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.organization_id := v_actor_org;
    new.created_by_user_id := v_actor_id;
    new.created_by := v_actor_name;
  else
    if old.organization_id is distinct from v_actor_org then
      raise exception 'Channel tenant is immutable' using errcode = '42501';
    end if;
    if new.organization_id is distinct from old.organization_id then
      raise exception 'Channel tenant is immutable' using errcode = '42501';
    end if;
    if new.type is distinct from old.type then
      raise exception 'Channel type is immutable' using errcode = '42501';
    end if;
    new.organization_id := old.organization_id;
    new.created_by_user_id := coalesce(old.created_by_user_id, v_actor_id);
    select p.name into v_creator_name
    from public.profiles p
    where p.id = new.created_by_user_id;
    new.created_by := coalesce(v_creator_name, old.created_by);

    -- An old APK may race with the creator and upsert the same direct-message
    -- row. Keep that operation as a strict no-op instead of creating an
    -- infinite offline retry, while still preventing a participant from
    -- changing metadata or membership.
    if old.type = 'dm'
       and public.auth_can_access_channel(old.organization_id, old.id)
       and not public.auth_can_manage_channel(old.organization_id, old.id) then
      new.name := old.name;
      new.description := old.description;
      new.icon := old.icon;
      new.color := old.color;
    end if;
  end if;

  if new.type not in ('group', 'dm') then
    return new;
  end if;

  v_trusted_members := nullif(current_setting('app.private_channel_member_ids', true), '');
  if v_trusted_members is not null then
    begin
      select coalesce(array_agg(member_id order by member_id::text), '{}'::uuid[])
      into v_member_ids
      from (
        select distinct value::uuid as member_id
        from jsonb_array_elements_text(v_trusted_members::jsonb)
      ) trusted;
    exception when others then
      raise exception 'Invalid trusted channel member payload' using errcode = '22023';
    end;
  else
    v_label_count := jsonb_array_length(coalesce(new.members, '[]'::jsonb));

    with labels as (
      select lower(btrim(label.value)) as normalized_name, label.ordinality
      from jsonb_array_elements_text(coalesce(new.members, '[]'::jsonb))
        with ordinality as label(value, ordinality)
      where nullif(btrim(label.value), '') is not null
    ), resolved as (
      select
        labels.ordinality,
        case when count(p.id) = 1 then (array_agg(p.id order by p.id::text))[1] end as user_id,
        count(p.id) as match_count
      from labels
      left join public.organization_memberships om
        on om.organization_id = new.organization_id
       and om.status = 'active'
      left join public.profiles p
        on p.id = om.user_id
       and lower(btrim(p.name)) = labels.normalized_name
      group by labels.ordinality
    )
    select
      coalesce(
        array_agg(distinct user_id order by user_id) filter (where user_id is not null),
        '{}'::uuid[]
      ),
      count(*) filter (where match_count = 1)
    into v_member_ids, v_resolved_label_count
    from resolved;

    if v_resolved_label_count <> v_label_count then
      if tg_op = 'UPDATE'
         and new.members is not distinct from old.members
         and exists (
           select 1 from public.channel_members cm
           where cm.organization_id = old.organization_id
             and cm.channel_id = old.id
             and cm.status = 'active'
         ) then
        select coalesce(array_agg(cm.user_id order by cm.user_id::text), '{}'::uuid[])
        into v_member_ids
        from public.channel_members cm
        where cm.organization_id = old.organization_id
          and cm.channel_id = old.id
          and cm.status = 'active';
        v_preserve_incomplete_legacy := true;
      else
        raise exception 'Every private channel member must resolve to one active user. Upgrade the app and retry.'
          using errcode = '22023';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.type = 'group' then
    select coalesce(array_agg(cm.user_id order by cm.user_id::text), '{}'::uuid[])
    into v_old_member_ids
    from public.channel_members cm
    where cm.organization_id = old.organization_id
      and cm.channel_id = old.id
      and cm.status = 'active';

    select coalesce(array_agg(member_id order by member_id::text), '{}'::uuid[])
    into v_expected_member_ids
    from unnest(v_old_member_ids) member_id
    where member_id <> v_actor_id;

    v_is_self_leave :=
      v_actor_id = any(v_old_member_ids)
      and not (v_actor_id = any(v_member_ids))
      and old.created_by_user_id is distinct from v_actor_id
      and v_member_ids = v_expected_member_ids
      and cardinality(v_member_ids) >= 2
      and new.name is not distinct from old.name
      and new.description is not distinct from old.description
      and new.icon is not distinct from old.icon
      and new.color is not distinct from old.color;

    if not public.auth_can_manage_channel(old.organization_id, old.id)
       and not v_is_self_leave then
      raise exception 'Only the group creator or an administrator can modify this channel'
        using errcode = '42501';
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.type = 'dm'
     and not public.auth_can_manage_channel(old.organization_id, old.id) then
    select coalesce(array_agg(cm.user_id order by cm.user_id::text), '{}'::uuid[])
    into v_old_member_ids
    from public.channel_members cm
    where cm.organization_id = old.organization_id
      and cm.channel_id = old.id
      and cm.status = 'active';

    if v_member_ids <> v_old_member_ids then
      raise exception 'Only the channel creator can change direct-message members'
        using errcode = '42501';
    end if;
  end if;

  if not public.auth_is_platform_admin()
     and not v_is_self_leave
     and not (v_actor_id = any(v_member_ids)) then
    raise exception 'The channel creator must be an active member' using errcode = '42501';
  end if;

  if not v_preserve_incomplete_legacy then
    if new.type = 'dm' and cardinality(v_member_ids) <> 2 then
      raise exception 'A direct conversation requires exactly two distinct members' using errcode = '22023';
    end if;
    if new.type = 'group' and cardinality(v_member_ids) < 2 then
      raise exception 'A group requires at least two distinct members' using errcode = '22023';
    end if;
  end if;

  perform set_config(
    'app.resolved_channel_member_ids',
    to_jsonb(v_member_ids)::text,
    true
  );
  return new;
end;
$$;

create or replace function private.sync_channel_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_ids uuid[] := '{}'::uuid[];
  v_resolved text;
begin
  if new.type not in ('group', 'dm') then
    return new;
  end if;

  v_resolved := coalesce(
    nullif(current_setting('app.resolved_channel_member_ids', true), ''),
    '[]'
  );
  select coalesce(array_agg(value::uuid order by value), '{}'::uuid[])
  into v_member_ids
  from jsonb_array_elements_text(v_resolved::jsonb);

  if cardinality(v_member_ids) = 0 then
    raise exception 'Private channel UUID membership was not resolved' using errcode = '22023';
  end if;

  insert into public.channel_members(
    organization_id, channel_id, user_id, status, joined_at, added_by
  )
  select new.organization_id, new.id, member_id, 'active', now(), auth.uid()
  from unnest(v_member_ids) member_id
  on conflict (organization_id, channel_id, user_id) do update
  set status = 'active',
      added_by = case
        when public.channel_members.status = 'removed' then excluded.added_by
        else public.channel_members.added_by
      end;

  update public.channel_members cm
  set status = 'removed'
  where cm.organization_id = new.organization_id
    and cm.channel_id = new.id
    and cm.status = 'active'
    and not (cm.user_id = any(v_member_ids));

  return new;
end;
$$;

revoke all on function private.enforce_channel_identity() from public, anon, authenticated;
revoke all on function private.sync_channel_members() from public, anon, authenticated;

drop trigger if exists channel_identity_guard on public.channels;
create trigger channel_identity_guard
before insert or update on public.channels
for each row execute function private.enforce_channel_identity();

drop trigger if exists channel_members_uuid_mirror on public.channels;
create trigger channel_members_uuid_mirror
after insert or update of members on public.channels
for each row execute function private.sync_channel_members();

-- Canonical write API for current mobile clients. Membership validation and
-- the legacy name mirror are performed atomically in one transaction.
create or replace function public.upsert_private_channel(
  p_channel_id text,
  p_type text,
  p_name text,
  p_description text,
  p_icon text,
  p_color text,
  p_member_user_ids uuid[],
  p_organization_id uuid default null
)
returns public.channels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_org uuid;
  v_role text := public.auth_user_role();
  v_actor_name text;
  v_member_ids uuid[];
  v_member_names jsonb;
  v_existing public.channels%rowtype;
  v_result public.channels%rowtype;
  v_existing_members uuid[];
  v_expected_members_after_leave uuid[];
  v_is_self_leave boolean := false;
  v_existing_found boolean := false;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_type not in ('group', 'dm') then
    raise exception 'Only group and dm channels use this function' using errcode = '22023';
  end if;
  if nullif(btrim(p_channel_id), '') is null or length(p_channel_id) > 160 then
    raise exception 'Invalid channel id' using errcode = '22023';
  end if;
  if nullif(btrim(p_name), '') is null or length(p_name) > 120 then
    raise exception 'Invalid channel name' using errcode = '22023';
  end if;

  if public.auth_is_platform_admin() then
    v_org := coalesce(p_organization_id, public.auth_user_org());
  else
    v_org := public.auth_user_org();
    if p_organization_id is not null and p_organization_id is distinct from v_org then
      raise exception 'Cross-organization channel write denied' using errcode = '42501';
    end if;
  end if;
  if v_org is null then
    raise exception 'An active organization is required' using errcode = '42501';
  end if;
  if v_role = 'magasinier' then
    raise exception 'Messaging is unavailable for this role' using errcode = '42501';
  end if;

  select coalesce(array_agg(member_id order by member_id::text), '{}'::uuid[])
  into v_member_ids
  from (
    select distinct member_id
    from unnest(coalesce(p_member_user_ids, '{}'::uuid[])) member_id
    where member_id is not null
  ) normalized;

  if p_type = 'dm' and cardinality(v_member_ids) <> 2 then
    raise exception 'A direct conversation requires exactly two distinct members' using errcode = '22023';
  end if;
  if p_type = 'group' and cardinality(v_member_ids) < 2 then
    raise exception 'A group requires at least two distinct members' using errcode = '22023';
  end if;
  if (
    select count(*)
    from public.organization_memberships om
    where om.organization_id = v_org
      and om.user_id = any(v_member_ids)
      and om.status = 'active'
  ) <> cardinality(v_member_ids) then
    raise exception 'Every channel member must have an active tenant membership' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(p.name order by requested.user_id::text), '[]'::jsonb)
  into v_member_names
  from unnest(v_member_ids) requested(user_id)
  join public.profiles p on p.id = requested.user_id;

  select p.name into v_actor_name from public.profiles p where p.id = v_actor_id;
  if v_actor_name is null then
    raise exception 'Profile not found' using errcode = '42501';
  end if;

  select c.* into v_existing
  from public.channels c
  where c.id = p_channel_id;
  v_existing_found := found;

  if v_existing_found then
    if v_existing.organization_id is distinct from v_org or v_existing.type is distinct from p_type then
      raise exception 'Channel id already belongs to another scope' using errcode = '23505';
    end if;

    select coalesce(array_agg(cm.user_id order by cm.user_id::text), '{}'::uuid[])
    into v_existing_members
    from public.channel_members cm
    where cm.organization_id = v_org
      and cm.channel_id = p_channel_id
      and cm.status = 'active';

    select coalesce(array_agg(member_id order by member_id::text), '{}'::uuid[])
    into v_expected_members_after_leave
    from unnest(v_existing_members) member_id
    where member_id <> v_actor_id;

    v_is_self_leave :=
      p_type = 'group'
      and v_actor_id = any(v_existing_members)
      and not (v_actor_id = any(v_member_ids))
      and v_existing.created_by_user_id is distinct from v_actor_id
      and v_member_ids = v_expected_members_after_leave
      and cardinality(v_member_ids) >= 2;

    if p_type = 'dm'
       and v_existing_members = v_member_ids
       and (v_actor_id = any(v_member_ids) or public.auth_is_platform_admin()) then
      return v_existing;
    end if;

    if not v_is_self_leave
       and not public.auth_can_manage_channel(v_org, p_channel_id) then
      raise exception 'Channel management permission required' using errcode = '42501';
    end if;
  elsif not public.auth_is_platform_admin() and not (v_actor_id = any(v_member_ids)) then
    raise exception 'The channel creator must be a member' using errcode = '42501';
  end if;

  if v_existing_found
     and not public.auth_is_platform_admin()
        and not v_is_self_leave
        and not (v_actor_id = any(v_member_ids)) then
    raise exception 'The channel creator must remain a member' using errcode = '42501';
  end if;

  perform set_config('app.private_channel_member_ids', to_jsonb(v_member_ids)::text, true);

  if v_existing_found then
    update public.channels
    set name = btrim(p_name),
        description = nullif(btrim(p_description), ''),
        icon = coalesce(nullif(btrim(p_icon), ''), case when p_type = 'dm' then 'person-circle' else 'people-circle' end),
        color = coalesce(nullif(btrim(p_color), ''), case when p_type = 'dm' then '#EC4899' else '#7C3AED' end),
        members = v_member_names
    where id = p_channel_id and organization_id = v_org
    returning * into v_result;
    if not found then
      raise exception 'Channel changed concurrently; retry the operation' using errcode = '40001';
    end if;
  else
    insert into public.channels(
      id, name, description, icon, color, type, members,
      created_by, created_by_user_id, organization_id
    ) values (
      p_channel_id, btrim(p_name), nullif(btrim(p_description), ''),
      coalesce(nullif(btrim(p_icon), ''), case when p_type = 'dm' then 'person-circle' else 'people-circle' end),
      coalesce(nullif(btrim(p_color), ''), case when p_type = 'dm' then '#EC4899' else '#7C3AED' end),
      p_type, v_member_names, v_actor_name, v_actor_id, v_org
    )
    on conflict (id) do update
    set name = excluded.name,
        description = excluded.description,
        icon = excluded.icon,
        color = excluded.color,
        members = excluded.members
    returning * into v_result;
  end if;

  perform set_config('app.private_channel_member_ids', '', true);
  return v_result;
end;
$$;

revoke all on function public.upsert_private_channel(
  text, text, text, text, text, text, uuid[], uuid
) from public, anon;
grant execute on function public.upsert_private_channel(
  text, text, text, text, text, text, uuid[], uuid
) to authenticated;

-- Replace every permissive name-based channel policy. PostgreSQL ORs
-- permissive policies, so leaving even one legacy rule would defeat the UUID
-- boundary.
drop policy if exists "Channels creables par membres habilites v2" on public.channels;
drop policy if exists "Channels modifiables par membres habilites v2" on public.channels;
drop policy if exists "Channels supprimables par membres habilites v2" on public.channels;
drop policy if exists "Channels visibles par membres habilites v2" on public.channels;
drop policy if exists channels_select on public.channels;
drop policy if exists channels_write on public.channels;

create policy channels_select_uuid
  on public.channels for select to authenticated
  using (public.auth_can_access_channel(organization_id, id));

create policy channels_insert_uuid
  on public.channels for insert to authenticated
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

create policy channels_update_uuid
  on public.channels for update to authenticated
  using (
    public.auth_can_manage_channel(organization_id, id)
    or (type in ('group', 'dm') and public.auth_can_access_channel(organization_id, id))
  )
  with check (
    public.auth_can_manage_channel(organization_id, id)
    or (type in ('group', 'dm') and public.auth_can_access_channel(organization_id, id))
  );

create policy channels_delete_uuid
  on public.channels for delete to authenticated
  using (public.auth_can_manage_channel(organization_id, id));

-- Restrictive companions make the UUID boundary survive an accidentally
-- reintroduced permissive legacy policy: permissive policies are ORed, while
-- every applicable restrictive policy must also pass.
drop policy if exists channels_uuid_select_restrictive on public.channels;
create policy channels_uuid_select_restrictive
  on public.channels as restrictive for select to authenticated
  using (public.auth_can_access_channel(organization_id, id));

drop policy if exists channels_uuid_insert_restrictive on public.channels;
create policy channels_uuid_insert_restrictive
  on public.channels as restrictive for insert to authenticated
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

drop policy if exists channels_uuid_update_restrictive on public.channels;
create policy channels_uuid_update_restrictive
  on public.channels as restrictive for update to authenticated
  using (
    public.auth_can_manage_channel(organization_id, id)
    or (type in ('group', 'dm') and public.auth_can_access_channel(organization_id, id))
  )
  with check (
    public.auth_can_manage_channel(organization_id, id)
    or (type in ('group', 'dm') and public.auth_can_access_channel(organization_id, id))
  );

drop policy if exists channels_uuid_delete_restrictive on public.channels;
create policy channels_uuid_delete_restrictive
  on public.channels as restrictive for delete to authenticated
  using (public.auth_can_manage_channel(organization_id, id));

-- channel_members itself is readable only for a conversation the actor may
-- access. A tenant administrator who is not a private member must not be able
-- to enumerate participants. Direct writes remain revoked; the RPC/trigger
-- own them.
drop policy if exists channel_members_tenant_select on public.channel_members;
create policy channel_members_channel_select_uuid
  on public.channel_members for select to authenticated
  using (public.auth_can_access_channel(organization_id, channel_id));

revoke all on public.channel_members from public, anon, authenticated;
grant select on public.channel_members to authenticated;

-- Message actor enforcement now checks UUID channel access before accepting a
-- write. Presentation fields (sender/read_by/reactions) remain compatible.
create or replace function private.enforce_message_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_org uuid;
  v_trusted_org text;
begin
  if auth.uid() is null then
    return new;
  end if;
  v_trusted_org := nullif(current_setting('app.trusted_tenant_org', true), '');
  if current_user not in ('anon', 'authenticated') and v_trusted_org is not null then
    v_org := v_trusted_org::uuid;
  else
    v_org := public.auth_user_org();
  end if;
  if v_org is null then
    raise exception 'An active organization membership is required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    select p.name into v_name from public.profiles p where p.id = auth.uid();
    if v_name is null then
      raise exception 'Profile not found' using errcode = '42501';
    end if;
    if not public.auth_can_access_channel(v_org, new.channel_id) then
      raise exception 'Channel access denied' using errcode = '42501';
    end if;
    new.sender_id := auth.uid();
    new.sender := v_name;
    new.organization_id := v_org;
  else
    if current_user not in ('anon', 'authenticated')
       and current_setting('app.message_aux_update', true) = 'true' then
      new.sender_id := old.sender_id;
      new.sender := old.sender;
      new.organization_id := old.organization_id;
      return new;
    end if;
    if not public.auth_can_access_channel(old.organization_id, old.channel_id) then
      raise exception 'Channel access denied' using errcode = '42501';
    end if;
    if old.sender_id is distinct from auth.uid()
       and public.auth_user_role() <> 'admin'
       and not public.auth_is_platform_admin() then
      raise exception 'Message ownership required' using errcode = '42501';
    end if;
    new.sender_id := old.sender_id;
    new.sender := old.sender;
    new.organization_id := old.organization_id;
    new.channel_id := old.channel_id;
  end if;
  return new;
end;
$$;

create or replace function public.toggle_message_reaction(
  p_message_id text,
  p_emoji text,
  p_user_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_users jsonb;
  v_new_users jsonb;
  v_actor_name text;
  v_org uuid := public.auth_user_org();
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Authentication and active membership required' using errcode = '42501';
  end if;
  if nullif(btrim(p_emoji), '') is null or length(p_emoji) > 32 then
    raise exception 'Invalid reaction' using errcode = '22023';
  end if;
  select p.name into v_actor_name from public.profiles p where p.id = auth.uid();

  select coalesce(m.reactions -> p_emoji, '[]'::jsonb)
  into v_current_users
  from public.messages m
  where m.id = p_message_id
    and m.organization_id = v_org
    and public.auth_can_access_channel(m.organization_id, m.channel_id)
  for update of m;
  if not found then
    raise exception 'Message not found or channel access denied' using errcode = 'P0002';
  end if;

  if v_current_users @> jsonb_build_array(v_actor_name) then
    select jsonb_agg(value)
    into v_new_users
    from jsonb_array_elements(v_current_users)
    where value <> to_jsonb(v_actor_name);
    perform set_config('app.message_aux_update', 'true', true);
    update public.messages
    set reactions = case
      when v_new_users is null then reactions - p_emoji
      else jsonb_set(reactions, array[p_emoji], v_new_users)
    end
    where id = p_message_id and organization_id = v_org;
  else
    v_new_users := v_current_users || jsonb_build_array(v_actor_name);
    perform set_config('app.message_aux_update', 'true', true);
    update public.messages
    set reactions = jsonb_set(reactions, array[p_emoji], v_new_users)
    where id = p_message_id and organization_id = v_org;
  end if;
end;
$$;

create or replace function public.mark_messages_read_by(
  p_message_ids text[],
  p_user_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
  v_org uuid := public.auth_user_org();
begin
  if auth.uid() is null or v_org is null then
    raise exception 'Authentication and active membership required' using errcode = '42501';
  end if;
  if coalesce(array_length(p_message_ids, 1), 0) > 100 then
    raise exception 'At most 100 messages can be marked at once' using errcode = '22023';
  end if;
  select p.name into v_actor_name from public.profiles p where p.id = auth.uid();

  perform set_config('app.message_aux_update', 'true', true);
  update public.messages m
  set read_by = m.read_by || jsonb_build_array(v_actor_name)
  where m.id = any(coalesce(p_message_ids, '{}'::text[]))
    and m.organization_id = v_org
    and m.sender_id is distinct from auth.uid()
    and not (m.read_by @> jsonb_build_array(v_actor_name))
    and public.auth_can_access_channel(m.organization_id, m.channel_id);
end;
$$;

revoke all on function public.toggle_message_reaction(text, text, text) from public, anon;
revoke all on function public.mark_messages_read_by(text[], text) from public, anon;
grant execute on function public.toggle_message_reaction(text, text, text) to authenticated;
grant execute on function public.mark_messages_read_by(text[], text) to authenticated;

drop policy if exists "Messages insertables par membres habilités" on public.messages;
drop policy if exists "Messages modifiables par expéditeur" on public.messages;
drop policy if exists "Messages supprimables par expéditeur ou admin" on public.messages;
drop policy if exists "Messages visibles par membres habilités" on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_select_company_safe_v1 on public.messages;
drop policy if exists messages_update on public.messages;
drop policy if exists messages_actor_update_restrictive on public.messages;
drop policy if exists messages_actor_delete_restrictive on public.messages;

-- Policy identifiers in the legacy catalogue contain accented characters and
-- have existed in more than one Unicode encoding. Remove any remaining
-- name-based authorization by inspecting the policy expression instead of
-- trusting the display label.
do $cleanup$
declare
  v_policy record;
begin
  for v_policy in
    select p.tablename, p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('channels', 'messages')
      and (
        coalesce(p.qual, '') ilike '%auth_user_name%'
        or coalesce(p.with_check, '') ilike '%auth_user_name%'
        or coalesce(p.qual, '') ilike '%jsonb_array_elements_text%members%'
        or coalesce(p.with_check, '') ilike '%jsonb_array_elements_text%members%'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  end loop;
end
$cleanup$;

create policy messages_select_uuid
  on public.messages for select to authenticated
  using (public.auth_can_access_channel(organization_id, channel_id));

create policy messages_insert_uuid
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.auth_can_access_channel(organization_id, channel_id)
  );

create policy messages_update_uuid
  on public.messages for update to authenticated
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

create policy messages_delete_uuid
  on public.messages for delete to authenticated
  using (
    public.auth_can_access_channel(organization_id, channel_id)
    and (
      sender_id = (select auth.uid())
      or public.auth_user_role() = 'admin'
      or public.auth_is_platform_admin()
    )
  );

drop policy if exists messages_uuid_select_restrictive on public.messages;
create policy messages_uuid_select_restrictive
  on public.messages as restrictive for select to authenticated
  using (public.auth_can_access_channel(organization_id, channel_id));

drop policy if exists messages_uuid_insert_restrictive on public.messages;
create policy messages_uuid_insert_restrictive
  on public.messages as restrictive for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.auth_can_access_channel(organization_id, channel_id)
  );

drop policy if exists messages_uuid_update_restrictive on public.messages;
create policy messages_uuid_update_restrictive
  on public.messages as restrictive for update to authenticated
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

drop policy if exists messages_uuid_delete_restrictive on public.messages;
create policy messages_uuid_delete_restrictive
  on public.messages as restrictive for delete to authenticated
  using (
    public.auth_can_access_channel(organization_id, channel_id)
    and (
      sender_id = (select auth.uid())
      or public.auth_user_role() = 'admin'
      or public.auth_is_platform_admin()
    )
  );

comment on column public.channels.members is
  'Legacy/presentation mirror only. Private channel authorization uses channel_members.user_id.';
comment on column public.channels.created_by is
  'Legacy/presentation mirror only. Channel authority uses created_by_user_id.';
comment on table public.channel_members is
  'Authoritative UUID membership for private group and direct-message channels.';
