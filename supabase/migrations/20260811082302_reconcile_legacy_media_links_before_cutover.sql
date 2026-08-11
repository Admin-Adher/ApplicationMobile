-- Preserve registry links when a row that still contains a BuildTrack legacy
-- URL is edited. The original trigger rebuilt links only for btmedia:// refs,
-- which could incorrectly orphan a still-current legacy object.

create or replace function private.register_legacy_media(
  p_organization_id uuid,
  p_url text,
  p_resource_type text,
  p_resource_id text,
  p_slot text default 'default'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parts record;
  v_asset_id uuid;
  v_asset_org uuid;
begin
  if p_organization_id is null or nullif(btrim(p_url), '') is null then
    return null;
  end if;
  select * into v_parts from private.media_url_parts(p_url);
  if v_parts.provider is null or v_parts.object_key is null then
    return null;
  end if;

  insert into public.tenant_media_objects(
    organization_id, provider, bucket, object_key, status, legacy_url,
    original_filename, completed_at
  ) values (
    p_organization_id,
    v_parts.provider,
    v_parts.bucket,
    v_parts.object_key,
    'legacy',
    split_part(p_url, '?', 1),
    regexp_replace(v_parts.object_key, '^.*/', ''),
    now()
  )
  on conflict (provider, bucket, object_key) do update
  set legacy_url = coalesce(public.tenant_media_objects.legacy_url, excluded.legacy_url),
      status = case
        when public.tenant_media_objects.status = 'delete_pending' then 'legacy'
        else public.tenant_media_objects.status
      end,
      deleted_at = case
        when public.tenant_media_objects.status = 'delete_pending' then null
        else public.tenant_media_objects.deleted_at
      end,
      completed_at = coalesce(public.tenant_media_objects.completed_at, now()),
      updated_at = now()
  returning id, organization_id into v_asset_id, v_asset_org;

  if v_asset_org is distinct from p_organization_id then
    raise exception 'Legacy media object is referenced by more than one organization'
      using errcode = '23505';
  end if;

  if exists (
    select 1 from public.tenant_media_objects a
    where a.id = v_asset_id and a.status = 'deleted'
  ) then
    return v_asset_id;
  end if;

  insert into public.tenant_media_links(
    organization_id, asset_id, resource_type, resource_id, slot
  ) values (
    p_organization_id, v_asset_id, p_resource_type, p_resource_id,
    coalesce(nullif(p_slot, ''), 'default')
  )
  on conflict (asset_id, resource_type, resource_id, slot) do nothing;
  return v_asset_id;
end;
$$;

revoke all on function private.register_legacy_media(uuid, text, text, text, text)
  from public, anon, authenticated;

create or replace function private.media_text_values_in_json(p_value jsonb)
returns setof text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if p_value is null then return; end if;
  case jsonb_typeof(p_value)
    when 'string' then
      return next p_value #>> '{}';
    when 'array' then
      for v_item in select value from jsonb_array_elements(p_value) loop
        return query select * from private.media_text_values_in_json(v_item);
      end loop;
    when 'object' then
      for v_item in select value from jsonb_each(p_value) loop
        return query select * from private.media_text_values_in_json(v_item);
      end loop;
    else
      return;
  end case;
end;
$$;

revoke all on function private.media_text_values_in_json(jsonb)
  from public, anon, authenticated;

create or replace function private.sync_media_resource_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_org uuid;
  v_resource_id text;
  v_asset_id uuid;
  v_legacy_ref text;
  v_previous_asset_ids uuid[] := '{}'::uuid[];
begin
  if tg_op = 'DELETE' then
    v_org := old.organization_id;
    v_resource_id := to_jsonb(old) ->> 'id';
    select coalesce(array_agg(l.asset_id), '{}'::uuid[]) into v_previous_asset_ids
    from public.tenant_media_links l
    where l.organization_id = v_org
      and l.resource_type = tg_table_name
      and l.resource_id = v_resource_id;
    delete from public.tenant_media_links l
    where l.organization_id = v_org
      and l.resource_type = tg_table_name
      and l.resource_id = v_resource_id;
    update public.tenant_media_objects a
    set status = 'delete_pending', updated_at = now()
    where a.id = any(v_previous_asset_ids)
      and a.status in ('ready', 'legacy')
      and not exists (
        select 1 from public.tenant_media_links remaining
        where remaining.asset_id = a.id
      );
    return old;
  end if;

  v_payload := to_jsonb(new);
  v_org := new.organization_id;
  v_resource_id := v_payload ->> 'id';

  select coalesce(array_agg(l.asset_id), '{}'::uuid[]) into v_previous_asset_ids
  from public.tenant_media_links l
  where l.organization_id = v_org
    and l.resource_type = tg_table_name
    and l.resource_id = v_resource_id;
  delete from public.tenant_media_links l
  where l.organization_id = v_org
    and l.resource_type = tg_table_name
    and l.resource_id = v_resource_id;

  for v_asset_id in
    select distinct x.asset_id
    from private.media_refs_in_json(v_payload) as x(asset_id)
  loop
    if not exists (
      select 1
      from public.tenant_media_objects a
      where a.id = v_asset_id
        and a.organization_id = v_org
        and a.status in ('ready', 'legacy')
    ) then
      raise exception 'Media asset is outside the resource organization or unavailable'
        using errcode = '23503';
    end if;
    insert into public.tenant_media_links(
      organization_id, asset_id, resource_type, resource_id, slot, created_by
    ) values (
      v_org, v_asset_id, tg_table_name, v_resource_id, 'auto', auth.uid()
    )
    on conflict (asset_id, resource_type, resource_id, slot) do nothing;
  end loop;

  for v_legacy_ref in
    select distinct text_ref.media_ref
    from private.media_text_values_in_json(v_payload) as text_ref(media_ref)
    left join lateral private.media_url_parts(text_ref.media_ref) parts on true
    where parts.provider is not null
  loop
    perform private.register_legacy_media(
      v_org,
      v_legacy_ref,
      tg_table_name,
      v_resource_id,
      'auto'
    );
  end loop;

  update public.tenant_media_objects a
  set status = 'delete_pending', updated_at = now()
  where a.id = any(v_previous_asset_ids)
    and a.status in ('ready', 'legacy')
    and not exists (
      select 1 from public.tenant_media_links remaining
      where remaining.asset_id = a.id
    );
  return new;
end;
$$;

revoke all on function private.sync_media_resource_links()
  from public, anon, authenticated;

-- Reconcile every currently referenced legacy URL. This both revives objects
-- that were only queued for deletion and recreates exact resource links.
select private.register_legacy_media(
  r.organization_id,
  r.media_ref,
  r.resource_type,
  r.resource_id,
  r.slot
)
from private.current_media_references() r
left join lateral private.media_url_parts(r.media_ref) parts on true
where r.organization_id is not null
  and parts.provider is not null;

notify pgrst, 'reload schema';
