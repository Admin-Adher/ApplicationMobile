-- Local-first reserve slice:
-- - server-owned row versions for conditional updates
-- - operation-level idempotency with request_hash
-- - append-only status events folded into reserves.status for existing screens

alter table public.reserves
  add column if not exists version bigint not null default 1;

do $$
begin
  if to_regprocedure('public.auth_user_role()') is null then
    raise exception 'Missing required helper: public.auth_user_role()';
  end if;
  if to_regprocedure('public.auth_user_org()') is null then
    raise exception 'Missing required helper: public.auth_user_org()';
  end if;
  if to_regprocedure('public.auth_user_has_permission(text)') is null then
    raise exception 'Missing required helper: public.auth_user_has_permission(text)';
  end if;
end $$;

create table if not exists public.reserve_outbox_operations (
  operation_id text primary key,
  request_hash text not null,
  actor_id uuid,
  entity_type text not null,
  entity_id text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reserve_outbox_actor
  on public.reserve_outbox_operations (actor_id, created_at desc);

alter table public.reserve_outbox_operations enable row level security;

drop policy if exists "Reserve operation results visible to actor" on public.reserve_outbox_operations;
create policy "Reserve operation results visible to actor"
  on public.reserve_outbox_operations for select to authenticated
  using (
    actor_id = auth.uid()
    or public.auth_user_role() = 'super_admin'
  );

revoke all on public.reserve_outbox_operations from public, anon, authenticated;

create index if not exists idx_reserve_outbox_created_at
  on public.reserve_outbox_operations (created_at);

create table if not exists public.reserve_status_events (
  id text primary key,
  reserve_id text not null references public.reserves(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid,
  actor_name text,
  reason text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  operation_id text,
  request_hash text,
  closed_at text,
  closed_by text,
  history_entry jsonb
);

create index if not exists idx_reserve_status_events_reserve_order
  on public.reserve_status_events (reserve_id, occurred_at desc, created_at desc);

alter table public.reserve_status_events enable row level security;

drop policy if exists "Reserve status events visible by reserve access" on public.reserve_status_events;
create policy "Reserve status events visible by reserve access"
  on public.reserve_status_events for select to authenticated
  using (
    public.auth_user_role() = 'super_admin'
    or exists (
      select 1
      from public.reserves r
      left join public.chantiers c on c.id = r.chantier_id
      where r.id = reserve_status_events.reserve_id
        and coalesce(r.organization_id, c.organization_id) = public.auth_user_org()
    )
  );

grant select on public.reserve_status_events to authenticated;

create or replace function public.bump_reserve_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then
    if new.version is null or new.version = old.version then
      new.version := coalesce(old.version, 0) + 1;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bump_reserve_version on public.reserves;
create trigger trg_bump_reserve_version
  before update on public.reserves
  for each row
  execute function public.bump_reserve_version();

revoke all on function public.bump_reserve_version() from public, anon, authenticated;

create or replace function public.remember_reserve_operation(
  p_operation_id text,
  p_request_hash text,
  p_actor_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reserve_outbox_operations (
    operation_id, request_hash, actor_id, entity_type, entity_id, result
  )
  values (
    p_operation_id, p_request_hash, p_actor_id, p_entity_type, p_entity_id, p_result
  )
  on conflict (operation_id) do update
    set updated_at = now(),
        result = excluded.result
    where public.reserve_outbox_operations.request_hash = excluded.request_hash
      and public.reserve_outbox_operations.actor_id is not distinct from excluded.actor_id;

  return p_result;
end;
$$;

revoke all on function public.remember_reserve_operation(text, text, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function public.purge_old_reserve_outbox_operations(
  p_older_than interval default interval '14 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.reserve_outbox_operations
  where created_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_old_reserve_outbox_operations(interval) from public, anon, authenticated;
grant execute on function public.purge_old_reserve_outbox_operations(interval) to service_role;

create or replace function public.merge_jsonb_array_by_id(
  p_base jsonb,
  p_incoming jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb := coalesce(p_base, '[]'::jsonb);
  v_item jsonb;
  v_id text;
begin
  if jsonb_typeof(p_incoming) <> 'array' then
    return v_result;
  end if;

  for v_item in select * from jsonb_array_elements(p_incoming)
  loop
    v_id := nullif(v_item->>'id', '');
    if v_id is null or not exists (
      select 1
      from jsonb_array_elements(v_result) as existing(item)
      where existing.item->>'id' = v_id
    ) then
      v_result := v_result || jsonb_build_array(v_item);
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function public.merge_jsonb_array_by_id(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.recompute_reserve_status(p_reserve_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest public.reserve_status_events%rowtype;
begin
  select *
    into v_latest
  from public.reserve_status_events
  where reserve_id = p_reserve_id
  order by occurred_at desc, created_at desc, id desc
  limit 1;

  if not found then
    return;
  end if;

  update public.reserves
  set status = v_latest.to_status,
      closed_at = case
        when v_latest.to_status = 'closed'
          then coalesce(v_latest.closed_at, v_latest.occurred_at::date::text)
        else null
      end,
      closed_by = case
        when v_latest.to_status = 'closed' then v_latest.closed_by
        else null
      end
  where id = p_reserve_id;
end;
$$;

revoke all on function public.recompute_reserve_status(text) from public, anon, authenticated;

create or replace function public.trg_recompute_reserve_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_reserve_status(coalesce(new.reserve_id, old.reserve_id));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_recompute_reserve_status on public.reserve_status_events;
create trigger trg_recompute_reserve_status
  after insert or update or delete on public.reserve_status_events
  for each row
  execute function public.trg_recompute_reserve_status();

revoke all on function public.trg_recompute_reserve_status() from public, anon, authenticated;

create or replace function public.apply_reserve_patch(
  p_operation_id text,
  p_request_hash text,
  p_reserve_id text,
  p_base_version bigint,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.reserve_outbox_operations%rowtype;
  v_reserve public.reserves%rowtype;
  v_org uuid;
  v_role text;
  v_can_edit boolean := false;
  v_result jsonb;
  v_version bigint;
  v_bad_field text;
  v_plan_x integer;
  v_plan_y integer;
  v_archived_at timestamptz;
  v_deleted_at timestamptz;
begin
  select *
    into v_existing
  from public.reserve_outbox_operations
  where operation_id = p_operation_id
  for update;

  if found then
    if v_existing.actor_id is not distinct from v_actor
       and v_existing.request_hash = p_request_hash then
      return v_existing.result;
    end if;
    return jsonb_build_object(
      'status', 'duplicate_operation_mismatch',
      'message', 'Operation id already exists with a different actor or request hash'
    );
  end if;

  if v_actor is null then
    v_result := jsonb_build_object('status', 'forbidden', 'message', 'Missing authenticated user');
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    v_result := jsonb_build_object('status', 'invalid_payload', 'message', 'Patch must be a JSON object');
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
  end if;

  select *
    into v_reserve
  from public.reserves
  where id = p_reserve_id
  for update;

  if not found then
    v_result := jsonb_build_object('status', 'not_found', 'reserve_id', p_reserve_id);
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
  end if;

  v_org := v_reserve.organization_id;
  if v_org is null and v_reserve.chantier_id is not null then
    select c.organization_id
      into v_org
    from public.chantiers c
    where c.id = v_reserve.chantier_id
    limit 1;
  end if;

  v_role := public.auth_user_role();
  v_can_edit := v_role = 'super_admin'
    or (v_org = public.auth_user_org() and public.auth_user_has_permission('canEdit'));

  if p_patch ? 'deleted_at' and nullif(p_patch->>'deleted_at', '') is not null then
    v_can_edit := v_role = 'super_admin'
      or (v_org = public.auth_user_org() and public.auth_user_has_permission('canDelete'));
  end if;

  if not v_can_edit then
    v_result := jsonb_build_object('status', 'forbidden', 'reserve_id', p_reserve_id);
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
  end if;

  if v_reserve.deleted_at is not null
     and not (p_patch ? 'deleted_at' and p_patch->>'deleted_at' is null) then
    v_result := jsonb_build_object('status', 'deleted', 'reserve_id', p_reserve_id);
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
  end if;

  if p_base_version is not null and v_reserve.version <> p_base_version then
    v_result := jsonb_build_object(
      'status', 'version_conflict',
      'reserve_id', p_reserve_id,
      'current_version', v_reserve.version
    );
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
  end if;

  select patch_key.key
    into v_bad_field
  from jsonb_object_keys(p_patch) as patch_key(key)
  where patch_key.key = any (array[
    'status',
    'closed_at',
    'closed_by',
    'comments',
    'photos',
    'photo_uri',
    'photo_annotations',
    'company_signatures'
  ])
  limit 1;

  if v_bad_field is not null then
    v_result := jsonb_build_object(
      'status', 'invalid_payload',
      'reserve_id', p_reserve_id,
      'message', 'Field must be updated through its dedicated mutation',
      'field', v_bad_field
    );
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
  end if;

  if p_patch ? 'plan_x' and nullif(p_patch->>'plan_x', '') is not null then
    if not ((p_patch->>'plan_x') ~ '^-?[0-9]+$') then
      v_result := jsonb_build_object('status', 'invalid_payload', 'reserve_id', p_reserve_id, 'field', 'plan_x');
      return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
    end if;
    v_plan_x := (p_patch->>'plan_x')::integer;
  end if;

  if p_patch ? 'plan_y' and nullif(p_patch->>'plan_y', '') is not null then
    if not ((p_patch->>'plan_y') ~ '^-?[0-9]+$') then
      v_result := jsonb_build_object('status', 'invalid_payload', 'reserve_id', p_reserve_id, 'field', 'plan_y');
      return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
    end if;
    v_plan_y := (p_patch->>'plan_y')::integer;
  end if;

  if p_patch ? 'archived_at' and nullif(p_patch->>'archived_at', '') is not null then
    begin
      v_archived_at := (p_patch->>'archived_at')::timestamptz;
    exception when others then
      v_result := jsonb_build_object('status', 'invalid_payload', 'reserve_id', p_reserve_id, 'field', 'archived_at');
      return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
    end;
  end if;

  if p_patch ? 'deleted_at' and nullif(p_patch->>'deleted_at', '') is not null then
    begin
      v_deleted_at := (p_patch->>'deleted_at')::timestamptz;
    exception when others then
      v_result := jsonb_build_object('status', 'invalid_payload', 'reserve_id', p_reserve_id, 'field', 'deleted_at');
      return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
    end;
  end if;

  perform set_config('app.audit_reason', 'apply_reserve_patch', true);

  update public.reserves
  set title = case when p_patch ? 'title' then coalesce(p_patch->>'title', '') else title end,
      description = case when p_patch ? 'description' then coalesce(p_patch->>'description', '') else description end,
      building = case when p_patch ? 'building' then coalesce(p_patch->>'building', '') else building end,
      zone = case when p_patch ? 'zone' then coalesce(p_patch->>'zone', '') else zone end,
      level = case when p_patch ? 'level' then coalesce(p_patch->>'level', '') else level end,
      company = case when p_patch ? 'company' then coalesce(p_patch->>'company', '') else company end,
      companies = case
        when p_patch ? 'companies' and jsonb_typeof(p_patch->'companies') = 'array' then p_patch->'companies'
        when p_patch ? 'companies' then null
        else companies
      end,
      priority = case when p_patch ? 'priority' then coalesce(p_patch->>'priority', priority) else priority end,
      deadline = case when p_patch ? 'deadline' then nullif(p_patch->>'deadline', '') else deadline end,
      history = case
        when p_patch ? 'history' and jsonb_typeof(p_patch->'history') = 'array'
          then public.merge_jsonb_array_by_id(v_reserve.history, p_patch->'history')
        else history
      end,
      plan_x = case
        when p_patch ? 'plan_x' and nullif(p_patch->>'plan_x', '') is not null then v_plan_x
        when p_patch ? 'plan_x' then null
        else plan_x
      end,
      plan_y = case
        when p_patch ? 'plan_y' and nullif(p_patch->>'plan_y', '') is not null then v_plan_y
        when p_patch ? 'plan_y' then null
        else plan_y
      end,
      lot_id = case when p_patch ? 'lot_id' then nullif(p_patch->>'lot_id', '') else lot_id end,
      kind = case when p_patch ? 'kind' then nullif(p_patch->>'kind', '') else kind end,
      chantier_id = case when p_patch ? 'chantier_id' then nullif(p_patch->>'chantier_id', '') else chantier_id end,
      plan_id = case when p_patch ? 'plan_id' then nullif(p_patch->>'plan_id', '') else plan_id end,
      building_id = case when p_patch ? 'building_id' then nullif(p_patch->>'building_id', '') else building_id end,
      level_id = case when p_patch ? 'level_id' then nullif(p_patch->>'level_id', '') else level_id end,
      visite_id = case when p_patch ? 'visite_id' then nullif(p_patch->>'visite_id', '') else visite_id end,
      linked_task_id = case when p_patch ? 'linked_task_id' then nullif(p_patch->>'linked_task_id', '') else linked_task_id end,
      enterprise_signature = case when p_patch ? 'enterprise_signature' then nullif(p_patch->>'enterprise_signature', '') else enterprise_signature end,
      enterprise_signataire = case when p_patch ? 'enterprise_signataire' then nullif(p_patch->>'enterprise_signataire', '') else enterprise_signataire end,
      enterprise_acknowledged_at = case when p_patch ? 'enterprise_acknowledged_at' then nullif(p_patch->>'enterprise_acknowledged_at', '') else enterprise_acknowledged_at end,
      archived_at = case
        when p_patch ? 'archived_at' and nullif(p_patch->>'archived_at', '') is not null then v_archived_at
        when p_patch ? 'archived_at' then null
        else archived_at
      end,
      archived_by = case when p_patch ? 'archived_by' then p_patch->>'archived_by' else archived_by end,
      deleted_at = case
        when p_patch ? 'deleted_at' and nullif(p_patch->>'deleted_at', '') is not null then v_deleted_at
        when p_patch ? 'deleted_at' then null
        else deleted_at
      end,
      deleted_by = case when p_patch ? 'deleted_by' then p_patch->>'deleted_by' else deleted_by end
  where id = p_reserve_id
  returning version into v_version;

  v_result := jsonb_build_object(
    'status', 'ok',
    'reserve_id', p_reserve_id,
    'version', v_version
  );
  return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', p_reserve_id, v_result);
end;
$$;

revoke all on function public.apply_reserve_patch(text, text, text, bigint, jsonb) from public, anon;
grant execute on function public.apply_reserve_patch(text, text, text, bigint, jsonb) to authenticated;

create or replace function public.append_reserve_status_event(
  p_operation_id text,
  p_request_hash text,
  p_event jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_existing public.reserve_outbox_operations%rowtype;
  v_reserve public.reserves%rowtype;
  v_org uuid;
  v_role text;
  v_reserve_id text := nullif(p_event->>'reserve_id', '');
  v_event_id text := nullif(p_event->>'id', '');
  v_to_status text := nullif(p_event->>'to_status', '');
  v_occurred_at timestamptz;
  v_history_id text;
  v_result jsonb;
  v_version bigint;
begin
  select *
    into v_existing
  from public.reserve_outbox_operations
  where operation_id = p_operation_id
  for update;

  if found then
    if v_existing.actor_id is not distinct from v_actor
       and v_existing.request_hash = p_request_hash then
      return v_existing.result;
    end if;
    return jsonb_build_object(
      'status', 'duplicate_operation_mismatch',
      'message', 'Operation id already exists with a different actor or request hash'
    );
  end if;

  if v_actor is null then
    v_result := jsonb_build_object('status', 'forbidden', 'message', 'Missing authenticated user');
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', coalesce(v_reserve_id, ''), v_result);
  end if;

  if p_event is null or jsonb_typeof(p_event) <> 'object' then
    v_result := jsonb_build_object('status', 'invalid_payload', 'message', 'Status event must be a JSON object');
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', coalesce(v_reserve_id, ''), v_result);
  end if;

  if v_reserve_id is null or v_event_id is null or v_to_status is null then
    v_result := jsonb_build_object('status', 'not_found', 'message', 'Malformed status event');
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', coalesce(v_reserve_id, ''), v_result);
  end if;

  select *
    into v_reserve
  from public.reserves
  where id = v_reserve_id
  for update;

  if not found then
    v_result := jsonb_build_object('status', 'not_found', 'reserve_id', v_reserve_id);
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', v_reserve_id, v_result);
  end if;

  v_org := v_reserve.organization_id;
  if v_org is null and v_reserve.chantier_id is not null then
    select c.organization_id
      into v_org
    from public.chantiers c
    where c.id = v_reserve.chantier_id
    limit 1;
  end if;

  v_role := public.auth_user_role();
  if not (
    v_role = 'super_admin'
    or (v_org = public.auth_user_org() and public.auth_user_has_permission('canEdit'))
  ) then
    v_result := jsonb_build_object('status', 'forbidden', 'reserve_id', v_reserve_id);
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', v_reserve_id, v_result);
  end if;

  if v_reserve.deleted_at is not null then
    v_result := jsonb_build_object('status', 'deleted', 'reserve_id', v_reserve_id);
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', v_reserve_id, v_result);
  end if;

  begin
    v_occurred_at := least(coalesce(nullif(p_event->>'occurred_at', '')::timestamptz, now()), now());
  exception when others then
    v_result := jsonb_build_object('status', 'invalid_payload', 'reserve_id', v_reserve_id, 'field', 'occurred_at');
    return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', v_reserve_id, v_result);
  end;

  perform set_config('app.audit_reason', 'append_reserve_status_event', true);

  insert into public.reserve_status_events (
    id, reserve_id, from_status, to_status, actor_id, actor_name, reason,
    occurred_at, operation_id, request_hash, closed_at, closed_by, history_entry
  )
  values (
    v_event_id,
    v_reserve_id,
    nullif(p_event->>'from_status', ''),
    v_to_status,
    v_actor,
    nullif(p_event->>'actor_name', ''),
    nullif(p_event->>'reason', ''),
    v_occurred_at,
    p_operation_id,
    p_request_hash,
    p_event->>'closed_at',
    p_event->>'closed_by',
    case when jsonb_typeof(p_event->'history_entry') = 'object' then p_event->'history_entry' else null end
  )
  on conflict (id) do nothing;

  if jsonb_typeof(p_event->'history_entry') = 'object' then
    v_history_id := p_event->'history_entry'->>'id';
    update public.reserves
    set history = case
      when v_history_id is not null and exists (
        select 1
        from jsonb_array_elements(coalesce(history, '[]'::jsonb)) as item(value)
        where item.value->>'id' = v_history_id
      )
        then history
      else coalesce(history, '[]'::jsonb) || (p_event->'history_entry')
    end
    where id = v_reserve_id;
  end if;

  select version
    into v_version
  from public.reserves
  where id = v_reserve_id;

  v_result := jsonb_build_object(
    'status', 'ok',
    'reserve_id', v_reserve_id,
    'version', v_version
  );
  return public.remember_reserve_operation(p_operation_id, p_request_hash, v_actor, 'reserve', v_reserve_id, v_result);
end;
$$;

revoke all on function public.append_reserve_status_event(text, text, jsonb) from public, anon;
grant execute on function public.append_reserve_status_event(text, text, jsonb) to authenticated;
