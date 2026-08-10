-- Tenant-owned media registry. Domain tables keep their existing URI columns,
-- but new uploads store btmedia://<uuid>; short-lived delivery URLs are never
-- persisted. Legacy hosted URLs are registered and remain resolvable during
-- the client migration.

create table if not exists public.tenant_media_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('r2', 'supabase')),
  bucket text not null check (bucket in ('photos', 'documents')),
  object_key text not null,
  original_filename text,
  content_type text,
  expected_size bigint check (expected_size is null or expected_size >= 0),
  actual_size bigint check (actual_size is null or actual_size >= 0),
  etag text,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'delete_pending', 'deleted', 'legacy')),
  legacy_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (provider, bucket, object_key),
  unique (organization_id, id)
);

create index if not exists tenant_media_objects_org_status_idx
  on public.tenant_media_objects(organization_id, status, created_at desc);
create index if not exists tenant_media_objects_owner_idx
  on public.tenant_media_objects(owner_user_id, status);
create unique index if not exists tenant_media_objects_legacy_url_key
  on public.tenant_media_objects(legacy_url)
  where legacy_url is not null;

create table if not exists public.tenant_media_links (
  organization_id uuid not null,
  asset_id uuid not null,
  resource_type text not null,
  resource_id text not null,
  slot text not null default 'default',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (asset_id, resource_type, resource_id, slot),
  constraint tenant_media_links_asset_tenant_fkey
    foreign key (organization_id, asset_id)
    references public.tenant_media_objects(organization_id, id)
    on delete cascade
);

create index if not exists tenant_media_links_resource_idx
  on public.tenant_media_links(organization_id, resource_type, resource_id);

alter table public.tenant_media_objects enable row level security;
alter table public.tenant_media_links enable row level security;

drop policy if exists tenant_media_objects_select_tenant on public.tenant_media_objects;
create policy tenant_media_objects_select_tenant
  on public.tenant_media_objects for select to authenticated
  using (
    public.auth_is_platform_admin()
    or organization_id = public.auth_user_org()
  );

drop policy if exists tenant_media_links_select_tenant on public.tenant_media_links;
create policy tenant_media_links_select_tenant
  on public.tenant_media_links for select to authenticated
  using (
    public.auth_is_platform_admin()
    or organization_id = public.auth_user_org()
  );

revoke all on public.tenant_media_objects from public, anon, authenticated;
revoke all on public.tenant_media_links from public, anon, authenticated;
-- Registry metadata is server-only. In particular, an organization member must
-- not be able to enumerate object keys that belong to a resource hidden from
-- that member by the domain RLS (for example a subcontractor-scoped reserve).

create or replace function private.media_url_parts(
  p_url text,
  out provider text,
  out bucket text,
  out object_key text
)
returns record
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_match text[];
  v_clean text := split_part(nullif(btrim(p_url), ''), '?', 1);
begin
  provider := null;
  bucket := null;
  object_key := null;

  if v_clean is null then
    return;
  end if;

  if v_clean ~ '^https://[^/]+[.]supabase[.]co/storage/v1/object/' then
    v_match := regexp_match(
      v_clean,
      '/storage/v1/object/(?:public|sign|authenticated)/([^/]+)/(.+)$'
    );
    if v_match is not null and v_match[1] in ('photos', 'documents') then
      provider := 'supabase';
      bucket := v_match[1];
      object_key := v_match[2];
    end if;
    return;
  end if;

  if v_clean ~ '^https://buildtrack-files[.]customersuccess-kang[.]workers[.]dev/' then
    provider := 'r2';
    object_key := regexp_replace(
      v_clean,
      '^https://buildtrack-files[.]customersuccess-kang[.]workers[.]dev/+',
      ''
    );
    bucket := case
      when object_key like 'documents/%' then 'documents'
      else 'photos'
    end;
  end if;
end;
$$;

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
      updated_at = now()
  returning id, organization_id into v_asset_id, v_asset_org;

  if v_asset_org is distinct from p_organization_id then
    raise exception 'Legacy media object is referenced by more than one organization'
      using errcode = '23505';
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

