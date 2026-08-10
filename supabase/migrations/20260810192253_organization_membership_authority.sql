-- BuildTrack tenant authority hardening.
--
-- profiles remains a personal-information table. Its legacy role / tenant
-- columns are maintained only as a compatibility projection while the mobile
-- app and web client migrate; every authorization decision below reads
-- organization_memberships (or private.platform_admins) instead.

create schema if not exists private;

create table if not exists private.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

revoke all on table private.platform_admins from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.companies'::regclass
      and conname = 'companies_organization_id_id_key'
  ) then
    alter table public.companies
      add constraint companies_organization_id_id_key
      unique (organization_id, id);
  end if;
end
$$;

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null
    check (role in (
      'admin', 'conducteur', 'chef_equipe', 'magasinier',
      'observateur', 'sous_traitant'
    )),
  company_id text,
  permissions_override jsonb not null default '{}'::jsonb
    check (jsonb_typeof(permissions_override) = 'object'),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked')),
  is_primary boolean not null default true,
  role_version bigint not null default 1 check (role_version > 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint organization_memberships_company_tenant_fkey
    foreign key (organization_id, company_id)
    references public.companies(organization_id, id)
    on delete set null (company_id)
);

create unique index if not exists organization_memberships_one_primary_active
  on public.organization_memberships(user_id)
  where status = 'active' and is_primary;

create index if not exists organization_memberships_user_active_idx
  on public.organization_memberships(user_id, status, is_primary);

create index if not exists organization_memberships_org_active_idx
  on public.organization_memberships(organization_id, status, role);

alter table public.organization_memberships enable row level security;

create table if not exists private.authorization_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  action text not null,
  organization_id uuid,
  subject_user_id uuid,
  old_value jsonb,
  new_value jsonb,
  request_id text default nullif(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id',
    ''
  )
);

revoke all on table private.authorization_audit_log from public, anon, authenticated;

-- Preserve the current production state before switching authority helpers.
insert into private.platform_admins (user_id, status, created_by)
select p.id, 'active', p.id
from public.profiles p
where p.role = 'super_admin'
on conflict (user_id) do update
set status = 'active', updated_at = now();

insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  company_id,
  permissions_override,
  status,
  is_primary,
  created_by
)
select
  p.organization_id,
  p.id,
  case when p.role = 'super_admin' then 'admin' else p.role end,
  p.company_id,
  coalesce(p.permissions_override, '{}'::jsonb),
  'active',
  true,
  p.id
from public.profiles p
where p.organization_id is not null
  and p.role in (
    'super_admin', 'admin', 'conducteur', 'chef_equipe',
    'magasinier', 'observateur', 'sous_traitant'
  )
on conflict (organization_id, user_id) do update
set role = excluded.role,
    company_id = excluded.company_id,
    permissions_override = excluded.permissions_override,
    status = 'active',
    is_primary = true,
    updated_at = now();

create or replace function public.auth_is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from private.platform_admins pa
    where pa.user_id = auth.uid()
      and pa.status = 'active'
  )
$$;

create or replace function public.auth_has_active_membership(p_organization_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships om
    where om.user_id = auth.uid()
      and om.organization_id = p_organization_id
      and om.status = 'active'
  )
$$;

create or replace function public.auth_user_org()
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select om.organization_id
  from public.organization_memberships om
  where om.user_id = auth.uid()
    and om.status = 'active'
  order by om.is_primary desc, om.updated_at desc, om.created_at desc
  limit 1
$$;

create or replace function public.auth_user_role()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if public.auth_is_platform_admin() then
    return 'super_admin';
  end if;

  return (
    select om.role
    from public.organization_memberships om
    where om.user_id = auth.uid()
      and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc, om.created_at desc
    limit 1
  );
end;
$$;

create or replace function public.auth_user_company_id()
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select om.company_id
  from public.organization_memberships om
  where om.user_id = auth.uid()
    and om.status = 'active'
  order by om.is_primary desc, om.updated_at desc, om.created_at desc
  limit 1
$$;

create or replace function public.auth_user_is_privileged()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(public.auth_user_role() in ('super_admin', 'admin', 'conducteur'), false)
$$;

