-- Enforce the tenant boundary independently of permissive legacy policies.
-- Existing tenantless/orphaned rows remain quarantined for an explicit data
-- recovery pass; every new authenticated write is fail-closed.

create or replace function private.enforce_actor_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_org uuid;
  v_trusted_org text;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_trusted_org := nullif(current_setting('app.trusted_tenant_org', true), '');
  if current_user not in ('anon', 'authenticated') and v_trusted_org is not null then
    v_actor_org := v_trusted_org::uuid;
  else
    v_actor_org := public.auth_user_org();
  end if;

  if v_actor_org is null then
    raise exception 'An active organization membership is required'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and old.organization_id is distinct from v_actor_org then
    raise exception 'Cross-tenant update rejected'
      using errcode = '42501';
  end if;

  -- Never trust organization_id supplied by an authenticated payload.
  new.organization_id := v_actor_org;
  return new;
end;
$$;

revoke all on function private.enforce_actor_tenant() from public, anon, authenticated;

do $$
declare
  v_table text;
  v_tables text[] := array[
    'channels', 'chantiers', 'checklists', 'companies', 'data_audit_log',
    'documents', 'incidents', 'inventory_movements', 'inventory_products',
    'journal_entries', 'lots', 'messages', 'notification_preferences', 'oprs',
    'photos', 'push_tokens', 'regulatory_docs', 'reserves', 'site_plans',
    'subscriptions', 'tasks', 'time_entries', 'visites'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    execute format('drop trigger if exists tenant_scope_guard on public.%I', v_table);
    execute format(
      'create trigger tenant_scope_guard before insert or update on public.%I '
      'for each row execute function private.enforce_actor_tenant()',
      v_table
    );

    execute format('alter table public.%I enable row level security', v_table);
    execute format('drop policy if exists tenant_boundary_restrictive on public.%I', v_table);
    execute format(
      'create policy tenant_boundary_restrictive on public.%I '
      'as restrictive for all to authenticated '
      'using (public.auth_is_platform_admin() or '
      '(organization_id is not null and organization_id = public.auth_user_org())) '
      'with check (public.auth_is_platform_admin() or '
      '(organization_id is not null and organization_id = public.auth_user_org()))',
      v_table
    );
    execute format('drop policy if exists tenant_boundary_anonymous_deny on public.%I', v_table);
    execute format(
      'create policy tenant_boundary_anonymous_deny on public.%I '
      'as restrictive for all to anon using (false) with check (false)',
      v_table
    );
  end loop;
end
$$;

-- Tenant-aware parent keys. The original single-column keys stay in place for
-- compatibility; all new relationships below must also carry organization_id.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.chantiers'::regclass and conname = 'chantiers_organization_id_id_key') then
    alter table public.chantiers add constraint chantiers_organization_id_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reserves'::regclass and conname = 'reserves_organization_id_id_key') then
    alter table public.reserves add constraint reserves_organization_id_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_organization_id_id_key') then
    alter table public.tasks add constraint tasks_organization_id_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.channels'::regclass and conname = 'channels_organization_id_id_key') then
    alter table public.channels add constraint channels_organization_id_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.site_plans'::regclass and conname = 'site_plans_organization_id_id_key') then
    alter table public.site_plans add constraint site_plans_organization_id_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.visites'::regclass and conname = 'visites_organization_id_id_key') then
    alter table public.visites add constraint visites_organization_id_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lots'::regclass and conname = 'lots_organization_id_id_key') then
    alter table public.lots add constraint lots_organization_id_id_key unique (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_products'::regclass and conname = 'inventory_products_organization_id_id_key') then
    alter table public.inventory_products add constraint inventory_products_organization_id_id_key unique (organization_id, id);
  end if;
end
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reserves'::regclass and conname = 'reserves_tenant_chantier_fkey') then
    alter table public.reserves add constraint reserves_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reserves'::regclass and conname = 'reserves_tenant_plan_fkey') then
    alter table public.reserves add constraint reserves_tenant_plan_fkey
      foreign key (organization_id, plan_id)
      references public.site_plans(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reserves'::regclass and conname = 'reserves_tenant_visite_fkey') then
    alter table public.reserves add constraint reserves_tenant_visite_fkey
      foreign key (organization_id, visite_id)
      references public.visites(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reserves'::regclass and conname = 'reserves_tenant_task_fkey') then
    alter table public.reserves add constraint reserves_tenant_task_fkey
      foreign key (organization_id, linked_task_id)
      references public.tasks(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.reserves'::regclass and conname = 'reserves_tenant_lot_fkey') then
    alter table public.reserves add constraint reserves_tenant_lot_fkey
      foreign key (organization_id, lot_id)
      references public.lots(organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_tenant_chantier_fkey') then
    alter table public.tasks add constraint tasks_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tasks'::regclass and conname = 'tasks_tenant_reserve_fkey') then
    alter table public.tasks add constraint tasks_tenant_reserve_fkey
      foreign key (organization_id, reserve_id)
      references public.reserves(organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.photos'::regclass and conname = 'photos_tenant_reserve_fkey') then
    alter table public.photos add constraint photos_tenant_reserve_fkey
      foreign key (organization_id, reserve_id)
      references public.reserves(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.documents'::regclass and conname = 'documents_tenant_chantier_fkey') then
    alter table public.documents add constraint documents_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.messages'::regclass and conname = 'messages_tenant_channel_fkey') then
    alter table public.messages add constraint messages_tenant_channel_fkey
      foreign key (organization_id, channel_id)
      references public.channels(organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.site_plans'::regclass and conname = 'site_plans_tenant_chantier_fkey') then
    alter table public.site_plans add constraint site_plans_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.site_plans'::regclass and conname = 'site_plans_tenant_parent_fkey') then
    alter table public.site_plans add constraint site_plans_tenant_parent_fkey
      foreign key (organization_id, parent_plan_id)
      references public.site_plans(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.site_plans'::regclass and conname = 'site_plans_tenant_replacement_fkey') then
    alter table public.site_plans add constraint site_plans_tenant_replacement_fkey
      foreign key (organization_id, replaced_by_plan_id)
      references public.site_plans(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.visites'::regclass and conname = 'visites_tenant_chantier_fkey') then
    alter table public.visites add constraint visites_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.visites'::regclass and conname = 'visites_tenant_default_plan_fkey') then
    alter table public.visites add constraint visites_tenant_default_plan_fkey
      foreign key (organization_id, default_plan_id)
      references public.site_plans(organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.lots'::regclass and conname = 'lots_tenant_chantier_fkey') then
    alter table public.lots add constraint lots_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.lots'::regclass and conname = 'lots_tenant_company_fkey') then
    alter table public.lots add constraint lots_tenant_company_fkey
      foreign key (organization_id, company_id)
      references public.companies(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.oprs'::regclass and conname = 'oprs_tenant_chantier_fkey') then
    alter table public.oprs add constraint oprs_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.checklists'::regclass and conname = 'checklists_tenant_chantier_fkey') then
    alter table public.checklists add constraint checklists_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.incidents'::regclass and conname = 'incidents_tenant_chantier_fkey') then
    alter table public.incidents add constraint incidents_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.journal_entries'::regclass and conname = 'journal_entries_tenant_chantier_fkey') then
    alter table public.journal_entries add constraint journal_entries_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_products'::regclass and conname = 'inventory_products_tenant_chantier_fkey') then
    alter table public.inventory_products add constraint inventory_products_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_movements'::regclass and conname = 'inventory_movements_tenant_chantier_fkey') then
    alter table public.inventory_movements add constraint inventory_movements_tenant_chantier_fkey
      foreign key (organization_id, chantier_id)
      references public.chantiers(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_movements'::regclass and conname = 'inventory_movements_tenant_product_fkey') then
    alter table public.inventory_movements add constraint inventory_movements_tenant_product_fkey
      foreign key (organization_id, product_id)
      references public.inventory_products(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_movements'::regclass and conname = 'inventory_movements_tenant_company_fkey') then
    alter table public.inventory_movements add constraint inventory_movements_tenant_company_fkey
      foreign key (organization_id, company_id)
      references public.companies(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.time_entries'::regclass and conname = 'time_entries_tenant_company_fkey') then
    alter table public.time_entries add constraint time_entries_tenant_company_fkey
      foreign key (organization_id, company_id)
      references public.companies(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.time_entries'::regclass and conname = 'time_entries_tenant_task_fkey') then
    alter table public.time_entries add constraint time_entries_tenant_task_fkey
      foreign key (organization_id, task_id)
      references public.tasks(organization_id, id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.notification_preferences'::regclass and conname = 'notification_preferences_membership_fkey') then
    alter table public.notification_preferences add constraint notification_preferences_membership_fkey
      foreign key (organization_id, user_id)
      references public.organization_memberships(organization_id, user_id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.push_tokens'::regclass and conname = 'push_tokens_membership_fkey') then
    alter table public.push_tokens add constraint push_tokens_membership_fkey
      foreign key (organization_id, user_id)
      references public.organization_memberships(organization_id, user_id) not valid;
  end if;
end
$$;

-- Messages use immutable auth UUIDs for ownership. Display names remain only
-- presentation data so changing a profile name cannot grant access.
alter table public.messages
  add column if not exists sender_id uuid references auth.users(id) on delete set null;

with unique_names as (
  select om.organization_id, lower(btrim(p.name)) as normalized_name,
         (array_agg(p.id order by p.id::text))[1] as user_id
  from public.organization_memberships om
  join public.profiles p on p.id = om.user_id
  where om.status = 'active'
  group by om.organization_id, lower(btrim(p.name))
  having count(*) = 1
)
update public.messages m
set sender_id = un.user_id
from unique_names un
where m.sender_id is null
  and m.organization_id = un.organization_id
  and lower(btrim(m.sender)) = un.normalized_name;

create table if not exists public.channel_members (
  organization_id uuid not null,
  channel_id text not null,
  user_id uuid not null,
  status text not null default 'active' check (status in ('active', 'removed')),
  joined_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null,
  primary key (organization_id, channel_id, user_id),
  constraint channel_members_channel_tenant_fkey
    foreign key (organization_id, channel_id)
    references public.channels(organization_id, id) on delete cascade,
  constraint channel_members_membership_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade
);

alter table public.channel_members enable row level security;
drop policy if exists channel_members_tenant_select on public.channel_members;
create policy channel_members_tenant_select
  on public.channel_members for select to authenticated
  using (
    public.auth_is_platform_admin()
    or (
      organization_id = public.auth_user_org()
      and public.auth_has_active_membership(organization_id)
    )
  );
revoke all on public.channel_members from public, anon, authenticated;
grant select on public.channel_members to authenticated;

insert into public.channel_members(organization_id, channel_id, user_id, added_by)
select distinct c.organization_id, c.id, p.id, null::uuid
from public.channels c
cross join lateral jsonb_array_elements_text(coalesce(c.members, '[]'::jsonb)) member(name)
join public.profiles p on lower(btrim(p.name)) = lower(btrim(member.name))
join public.organization_memberships om
  on om.user_id = p.id
 and om.organization_id = c.organization_id
 and om.status = 'active'
where c.organization_id is not null
on conflict (organization_id, channel_id, user_id) do nothing;

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
    if not exists (
      select 1 from public.channels c
      where c.id = new.channel_id and c.organization_id = v_org
    ) then
      raise exception 'Channel is outside the active organization' using errcode = '42501';
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
    if old.sender_id is distinct from auth.uid()
       and public.auth_user_role() not in ('super_admin', 'admin') then
      raise exception 'Message ownership required' using errcode = '42501';
    end if;
    new.sender_id := old.sender_id;
    new.sender := old.sender;
    new.organization_id := old.organization_id;
  end if;
  return new;
end;
$$;

drop trigger if exists message_actor_identity on public.messages;
create trigger message_actor_identity
before insert or update on public.messages
for each row execute function private.enforce_message_actor();

drop policy if exists messages_actor_update_restrictive on public.messages;
create policy messages_actor_update_restrictive
  on public.messages as restrictive for update to authenticated
  using (
    public.auth_is_platform_admin()
    or (
      organization_id = public.auth_user_org()
      and (sender_id = auth.uid() or public.auth_user_role() = 'admin')
    )
  )
  with check (
    public.auth_is_platform_admin()
    or (
      organization_id = public.auth_user_org()
      and (sender_id = auth.uid() or public.auth_user_role() = 'admin')
    )
  );

drop policy if exists messages_actor_delete_restrictive on public.messages;
create policy messages_actor_delete_restrictive
  on public.messages as restrictive for delete to authenticated
  using (
    public.auth_is_platform_admin()
    or (
      organization_id = public.auth_user_org()
      and (sender_id = auth.uid() or public.auth_user_role() = 'admin')
    )
  );

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
  join public.channels c
    on c.organization_id = m.organization_id and c.id = m.channel_id
  where m.id = p_message_id
    and m.organization_id = v_org
  for update of m;
  if not found then
    raise exception 'Message not found in active organization' using errcode = 'P0002';
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
    and exists (
      select 1 from public.channels c
      where c.id = m.channel_id and c.organization_id = v_org
    );
end;
$$;

revoke all on function public.toggle_message_reaction(text, text, text) from public, anon;
revoke all on function public.mark_messages_read_by(text[], text) from public, anon;
grant execute on function public.toggle_message_reaction(text, text, text) to authenticated;
grant execute on function public.mark_messages_read_by(text[], text) to authenticated;

create or replace function public.send_announcement_message(
  p_channel_id text,
  p_content text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text;
  v_channel_org uuid;
begin
  if not public.auth_is_platform_admin() then
    raise exception 'Platform administrator required' using errcode = '42501';
  end if;
  if nullif(btrim(p_content), '') is null then
    raise exception 'Message content is required' using errcode = '22023';
  end if;
  select p.name into v_sender from public.profiles p where p.id = auth.uid();
  select c.organization_id into v_channel_org
  from public.channels c where c.id = p_channel_id;
  if v_channel_org is null then
    raise exception 'Channel not found' using errcode = 'P0002';
  end if;
  perform set_config('app.trusted_tenant_org', v_channel_org::text, true);
  insert into public.messages(
    id, channel_id, sender, sender_id, content, timestamp, created_at,
    organization_id, type, reactions, is_pinned, read_by
  ) values (
    gen_random_uuid()::text, p_channel_id, v_sender, auth.uid(), p_content,
    now()::text, now(), v_channel_org, 'notification', '{}'::jsonb, false,
    jsonb_build_array(v_sender)
  );
end;
$$;

revoke all on function public.send_announcement_message(text, text) from public, anon;
grant execute on function public.send_announcement_message(text, text) to authenticated;

-- reserve_status_events now carries the same tenant key as its parent.
alter table public.reserve_status_events
  add column if not exists organization_id uuid references public.organizations(id);

update public.reserve_status_events e
set organization_id = r.organization_id
from public.reserves r
where e.organization_id is null and e.reserve_id = r.id;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.reserve_status_events'::regclass and conname = 'reserve_status_events_tenant_reserve_fkey') then
    alter table public.reserve_status_events add constraint reserve_status_events_tenant_reserve_fkey
      foreign key (organization_id, reserve_id)
      references public.reserves(organization_id, id) not valid;
  end if;
end
$$;

drop trigger if exists tenant_scope_guard on public.reserve_status_events;
create trigger tenant_scope_guard
before insert or update on public.reserve_status_events
for each row execute function private.enforce_actor_tenant();

alter table public.reserve_status_events enable row level security;
drop policy if exists tenant_boundary_restrictive on public.reserve_status_events;
create policy tenant_boundary_restrictive
  on public.reserve_status_events as restrictive for all to authenticated
  using (
    public.auth_is_platform_admin()
    or (organization_id is not null and organization_id = public.auth_user_org())
  )
  with check (
    public.auth_is_platform_admin()
    or (organization_id is not null and organization_id = public.auth_user_org())
  );

drop policy if exists tenant_boundary_anonymous_deny on public.reserve_status_events;
create policy tenant_boundary_anonymous_deny
  on public.reserve_status_events as restrictive for all to anon
  using (false)
  with check (false);

notify pgrst, 'reload schema';