revoke all on function private.media_url_parts(text) from public, anon, authenticated;
revoke all on function private.register_legacy_media(uuid, text, text, text, text) from public, anon, authenticated;

-- Backfill the currently deployed media-bearing columns. Unknown/external URLs
-- are intentionally ignored; only BuildTrack Supabase and R2 hosts are owned.
select private.register_legacy_media(organization_id, uri, 'photos', id, 'uri')
from public.photos where organization_id is not null and uri ~ '^https?://';
select private.register_legacy_media(organization_id, uri, 'documents', id, 'uri')
from public.documents where organization_id is not null and uri ~ '^https?://';
select private.register_legacy_media(organization_id, uri, 'site_plans', id, 'uri')
from public.site_plans where organization_id is not null and uri ~ '^https?://';
select private.register_legacy_media(organization_id, uri, 'regulatory_docs', id, 'uri')
from public.regulatory_docs where organization_id is not null and uri ~ '^https?://';
select private.register_legacy_media(organization_id, photo_uri, 'incidents', id, 'photo_uri')
from public.incidents where organization_id is not null and photo_uri ~ '^https?://';
select private.register_legacy_media(organization_id, photo_url, 'inventory_products', id, 'photo_url')
from public.inventory_products where organization_id is not null and photo_url ~ '^https?://';
select private.register_legacy_media(organization_id, cover_photo_uri, 'visites', id, 'cover_photo_uri')
from public.visites where organization_id is not null and cover_photo_uri ~ '^https?://';
select private.register_legacy_media(organization_id, attachment_uri, 'messages', id, 'attachment_uri')
from public.messages where organization_id is not null and attachment_uri ~ '^https?://';
select private.register_legacy_media(organization_id, photo_uri, 'reserves', id, 'photo_uri')
from public.reserves where organization_id is not null and photo_uri ~ '^https?://';

select private.register_legacy_media(
  r.organization_id,
  item.value ->> 'uri',
  'reserves',
  r.id,
  'photos'
)
from public.reserves r
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(r.photos) = 'array' then r.photos else '[]'::jsonb end
) item(value)
where r.organization_id is not null
  and item.value ->> 'uri' ~ '^https?://';

create or replace function private.media_refs_in_json(p_value jsonb)
returns setof uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_text text;
begin
  if p_value is null then
    return;
  end if;
  case jsonb_typeof(p_value)
    when 'string' then
      v_text := p_value #>> '{}';
      if v_text ~ '^btmedia://[0-9a-fA-F-]{36}$' then
        return next substring(v_text from 11)::uuid;
      end if;
    when 'array' then
      for v_item in select value from jsonb_array_elements(p_value) loop
        return query select * from private.media_refs_in_json(v_item);
      end loop;
    when 'object' then
      for v_item in select value from jsonb_each(p_value) loop
        return query select * from private.media_refs_in_json(v_item);
      end loop;
    else
      return;
  end case;
end;
$$;

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
      select 1 from public.tenant_media_objects a
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

revoke all on function private.media_refs_in_json(jsonb) from public, anon, authenticated;
revoke all on function private.sync_media_resource_links() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'photos', 'documents', 'site_plans', 'regulatory_docs', 'incidents',
    'inventory_products', 'visites', 'messages', 'reserves'
  ] loop
    execute format('drop trigger if exists sync_media_resource_links on public.%I', v_table);
    execute format(
      'create trigger sync_media_resource_links '
      'after insert or update or delete on public.%I '
      'for each row execute function private.sync_media_resource_links()',
      v_table
    );
  end loop;
end
$$;