create or replace function public.auth_user_has_permission(p_permission text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_role text;
  v_override jsonb := '{}'::jsonb;
  v_default boolean := false;
  v_override_value jsonb;
begin
  v_role := public.auth_user_role();
  if v_role is null then
    return false;
  end if;

  if v_role = 'super_admin' then
    return true;
  end if;

  select coalesce(om.permissions_override, '{}'::jsonb)
  into v_override
  from public.organization_memberships om
  where om.user_id = auth.uid()
    and om.organization_id = public.auth_user_org()
    and om.status = 'active'
  limit 1;

  v_default := case p_permission
    when 'canCreate' then v_role in ('admin', 'conducteur', 'chef_equipe')
    when 'canEdit' then v_role in ('admin', 'conducteur', 'chef_equipe')
    when 'canEditOwn' then v_role in ('admin', 'conducteur', 'chef_equipe', 'sous_traitant')
    when 'canDelete' then v_role in ('admin')
    when 'canExport' then v_role in ('admin', 'conducteur', 'observateur')
    when 'canManageTeams' then v_role in ('admin', 'conducteur')
    when 'canViewTeams' then v_role in ('admin', 'conducteur', 'chef_equipe', 'observateur')
    when 'canUpdateAttendance' then v_role in ('admin', 'conducteur', 'chef_equipe')
    when 'canMovePins' then v_role in ('admin', 'conducteur', 'chef_equipe')
    when 'canEditChantier' then v_role in ('admin', 'conducteur')
    when 'canViewInventory' then v_role in ('admin', 'conducteur', 'chef_equipe', 'magasinier', 'observateur')
    when 'canRecordInventory' then v_role in ('admin', 'conducteur', 'chef_equipe', 'magasinier')
    when 'canManageInventoryProducts' then v_role in ('admin', 'conducteur', 'magasinier')
    when 'canAdjustInventory' then v_role in ('admin', 'conducteur')
    when 'canExportInventory' then v_role in ('admin', 'conducteur', 'magasinier', 'observateur')
    else false
  end;

  v_override_value := v_override -> p_permission;
  if jsonb_typeof(v_override_value) = 'boolean' then
    return (v_override_value #>> '{}')::boolean;
  end if;
  return v_default;
end;
$$;

create or replace function private.inventory_can(p_permission text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select case p_permission
    when 'view' then public.auth_user_has_permission('canViewInventory')
    when 'record' then public.auth_user_has_permission('canRecordInventory')
    when 'manage' then public.auth_user_has_permission('canManageInventoryProducts')
    when 'adjust' then public.auth_user_has_permission('canAdjustInventory')
    when 'export' then public.auth_user_has_permission('canExportInventory')
    else false
  end
$$;

revoke all on function public.auth_is_platform_admin() from public, anon;
revoke all on function public.auth_has_active_membership(uuid) from public, anon;
revoke all on function public.auth_user_org() from public, anon;
revoke all on function public.auth_user_role() from public, anon;
revoke all on function public.auth_user_company_id() from public, anon;
revoke all on function public.auth_user_is_privileged() from public, anon;
revoke all on function public.auth_user_has_permission(text) from public, anon;
revoke all on function private.inventory_can(text) from public, anon;

grant execute on function public.auth_is_platform_admin() to authenticated, service_role;
grant execute on function public.auth_has_active_membership(uuid) to authenticated, service_role;
grant execute on function public.auth_user_org() to authenticated, service_role;
grant execute on function public.auth_user_role() to authenticated, service_role;
grant execute on function public.auth_user_company_id() to authenticated, service_role;
grant execute on function public.auth_user_is_privileged() to authenticated, service_role;
grant execute on function public.auth_user_has_permission(text) to authenticated, service_role;
grant execute on function private.inventory_can(text) to authenticated, service_role;

drop policy if exists organization_memberships_select_authorized on public.organization_memberships;
create policy organization_memberships_select_authorized
  on public.organization_memberships
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.auth_is_platform_admin()
    or public.auth_has_active_membership(organization_id)
  );

revoke all on table public.organization_memberships from public, anon, authenticated;
grant select on table public.organization_memberships to authenticated;

-- Organizations and subscriptions are authorization/control-plane records.
-- Clients may read only their active tenant (platform administrators may read
-- all), while every mutation goes through the audited SECURITY DEFINER RPCs
-- declared below. This also removes the legacy "any authenticated user may
-- create an organization/subscription" policies.
do $$
declare
  v_policy record;
  v_table text;
begin
  foreach v_table in array array['organizations', 'subscriptions'] loop
    for v_policy in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = v_table
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end
$$;

alter table public.organizations enable row level security;
create policy organizations_select_membership_scoped
  on public.organizations
  for select
  to authenticated
  using (
    public.auth_is_platform_admin()
    or public.auth_has_active_membership(id)
  );

alter table public.subscriptions enable row level security;
create policy subscriptions_select_membership_scoped
  on public.subscriptions
  for select
  to authenticated
  using (
    public.auth_is_platform_admin()
    or public.auth_has_active_membership(organization_id)
  );

revoke all on table public.organizations from public, anon, authenticated;
revoke all on table public.subscriptions from public, anon, authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.subscriptions to authenticated;

create or replace function private.role_label(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_role
    when 'super_admin' then 'Super Administrator'
    when 'admin' then 'Administrator'
    when 'conducteur' then 'Construction manager'
    when 'chef_equipe' then 'Team lead'
    when 'magasinier' then 'Storekeeper'
    when 'observateur' then 'Observer'
    when 'sous_traitant' then 'Subcontractor'
    else p_role
  end
$$;

create or replace function private.audit_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.authorization_audit_log (
    actor_user_id, action, organization_id, subject_user_id, old_value, new_value
  ) values (
    auth.uid(),
    'membership_' || lower(tg_op),
    coalesce(new.organization_id, old.organization_id),
    coalesce(new.user_id, old.user_id),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists organization_memberships_audit on public.organization_memberships;
create trigger organization_memberships_audit
after insert or update or delete on public.organization_memberships
for each row execute function private.audit_membership_change();

create or replace function private.sync_membership_profile_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := coalesce(new.user_id, old.user_id);
  v_membership public.organization_memberships%rowtype;
  v_platform boolean;
begin
  select exists (
    select 1 from private.platform_admins pa
    where pa.user_id = v_user_id and pa.status = 'active'
  ) into v_platform;

  select * into v_membership
  from public.organization_memberships om
  where om.user_id = v_user_id and om.status = 'active'
  order by om.is_primary desc, om.updated_at desc, om.created_at desc
  limit 1;

  if found then
    update public.profiles p
    set organization_id = v_membership.organization_id,
        company_id = v_membership.company_id,
        permissions_override = v_membership.permissions_override,
        role = case when v_platform then 'super_admin' else v_membership.role end,
        role_label = private.role_label(case when v_platform then 'super_admin' else v_membership.role end)
    where p.id = v_user_id;
  else
    update public.profiles p
    set organization_id = null,
        company_id = null,
        permissions_override = '{}'::jsonb,
        role = case when v_platform then 'super_admin' else 'observateur' end,
        role_label = private.role_label(case when v_platform then 'super_admin' else 'observateur' end)
    where p.id = v_user_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists organization_memberships_sync_profile on public.organization_memberships;
create trigger organization_memberships_sync_profile
after insert or update or delete on public.organization_memberships
for each row execute function private.sync_membership_profile_projection();

create or replace function private.protect_profile_authority_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and (
    new.role is distinct from old.role
    or new.role_label is distinct from old.role_label
    or new.organization_id is distinct from old.organization_id
    or new.company_id is distinct from old.company_id
    or new.permissions_override is distinct from old.permissions_override
    or new.id is distinct from old.id
    or new.email is distinct from old.email
  ) then
    raise exception 'Profile authorization fields are server-managed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_authority_columns on public.profiles;
create trigger profiles_protect_authority_columns
before update on public.profiles
for each row execute function private.protect_profile_authority_columns();

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', v_policy.policyname);
  end loop;
end
$$;

alter table public.profiles enable row level security;

create policy profiles_select_membership_scoped
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or public.auth_is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships target_membership
      where target_membership.user_id = profiles.id
        and target_membership.status = 'active'
        and public.auth_has_active_membership(target_membership.organization_id)
    )
  );

create policy profiles_update_personal_self
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (name, preferred_language, last_read_by_channel, pinned_channels)
  on public.profiles to authenticated;

create or replace function public.ensure_current_user_profile(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select lower(u.email), coalesce(
    nullif(btrim(p_name), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    split_part(u.email, '@', 1)
  )
  into v_email, v_name
  from auth.users u
  where u.id = v_user_id;

  if v_email is null then
    raise exception 'Authenticated user not found' using errcode = 'P0002';
  end if;

  insert into public.profiles (
    id, name, email, role, role_label, organization_id, company_id, permissions_override
  ) values (
    v_user_id, v_name, v_email, 'observateur', private.role_label('observateur'),
    null, null, '{}'::jsonb
  )
  on conflict (id) do update
  set name = coalesce(nullif(btrim(excluded.name), ''), public.profiles.name),
      email = public.profiles.email;

  return jsonb_build_object('id', v_user_id, 'created', true);
end;
$$;

revoke all on function public.ensure_current_user_profile(text) from public, anon;
grant execute on function public.ensure_current_user_profile(text) to authenticated;

-- Replace the old profile-row authority readers with membership projections.
drop function if exists public.get_profile_for_current_user();
create function public.get_profile_for_current_user()
returns table (
  id uuid,
  name text,
  role text,
  role_label text,
  email text,
  organization_id uuid,
  company_id text,
  last_read_by_channel jsonb,
  pinned_channels jsonb,
  permissions_override jsonb,
  preferred_language text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    p.name,
    coalesce(public.auth_user_role(), 'observateur') as role,
    private.role_label(coalesce(public.auth_user_role(), 'observateur')) as role_label,
    p.email,
    public.auth_user_org() as organization_id,
    public.auth_user_company_id() as company_id,
    p.last_read_by_channel,
    p.pinned_channels,
    coalesce(om.permissions_override, '{}'::jsonb) as permissions_override,
    p.preferred_language
  from public.profiles p
  left join public.organization_memberships om
    on om.user_id = p.id
   and om.organization_id = public.auth_user_org()
   and om.status = 'active'
  where p.id = auth.uid()
$$;

revoke all on function public.get_profile_for_current_user() from public, anon;
grant execute on function public.get_profile_for_current_user() to authenticated;

drop function if exists public.get_org_users();
create function public.get_org_users()
returns table (
  id uuid,
  name text,
  role text,
  role_label text,
  email text,
  organization_id uuid,
  company_id text,
  permissions_override jsonb,
  preferred_language text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p.id,
    p.name,
    case
      when exists (
        select 1 from private.platform_admins pa
        where pa.user_id = p.id and pa.status = 'active'
      ) then 'super_admin'
      else om.role
    end as role,
    private.role_label(case
      when exists (
        select 1 from private.platform_admins pa
        where pa.user_id = p.id and pa.status = 'active'
      ) then 'super_admin'
      else om.role
    end) as role_label,
    p.email,
    om.organization_id,
    om.company_id,
    om.permissions_override,
    p.preferred_language
  from public.organization_memberships om
  join public.profiles p on p.id = om.user_id
  where om.status = 'active'
    and (
      public.auth_is_platform_admin()
      or om.organization_id = public.auth_user_org()
    )
$$;

revoke all on function public.get_org_users() from public, anon;
grant execute on function public.get_org_users() to authenticated;

create or replace function private.require_membership_admin(p_organization_id uuid)
returns void
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if public.auth_is_platform_admin() then
    return;
  end if;
  if not exists (
    select 1 from public.organization_memberships om
    where om.user_id = auth.uid()
      and om.organization_id = p_organization_id
      and om.status = 'active'
      and om.role = 'admin'
  ) then
    raise exception 'Organization administrator required' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_tenant_role(p_role text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_role is null or p_role not in (
    'admin', 'conducteur', 'chef_equipe', 'magasinier',
    'observateur', 'sous_traitant'
  ) then
    raise exception 'Invalid tenant role' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.admin_update_membership(
  p_user_id uuid,
  p_role text,
  p_company_id text default null,
  p_permissions_override jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.organization_memberships%rowtype;
begin
  if public.auth_is_platform_admin() then
    select om.organization_id into v_org
    from public.organization_memberships om
    where om.user_id = p_user_id and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc
    limit 1;
  else
    v_org := public.auth_user_org();
  end if;
  if v_org is null then
    raise exception 'No active organization' using errcode = '42501';
  end if;
  perform private.require_membership_admin(v_org);
  perform private.assert_tenant_role(p_role);
  if jsonb_typeof(coalesce(p_permissions_override, '{}'::jsonb)) <> 'object' then
    raise exception 'permissions_override must be an object' using errcode = '22023';
  end if;
  if exists (
    select 1 from private.platform_admins pa
    where pa.user_id = p_user_id and pa.status = 'active'
  ) and not public.auth_is_platform_admin() then
    raise exception 'Platform administrators are managed by the platform control plane'
      using errcode = '42501';
  end if;

  update public.organization_memberships om
  set role = p_role,
      company_id = p_company_id,
      permissions_override = coalesce(p_permissions_override, '{}'::jsonb),
      role_version = om.role_version + 1,
      updated_at = now()
  where om.organization_id = v_org
    and om.user_id = p_user_id
    and om.status = 'active'
  returning * into v_row;

  if not found then
    raise exception 'Active membership not found' using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.admin_revoke_membership(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.organization_memberships%rowtype;
begin
  if public.auth_is_platform_admin() then
    select om.organization_id into v_org
    from public.organization_memberships om
    where om.user_id = p_user_id and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc
    limit 1;
  else
    v_org := public.auth_user_org();
  end if;
  if v_org is null then
    raise exception 'No active organization' using errcode = '42501';
  end if;
  perform private.require_membership_admin(v_org);
  if p_user_id = auth.uid() then
    raise exception 'Administrators cannot revoke their own active membership'
      using errcode = '42501';
  end if;
  if exists (
    select 1 from private.platform_admins pa
    where pa.user_id = p_user_id and pa.status = 'active'
  ) then
    raise exception 'Platform administrators are managed by the platform control plane'
      using errcode = '42501';
  end if;

  update public.organization_memberships om
  set status = 'revoked',
      is_primary = false,
      role_version = om.role_version + 1,
      updated_at = now()
  where om.organization_id = v_org
    and om.user_id = p_user_id
    and om.status = 'active'
  returning * into v_row;

  if not found then
    raise exception 'Active membership not found' using errcode = 'P0002';
  end if;

  update public.invitations
  set status = 'expired', expires_at = least(expires_at, now())
  where organization_id = v_org
    and lower(email) = (
      select lower(email) from public.profiles where id = p_user_id
    )
    and status = 'pending';

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.admin_update_membership(uuid, text, text, jsonb) from public, anon;
revoke all on function public.admin_revoke_membership(uuid) from public, anon;
grant execute on function public.admin_update_membership(uuid, text, text, jsonb) to authenticated;
grant execute on function public.admin_revoke_membership(uuid) to authenticated;

-- Invitations are immutable authorization grants. Clients can read the list
-- in their administration UI, but all writes happen through audited RPCs.
create or replace function private.protect_invitation_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'Invitations are server-managed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists invitations_protect_authority on public.invitations;
create trigger invitations_protect_authority
before insert or update or delete on public.invitations
for each row execute function private.protect_invitation_authority();

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'invitations'
  loop
    execute format('drop policy if exists %I on public.invitations', v_policy.policyname);
  end loop;
end
$$;

alter table public.invitations enable row level security;
create policy invitations_select_admin
  on public.invitations
  for select
  to authenticated
  using (
    public.auth_is_platform_admin()
    or (
      organization_id = public.auth_user_org()
      and public.auth_user_role() = 'admin'
    )
  );

revoke all on table public.invitations from public, anon, authenticated;
grant select on table public.invitations to authenticated;

create or replace function public.admin_create_invitation(
  p_email text,
  p_role text,
  p_company_id text default null,
  p_expires_at timestamptz default null
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.auth_user_org();
  v_email text := lower(nullif(btrim(p_email), ''));
  v_row public.invitations%rowtype;
begin
  if v_org is null then
    raise exception 'No active organization' using errcode = '42501';
  end if;
  perform private.require_membership_admin(v_org);
  perform private.assert_tenant_role(p_role);
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies c
    where c.organization_id = v_org and c.id = p_company_id
  ) then
    raise exception 'Company is outside the active organization' using errcode = '23503';
  end if;

  update public.invitations
  set status = 'expired', expires_at = least(expires_at, now())
  where organization_id = v_org
    and lower(email) = v_email
    and status = 'pending';

  insert into public.invitations (
    organization_id, email, role, company_id, invited_by, expires_at
  ) values (
    v_org, v_email, p_role, p_company_id, auth.uid(),
    coalesce(p_expires_at, now() + interval '7 days')
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.admin_delete_invitation(p_invitation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if public.auth_is_platform_admin() then
    select i.organization_id into v_org
    from public.invitations i where i.id = p_invitation_id;
  else
    v_org := public.auth_user_org();
  end if;
  if v_org is null then
    raise exception 'No active organization' using errcode = '42501';
  end if;
  perform private.require_membership_admin(v_org);
  delete from public.invitations
  where id = p_invitation_id and organization_id = v_org;
  return found;
end;
$$;

create or replace function public.admin_resend_invitation(p_invitation_id uuid)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_row public.invitations%rowtype;
begin
  if public.auth_is_platform_admin() then
    select i.organization_id into v_org
    from public.invitations i where i.id = p_invitation_id;
  else
    v_org := public.auth_user_org();
  end if;
  if v_org is null then
    raise exception 'No active organization' using errcode = '42501';
  end if;
  perform private.require_membership_admin(v_org);
  update public.invitations
  set resend_count = resend_count + 1,
      last_resent_at = now(),
      expires_at = greatest(expires_at, now() + interval '7 days')
  where id = p_invitation_id
    and organization_id = v_org
    and status = 'pending'
  returning * into v_row;
  if not found then
    raise exception 'Pending invitation not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.admin_create_invitation(text, text, text, timestamptz) from public, anon;
revoke all on function public.admin_delete_invitation(uuid) from public, anon;
revoke all on function public.admin_resend_invitation(uuid) from public, anon;
grant execute on function public.admin_create_invitation(text, text, text, timestamptz) to authenticated;
grant execute on function public.admin_delete_invitation(uuid) to authenticated;
grant execute on function public.admin_resend_invitation(uuid) to authenticated;

create or replace function public.platform_create_organization(
  p_name text,
  p_slug text,
  p_admin_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_plan_id uuid;
  v_inv public.invitations%rowtype;
  v_email text := lower(nullif(btrim(p_admin_email), ''));
begin
  if not public.auth_is_platform_admin() then
    raise exception 'Platform administrator required' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_slug), '') is null then
    raise exception 'Organization name and slug are required' using errcode = '22023';
  end if;

  insert into public.organizations(name, slug)
  values (btrim(p_name), btrim(p_slug))
  returning * into v_org;

  perform set_config('app.trusted_tenant_org', v_org.id::text, true);

  select p.id into v_plan_id
  from public.plans p
  order by case when lower(p.name) in ('entreprise', 'enterprise') then 0 else 1 end,
           p.price_monthly desc
  limit 1;

  if v_plan_id is not null then
    insert into public.subscriptions(organization_id, plan_id, status, started_at)
    values (v_org.id, v_plan_id, 'active', now());
  end if;

  insert into public.channels(
    id, name, type, organization_id, created_by, members
  ) values (
    'general-' || v_org.id::text,
    'General',
    'general',
    v_org.id,
    auth.uid()::text,
    '[]'::jsonb
  );

  if v_email is not null then
    if position('@' in v_email) < 2 then
      raise exception 'Invalid administrator email' using errcode = '22023';
    end if;
    insert into public.invitations(
      organization_id, email, role, invited_by
    ) values (
      v_org.id, v_email, 'admin', auth.uid()
    ) returning * into v_inv;
  end if;

  return jsonb_build_object(
    'organization', to_jsonb(v_org),
    'invitation', case when v_inv.id is null then null else to_jsonb(v_inv) end
  );
end;
$$;

create or replace function public.platform_create_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_company_id text default null,
  p_expires_at timestamptz default null
)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(nullif(btrim(p_email), ''));
  v_row public.invitations%rowtype;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'Platform administrator required' using errcode = '42501';
  end if;
  perform private.assert_tenant_role(p_role);
  if not exists (select 1 from public.organizations o where o.id = p_organization_id) then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  if v_email is null or position('@' in v_email) < 2 then
    raise exception 'Invalid email' using errcode = '22023';
  end if;
  if p_company_id is not null and not exists (
    select 1 from public.companies c
    where c.organization_id = p_organization_id and c.id = p_company_id
  ) then
    raise exception 'Company is outside the target organization' using errcode = '23503';
  end if;

  update public.invitations
  set status = 'expired', expires_at = least(expires_at, now())
  where organization_id = p_organization_id
    and lower(email) = v_email
    and status = 'pending';

  insert into public.invitations(
    organization_id, email, role, company_id, invited_by, expires_at
  ) values (
    p_organization_id, v_email, p_role, p_company_id, auth.uid(),
    coalesce(p_expires_at, now() + interval '7 days')
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.update_current_organization(
  p_name text,
  p_slug text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid := public.auth_user_org();
  v_row public.organizations%rowtype;
begin
  if v_org_id is null then
    raise exception 'No active organization' using errcode = '42501';
  end if;
  perform private.require_membership_admin(v_org_id);
  update public.organizations o
  set name = coalesce(nullif(btrim(p_name), ''), o.name),
      slug = coalesce(nullif(btrim(p_slug), ''), o.slug)
  where o.id = v_org_id
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.platform_update_organization(
  p_organization_id uuid,
  p_name text,
  p_slug text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.organizations%rowtype;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'Platform administrator required' using errcode = '42501';
  end if;
  update public.organizations o
  set name = coalesce(nullif(btrim(p_name), ''), o.name),
      slug = coalesce(nullif(btrim(p_slug), ''), o.slug)
  where o.id = p_organization_id
  returning * into v_row;
  if not found then
    raise exception 'Organization not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

create or replace function public.platform_update_subscription(
  p_organization_id uuid,
  p_plan_id uuid default null,
  p_status text default null
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.subscriptions%rowtype;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'Platform administrator required' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('trial', 'active', 'suspended', 'expired') then
    raise exception 'Invalid subscription status' using errcode = '22023';
  end if;
  if p_plan_id is not null and not exists (select 1 from public.plans p where p.id = p_plan_id) then
    raise exception 'Plan not found' using errcode = '23503';
  end if;

  update public.subscriptions s
  set plan_id = coalesce(p_plan_id, s.plan_id),
      status = coalesce(p_status, s.status)
  where s.organization_id = p_organization_id
  returning * into v_row;

  if not found then
    raise exception 'Subscription not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.platform_create_organization(text, text, text) from public, anon;
revoke all on function public.platform_create_invitation(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.update_current_organization(text, text) from public, anon;
revoke all on function public.platform_update_organization(uuid, text, text) from public, anon;
revoke all on function public.platform_update_subscription(uuid, uuid, text) from public, anon;
grant execute on function public.platform_create_organization(text, text, text) to authenticated;
grant execute on function public.platform_create_invitation(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.update_current_organization(text, text) to authenticated;
grant execute on function public.platform_update_organization(uuid, text, text) to authenticated;
grant execute on function public.platform_update_subscription(uuid, uuid, text) to authenticated;

-- Organization deletion remains intentionally disabled until its media purge
-- is moved to the canonical server lifecycle.
revoke all on function public.delete_organization(uuid) from public, anon, authenticated;

create or replace function public.link_invitation_for_current_user(p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_name text;
  v_inv public.invitations%rowtype;
  v_existing_org uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('linked', false, 'reason', 'not_authenticated');
  end if;

  select lower(u.email), coalesce(
    nullif(btrim(p_name), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    split_part(u.email, '@', 1)
  )
  into v_user_email, v_name
  from auth.users u
  where u.id = v_user_id;

  if v_user_email is null then
    return jsonb_build_object('linked', false, 'reason', 'user_not_found');
  end if;

  select * into v_inv
  from public.invitations i
  where lower(i.email) = v_user_email
    and i.status = 'pending'
    and i.expires_at > now()
    and i.role in (
      'admin', 'conducteur', 'chef_equipe', 'magasinier',
      'observateur', 'sous_traitant'
    )
  order by i.created_at desc
  for update skip locked
  limit 1;

  if not found then
    select om.organization_id into v_existing_org
    from public.organization_memberships om
    where om.user_id = v_user_id and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc
    limit 1;
    return jsonb_build_object(
      'linked', v_existing_org is not null,
      'reason', case when v_existing_org is null then 'no_invitation' else 'already_linked' end,
      'organization_id', v_existing_org
    );
  end if;

  insert into public.profiles (
    id, name, email, role, role_label, organization_id, company_id, permissions_override
  ) values (
    v_user_id, v_name, v_user_email, 'observateur', private.role_label('observateur'),
    null, null, '{}'::jsonb
  )
  on conflict (id) do update
  set name = coalesce(nullif(btrim(excluded.name), ''), public.profiles.name),
      email = public.profiles.email;

  update public.organization_memberships
  set is_primary = false, updated_at = now()
  where user_id = v_user_id and status = 'active' and is_primary;

  insert into public.organization_memberships (
    organization_id, user_id, role, company_id, status, is_primary, created_by
  ) values (
    v_inv.organization_id, v_user_id, v_inv.role, v_inv.company_id,
    'active', true, v_inv.invited_by
  )
  on conflict (organization_id, user_id) do update
  set role = excluded.role,
      company_id = excluded.company_id,
      status = 'active',
      is_primary = true,
      role_version = public.organization_memberships.role_version + 1,
      updated_at = now();

  update public.invitations
  set status = 'accepted'
  where id = v_inv.id and status = 'pending';

  update public.channels
  set members = members || jsonb_build_array(v_name)
  where organization_id = v_inv.organization_id
    and type = 'general'
    and not (members @> jsonb_build_array(v_name));

  return jsonb_build_object(
    'linked', true,
    'organization_id', v_inv.organization_id,
    'role', v_inv.role,
    'invitation_id', v_inv.id,
    'invitation_status', 'accepted',
    'accepted_now', true
  );
end;
$$;

revoke all on function public.link_invitation_for_current_user(text) from public, anon;
grant execute on function public.link_invitation_for_current_user(text) to authenticated;

-- Token lookup is the only anonymous invitation disclosure. Email-only status
-- lookups are no longer exposed because they are an enumeration oracle.
revoke all on function public.check_pending_invitation(text) from public, anon, authenticated;

create or replace function public.check_invitation_token(p_token text, p_email text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.invitations i
    where i.token = nullif(btrim(p_token), '')
      and lower(i.email) = lower(nullif(btrim(p_email), ''))
      and i.status = 'pending'
      and i.expires_at > now()
  )
$$;

revoke all on function public.check_invitation_token(text, text) from public;
grant execute on function public.check_invitation_token(text, text) to anon, authenticated;

create or replace function public.get_authorization_context_for_user(p_user_id uuid)
returns table (
  user_id uuid,
  organization_id uuid,
  role text,
  company_id text,
  permissions_override jsonb,
  membership_status text,
  role_version bigint,
  is_platform_admin boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    p_user_id,
    om.organization_id,
    case when pa.user_id is not null then 'super_admin' else om.role end,
    om.company_id,
    coalesce(om.permissions_override, '{}'::jsonb),
    om.status,
    om.role_version,
    pa.user_id is not null
  from (select 1) seed
  left join lateral (
    select m.*
    from public.organization_memberships m
    where m.user_id = p_user_id and m.status = 'active'
    order by m.is_primary desc, m.updated_at desc, m.created_at desc
    limit 1
  ) om on true
  left join private.platform_admins pa
    on pa.user_id = p_user_id and pa.status = 'active'
  where om.user_id is not null or pa.user_id is not null
$$;

revoke all on function public.get_authorization_context_for_user(uuid) from public, anon, authenticated;
grant execute on function public.get_authorization_context_for_user(uuid) to service_role;

-- Keep the compatibility projection synchronized after the initial backfill.
update public.organization_memberships
set updated_at = updated_at;

notify pgrst, 'reload schema';