create or replace function public.server_begin_media_upload(
  p_user_id uuid,
  p_kind text,
  p_filename text,
  p_content_type text,
  p_expected_size bigint,
  p_provider text
)
returns table (
  asset_id uuid,
  organization_id uuid,
  bucket text,
  object_key text,
  media_ref text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_asset_id uuid := gen_random_uuid();
  v_bucket text;
  v_safe_name text;
  v_max_size bigint;
  v_usage bigint;
begin
  select om.organization_id into v_org
  from public.organization_memberships om
  where om.user_id = p_user_id and om.status = 'active'
  order by om.is_primary desc, om.updated_at desc
  limit 1;
  if v_org is null then
    raise exception 'Active membership required' using errcode = '42501';
  end if;
  if p_provider not in ('r2', 'supabase') then
    raise exception 'Invalid storage provider' using errcode = '22023';
  end if;
  if p_kind = 'photo' then
    v_bucket := 'photos';
    v_max_size := 25 * 1024 * 1024;
    if lower(coalesce(p_content_type, '')) not in (
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'image/heic', 'image/heif'
    ) then
      raise exception 'Unsupported photo content type' using errcode = '22023';
    end if;
  elsif p_kind = 'document' then
    v_bucket := 'documents';
    v_max_size := 100 * 1024 * 1024;
    if lower(coalesce(p_content_type, '')) in (
      'text/html', 'application/xhtml+xml', 'image/svg+xml',
      'application/javascript', 'text/javascript'
    ) then
      raise exception 'Unsafe document content type' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid media kind' using errcode = '22023';
  end if;
  if p_expected_size is null or p_expected_size <= 0 or p_expected_size > v_max_size then
    raise exception 'Invalid or excessive file size' using errcode = '22023';
  end if;

  select coalesce(sum(coalesce(a.actual_size, a.expected_size, 0)), 0)
  into v_usage
  from public.tenant_media_objects a
  where a.organization_id = v_org
    and a.status in ('pending', 'ready', 'legacy');
  if v_usage + p_expected_size > 10::bigint * 1024 * 1024 * 1024 then
    raise exception 'Organization media quota exceeded' using errcode = '53100';
  end if;

  v_safe_name := left(
    regexp_replace(coalesce(nullif(btrim(p_filename), ''), 'file'), '[^a-zA-Z0-9._-]', '_', 'g'),
    120
  );

  insert into public.tenant_media_objects(
    id, organization_id, owner_user_id, provider, bucket, object_key,
    original_filename, content_type, expected_size, status
  ) values (
    v_asset_id,
    v_org,
    p_user_id,
    p_provider,
    v_bucket,
    v_org::text || '/' || p_kind || '/' || v_asset_id::text || '/' || v_safe_name,
    v_safe_name,
    nullif(btrim(p_content_type), ''),
    p_expected_size,
    'pending'
  );

  return query
  select a.id, a.organization_id, a.bucket, a.object_key,
         'btmedia://' || a.id::text
  from public.tenant_media_objects a
  where a.id = v_asset_id;
end;
$$;

create or replace function public.server_complete_media_upload(
  p_user_id uuid,
  p_asset_id uuid,
  p_actual_size bigint,
  p_etag text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset public.tenant_media_objects%rowtype;
begin
  select * into v_asset
  from public.tenant_media_objects a
  where a.id = p_asset_id
  for update;
  if not found or v_asset.owner_user_id is distinct from p_user_id then
    raise exception 'Media asset not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.organization_memberships om
    where om.user_id = p_user_id
      and om.organization_id = v_asset.organization_id
      and om.status = 'active'
  ) then
    raise exception 'Active membership required' using errcode = '42501';
  end if;
  if p_actual_size is null or p_actual_size <= 0
     or (v_asset.expected_size is not null and p_actual_size <> v_asset.expected_size) then
    update public.tenant_media_objects
    set status = 'delete_pending', actual_size = p_actual_size, updated_at = now()
    where id = p_asset_id;
    raise exception 'Uploaded object size does not match the reservation'
      using errcode = '22023';
  end if;
  update public.tenant_media_objects
  set status = 'ready', actual_size = p_actual_size, etag = nullif(p_etag, ''),
      completed_at = now(), updated_at = now()
  where id = p_asset_id and status = 'pending';
  return found;
end;
$$;

create or replace function public.server_get_media_candidates(
  p_user_id uuid,
  p_refs text[]
)
returns table (
  asset_id uuid,
  organization_id uuid,
  owner_user_id uuid,
  provider text,
  bucket text,
  object_key text,
  content_type text,
  expected_size bigint,
  status text,
  legacy_url text,
  resource_type text,
  resource_id text
)
language sql
security definer
stable
set search_path = ''
as $$
  with principal as (
    select om.organization_id, false as platform
    from public.organization_memberships om
    where om.user_id = p_user_id and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc
    limit 1
  ), platform as (
    select pa.user_id from private.platform_admins pa
    where pa.user_id = p_user_id and pa.status = 'active'
  ), requested as (
    select unnest(coalesce(p_refs, '{}'::text[])) ref
  )
  select a.id, a.organization_id, a.owner_user_id, a.provider, a.bucket,
         a.object_key, a.content_type, a.expected_size, a.status, a.legacy_url,
         l.resource_type, l.resource_id
  from requested r
  join public.tenant_media_objects a
    on r.ref = 'btmedia://' || a.id::text
    or split_part(r.ref, '?', 1) = a.legacy_url
    or regexp_replace(split_part(r.ref, '?', 1), '^/?(photos|documents)/', '', 'i') = a.object_key
  left join public.tenant_media_links l on l.asset_id = a.id
  where a.status in ('pending', 'ready', 'legacy')
    and (
      exists (select 1 from platform)
      or a.organization_id = (select organization_id from principal)
    )
$$;

-- Public reserve links are bearer capabilities. This service-only lookup is
-- deliberately narrower than the authenticated resolver: it can return only
-- assets linked to the exact reserve encoded in the verified HMAC token (or
-- to a photo row belonging to that reserve).
create or replace function public.server_get_public_reserve_media(
  p_reserve_id text,
  p_refs text[]
)
returns table (
  requested_ref text,
  asset_id uuid,
  provider text,
  bucket text,
  object_key text,
  legacy_url text
)
language sql
security definer
stable
set search_path = ''
as $$
  with requested as (
    select distinct unnest(coalesce(p_refs, '{}'::text[])) as ref
  )
  select distinct on (a.id)
         r.ref, a.id, a.provider, a.bucket, a.object_key, a.legacy_url
  from requested r
  join public.tenant_media_objects a
    on r.ref = 'btmedia://' || a.id::text
    or split_part(r.ref, '?', 1) = a.legacy_url
    or regexp_replace(split_part(r.ref, '?', 1), '^/?(photos|documents)/', '', 'i') = a.object_key
  join public.tenant_media_links l on l.asset_id = a.id
  where a.status in ('ready', 'legacy')
    and (
      (l.resource_type = 'reserves' and l.resource_id = p_reserve_id)
      or (
        l.resource_type = 'photos'
        and exists (
          select 1 from public.photos p
          where p.id::text = l.resource_id
            and p.reserve_id::text = p_reserve_id
            and p.organization_id = a.organization_id
        )
      )
    )
  order by a.id, r.ref
$$;

create or replace function public.server_unlink_media_asset(
  p_user_id uuid,
  p_asset_id uuid,
  p_resource_type text,
  p_resource_id text
)
returns table (provider text, bucket text, object_key text, should_delete boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_asset public.tenant_media_objects%rowtype;
begin
  select om.organization_id into v_org
  from public.organization_memberships om
  where om.user_id = p_user_id and om.status = 'active'
  order by om.is_primary desc, om.updated_at desc
  limit 1;
  if exists (
    select 1 from private.platform_admins pa
    where pa.user_id = p_user_id and pa.status = 'active'
  ) then
    select a.organization_id into v_org
    from public.tenant_media_objects a where a.id = p_asset_id;
  end if;
  if v_org is null then
    raise exception 'Active membership required' using errcode = '42501';
  end if;

  select * into v_asset
  from public.tenant_media_objects a
  where a.id = p_asset_id and a.organization_id = v_org
  for update;
  if not found then raise exception 'Media asset not found' using errcode = 'P0002'; end if;

  delete from public.tenant_media_links l
  where l.organization_id = v_org
    and l.asset_id = p_asset_id
    and l.resource_type = p_resource_type
    and l.resource_id = p_resource_id;
  if not found then raise exception 'Media link not found' using errcode = 'P0002'; end if;

  if not exists (select 1 from public.tenant_media_links l where l.asset_id = p_asset_id) then
    update public.tenant_media_objects
    set status = 'delete_pending', updated_at = now()
    where id = p_asset_id;
    return query select v_asset.provider, v_asset.bucket, v_asset.object_key, true;
  else
    return query select v_asset.provider, v_asset.bucket, v_asset.object_key, false;
  end if;
end;
$$;

create or replace function public.server_mark_media_deleted(p_asset_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tenant_media_objects
  set status = 'deleted', deleted_at = now(), updated_at = now()
  where id = p_asset_id and status = 'delete_pending';
  return found;
end;
$$;

create or replace function public.server_claim_media_gc_candidates(p_limit integer default 100)
returns table (asset_id uuid, provider text, bucket text, object_key text)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select a.id
    from public.tenant_media_objects a
    where (
      (a.status = 'delete_pending' and a.updated_at < now() - interval '1 hour')
      or (a.status = 'pending' and a.created_at < now() - interval '24 hours')
      or (a.status = 'ready' and a.completed_at < now() - interval '24 hours')
    )
      and not exists (
        select 1 from public.tenant_media_links l where l.asset_id = a.id
      )
    order by a.updated_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), claimed as (
    update public.tenant_media_objects a
    set status = 'delete_pending', updated_at = now()
    from candidates c
    where a.id = c.id
    returning a.id, a.provider, a.bucket, a.object_key
  )
  select c.id, c.provider, c.bucket, c.object_key from claimed c
$$;

revoke all on function public.server_begin_media_upload(uuid, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function public.server_complete_media_upload(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.server_get_media_candidates(uuid, text[]) from public, anon, authenticated;
revoke all on function public.server_get_public_reserve_media(text, text[]) from public, anon, authenticated;
revoke all on function public.server_unlink_media_asset(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.server_mark_media_deleted(uuid) from public, anon, authenticated;
revoke all on function public.server_claim_media_gc_candidates(integer) from public, anon, authenticated;
grant execute on function public.server_begin_media_upload(uuid, text, text, text, bigint, text) to service_role;
grant execute on function public.server_complete_media_upload(uuid, uuid, bigint, text) to service_role;
grant execute on function public.server_get_media_candidates(uuid, text[]) to service_role;
grant execute on function public.server_get_public_reserve_media(text, text[]) to service_role;
grant execute on function public.server_unlink_media_asset(uuid, uuid, text, text) to service_role;
grant execute on function public.server_mark_media_deleted(uuid) to service_role;
grant execute on function public.server_claim_media_gc_candidates(integer) to service_role;

-- The registry and dual-read resolver are deployed before the privacy cutover.
-- This compatibility flag deliberately starts disabled so an older mobile
-- build can continue using legacy public URLs while the btmedia-aware release
-- is rolled out. The service-only cutover RPC below switches the buckets and
-- restrictive policies atomically after the minimum-version gate is met.
create table if not exists private.runtime_security_flags (
  flag text primary key,
  enabled boolean not null default false,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into private.runtime_security_flags(flag, enabled, details)
values ('private_media_storage', false, '{"phase":"dual_read"}'::jsonb)
on conflict (flag) do nothing;

revoke all on table private.runtime_security_flags from public, anon, authenticated;

create or replace function public.private_media_storage_enforced()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select f.enabled
    from private.runtime_security_flags f
    where f.flag = 'private_media_storage'
  ), false)
$$;

revoke all on function public.private_media_storage_enforced() from public, anon;
grant execute on function public.private_media_storage_enforced() to authenticated, service_role;

create or replace function public.auth_can_upload_registered_media(
  p_bucket text,
  p_object_key text
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_media_objects a
    where a.bucket = p_bucket
      and a.object_key = p_object_key
      and a.organization_id = public.auth_user_org()
      and a.owner_user_id = auth.uid()
      and a.status = 'pending'
  )
$$;

revoke all on function public.auth_can_upload_registered_media(text, text) from public, anon;
grant execute on function public.auth_can_upload_registered_media(text, text) to authenticated, service_role;

drop policy if exists buildtrack_media_registry_boundary on storage.objects;
drop policy if exists buildtrack_media_registry_read_boundary on storage.objects;
drop policy if exists buildtrack_media_registry_insert_boundary on storage.objects;
drop policy if exists buildtrack_media_registry_update_boundary on storage.objects;
drop policy if exists buildtrack_media_registry_delete_boundary on storage.objects;
drop policy if exists buildtrack_media_registry_anonymous_boundary on storage.objects;

-- Once the cutover flag is enabled, reads for BuildTrack buckets are
-- server-signed only. Before that gate this restrictive policy is neutral.
create policy buildtrack_media_registry_read_boundary
  on storage.objects
  as restrictive
  for select
  to authenticated
  using (
    not public.private_media_storage_enforced()
    or bucket_id not in ('photos', 'documents')
  );

-- A client may upload only to a pending object key minted by the server for
-- that exact user and tenant. Completion, replacement and deletion stay
-- server-only so object lifecycle cannot bypass ownership checks.
create policy buildtrack_media_registry_insert_boundary
  on storage.objects
  as restrictive
  for insert
  to authenticated
  with check (
    not public.private_media_storage_enforced()
    or bucket_id not in ('photos', 'documents')
    or public.auth_can_upload_registered_media(storage.objects.bucket_id, storage.objects.name)
  );

create policy buildtrack_media_registry_update_boundary
  on storage.objects
  as restrictive
  for update
  to authenticated
  using (
    not public.private_media_storage_enforced()
    or bucket_id not in ('photos', 'documents')
  )
  with check (
    not public.private_media_storage_enforced()
    or bucket_id not in ('photos', 'documents')
  );

create policy buildtrack_media_registry_delete_boundary
  on storage.objects
  as restrictive
  for delete
  to authenticated
  using (
    not public.private_media_storage_enforced()
    or bucket_id not in ('photos', 'documents')
  );

-- Legacy PUBLIC policies may still target the anon role. They remain neutral
-- during dual-read, then become an unconditional deny for BuildTrack media as
-- soon as the private-storage cutover flag is enabled.
create policy buildtrack_media_registry_anonymous_boundary
  on storage.objects
  as restrictive
  for all
  to anon
  using (
    not public.private_media_storage_enforced()
    or bucket_id not in ('photos', 'documents')
  )
  with check (
    not public.private_media_storage_enforced()
    or bucket_id not in ('photos', 'documents')
  );

create or replace function public.server_finalize_private_media_storage(
  p_minimum_client_version text,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version text := nullif(btrim(p_minimum_client_version), '');
begin
  if p_confirm is not true or v_version is null then
    raise exception 'Explicit confirmation and minimum client version are required'
      using errcode = '22023';
  end if;

  update storage.buckets
  set public = false
  where id in ('photos', 'documents');

  insert into private.runtime_security_flags(flag, enabled, details, updated_at, updated_by)
  values (
    'private_media_storage',
    true,
    jsonb_build_object(
      'phase', 'private',
      'minimum_client_version', v_version,
      'activated_at', now()
    ),
    now(),
    auth.uid()
  )
  on conflict (flag) do update
  set enabled = excluded.enabled,
      details = excluded.details,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;

  return jsonb_build_object(
    'enabled', true,
    'minimum_client_version', v_version,
    'buckets', jsonb_build_array('photos', 'documents')
  );
end;
$$;

create or replace function public.server_get_private_media_storage_status()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce(f.enabled, false),
    'details', coalesce(f.details, '{}'::jsonb),
    'photos_private', coalesce((select not b.public from storage.buckets b where b.id = 'photos'), false),
    'documents_private', coalesce((select not b.public from storage.buckets b where b.id = 'documents'), false)
  )
  from (select 1) seed
  left join private.runtime_security_flags f on f.flag = 'private_media_storage'
$$;

revoke all on function public.server_finalize_private_media_storage(text, boolean) from public, anon, authenticated;
revoke all on function public.server_get_private_media_storage_status() from public, anon, authenticated;
grant execute on function public.server_finalize_private_media_storage(text, boolean) to service_role;
grant execute on function public.server_get_private_media_storage_status() to service_role;

notify pgrst, 'reload schema';
