-- Shared, server-only barcode catalogue.
--
-- A successful lookup is kept without an automatic expiry so every BuildTrack
-- client (mobile and web) can reuse it. Negative lookups expire after a bounded
-- delay, and a database lease prevents concurrent first scans from consuming
-- several external-search requests for the same code.

create schema if not exists private;

create or replace function private.inventory_barcode_cache_key(p_value text)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
declare
  v_value text := btrim(regexp_replace(p_value, '[[:cntrl:]]', '', 'g'));
  v_sum integer := 0;
  v_index integer;
  v_digit integer;
  v_check integer;
begin
  if v_value = '' then
    return '';
  end if;

  if v_value ~ '^[0-9]{8}$|^[0-9]{12,14}$' then
    v_check := substring(v_value from char_length(v_value) for 1)::integer;
    for v_index in reverse (char_length(v_value) - 1)..1 loop
      v_digit := substring(v_value from v_index for 1)::integer;
      v_sum := v_sum + v_digit *
        case when (char_length(v_value) - 1 - v_index) % 2 = 0 then 3 else 1 end;
    end loop;
    if (10 - (v_sum % 10)) % 10 = v_check then
      return lpad(v_value, 14, '0');
    end if;
  end if;

  return upper(left(v_value, 128));
end;
$$;

revoke all on function private.inventory_barcode_cache_key(text)
  from public, anon, authenticated;

create table if not exists private.inventory_barcode_catalog (
  barcode_key text primary key,
  raw_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'found', 'not_found')),
  designation text,
  brand text,
  photo_url text,
  source text,
  source_url text,
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  variant_complete boolean not null default false,
  provider text,
  providers_tried text[] not null default '{}'::text[],
  fallback_reason text,
  lookup_version integer not null default 1 check (lookup_version > 0),
  lease_token uuid,
  lease_until timestamptz,
  expires_at timestamptz,
  hit_count bigint not null default 0 check (hit_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_hit_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_barcode_catalog_key_not_blank
    check (btrim(barcode_key) <> '' and char_length(barcode_key) <= 128),
  constraint inventory_barcode_catalog_raw_code_not_blank
    check (btrim(raw_code) <> '' and char_length(raw_code) <= 128),
  constraint inventory_barcode_catalog_found_has_designation
    check (status <> 'found' or btrim(coalesce(designation, '')) <> '')
);

create index if not exists inventory_barcode_catalog_pending_lease_idx
  on private.inventory_barcode_catalog (lease_until)
  where status = 'pending';

create index if not exists inventory_barcode_catalog_negative_expiry_idx
  on private.inventory_barcode_catalog (expires_at)
  where status = 'not_found';

alter table private.inventory_barcode_catalog enable row level security;
revoke all on table private.inventory_barcode_catalog from public, anon, authenticated;

comment on table private.inventory_barcode_catalog is
  'Server-only shared cache for exact barcode product resolution. Contains no organisation, chantier or user data.';

create or replace function public.inventory_barcode_cache_claim(
  p_barcode_key text,
  p_raw_code text,
  p_lease_token uuid,
  p_lease_seconds integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = private, pg_catalog, pg_temp
as $$
declare
  v_key text := private.inventory_barcode_cache_key(p_barcode_key);
  v_raw_code text := left(btrim(p_raw_code), 128);
  v_now timestamptz := clock_timestamp();
  v_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 20), 5), 60);
  v_row private.inventory_barcode_catalog%rowtype;
begin
  if v_key = '' or v_raw_code = '' or p_lease_token is null then
    raise exception 'Invalid barcode cache claim';
  end if;

  insert into private.inventory_barcode_catalog (
    barcode_key, raw_code, status, lease_token, lease_until, updated_at
  ) values (
    v_key, v_raw_code, 'pending', p_lease_token,
    v_now + make_interval(secs => v_lease_seconds), v_now
  )
  on conflict (barcode_key) do nothing;

  select * into v_row
  from private.inventory_barcode_catalog
  where barcode_key = v_key
  for update;

  if v_row.status = 'found'
    and btrim(coalesce(v_row.designation, '')) <> ''
    and (v_row.expires_at is null or v_row.expires_at > v_now) then
    update private.inventory_barcode_catalog
    set hit_count = hit_count + 1,
        last_hit_at = v_now,
        updated_at = v_now
    where barcode_key = v_key
    returning * into v_row;

    return jsonb_build_object(
      'state', 'hit',
      'cacheHit', true,
      'cachedProvider', v_row.provider,
      'match', jsonb_strip_nulls(jsonb_build_object(
        'barcode', v_row.raw_code,
        'designation', v_row.designation,
        'brand', v_row.brand,
        'photoUrl', v_row.photo_url,
        'source', v_row.source,
        'sourceUrl', v_row.source_url,
        'confidence', v_row.confidence,
        'variantComplete', v_row.variant_complete
      ))
    );
  end if;

  if v_row.status = 'not_found'
    and v_row.expires_at is not null
    and v_row.expires_at > v_now then
    update private.inventory_barcode_catalog
    set hit_count = hit_count + 1,
        last_hit_at = v_now,
        updated_at = v_now
    where barcode_key = v_key;

    return jsonb_build_object(
      'state', 'negative_hit',
      'cacheHit', true,
      'expiresAt', v_row.expires_at
    );
  end if;

  if v_row.status = 'pending'
    and v_row.lease_token is distinct from p_lease_token
    and v_row.lease_until is not null
    and v_row.lease_until > v_now then
    return jsonb_build_object(
      'state', 'pending',
      'cacheHit', false,
      'retryAfterMs', greatest(
        100,
        ceil(extract(epoch from (v_row.lease_until - v_now)) * 1000)::integer
      )
    );
  end if;

  update private.inventory_barcode_catalog
  set raw_code = v_raw_code,
      status = 'pending',
      lease_token = p_lease_token,
      lease_until = v_now + make_interval(secs => v_lease_seconds),
      expires_at = null,
      updated_at = v_now
  where barcode_key = v_key;

  return jsonb_build_object(
    'state', 'claimed',
    'cacheHit', false,
    'leaseSeconds', v_lease_seconds
  );
end;
$$;

create or replace function public.inventory_barcode_cache_complete(
  p_barcode_key text,
  p_lease_token uuid,
  p_match jsonb,
  p_provider text default null,
  p_providers_tried text[] default '{}'::text[],
  p_fallback_reason text default null,
  p_lookup_version integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = private, pg_catalog, pg_temp
as $$
declare
  v_key text := private.inventory_barcode_cache_key(p_barcode_key);
  v_now timestamptz := clock_timestamp();
  v_designation text := left(btrim(coalesce(p_match ->> 'designation', '')), 500);
  v_confidence text := lower(coalesce(p_match ->> 'confidence', 'medium'));
  v_row private.inventory_barcode_catalog%rowtype;
begin
  if v_key = '' or p_lease_token is null or v_designation = '' then
    raise exception 'Invalid barcode cache completion';
  end if;
  if v_confidence not in ('high', 'medium', 'low') then
    v_confidence := 'medium';
  end if;

  update private.inventory_barcode_catalog
  set raw_code = left(coalesce(nullif(btrim(p_match ->> 'barcode'), ''), raw_code), 128),
      status = 'found',
      designation = v_designation,
      brand = nullif(left(btrim(p_match ->> 'brand'), 180), ''),
      photo_url = nullif(left(btrim(p_match ->> 'photoUrl'), 2048), ''),
      source = nullif(left(btrim(p_match ->> 'source'), 50), ''),
      source_url = nullif(left(btrim(p_match ->> 'sourceUrl'), 2048), ''),
      confidence = v_confidence,
      variant_complete = case
        when lower(coalesce(p_match ->> 'variantComplete', 'false')) = 'true' then true
        else false
      end,
      provider = nullif(left(btrim(p_provider), 50), ''),
      providers_tried = coalesce(p_providers_tried, '{}'::text[]),
      fallback_reason = nullif(left(btrim(p_fallback_reason), 180), ''),
      lookup_version = greatest(coalesce(p_lookup_version, 1), 1),
      lease_token = null,
      lease_until = null,
      expires_at = null,
      hit_count = hit_count + 1,
      first_seen_at = coalesce(first_seen_at, v_now),
      last_hit_at = v_now,
      last_verified_at = v_now,
      updated_at = v_now
  where barcode_key = v_key
    and lease_token = p_lease_token
  returning * into v_row;

  if not found then
    select * into v_row
    from private.inventory_barcode_catalog
    where barcode_key = v_key;
    if v_row.status <> 'found' then
      return jsonb_build_object('state', 'superseded', 'cacheHit', false);
    end if;
  end if;

  return jsonb_build_object(
    'state', 'stored',
    'cacheHit', false,
    'match', jsonb_strip_nulls(jsonb_build_object(
      'barcode', v_row.raw_code,
      'designation', v_row.designation,
      'brand', v_row.brand,
      'photoUrl', v_row.photo_url,
      'source', v_row.source,
      'sourceUrl', v_row.source_url,
      'confidence', v_row.confidence,
      'variantComplete', v_row.variant_complete
    ))
  );
end;
$$;

create or replace function public.inventory_barcode_cache_mark_not_found(
  p_barcode_key text,
  p_lease_token uuid,
  p_negative_ttl_seconds integer default 604800
)
returns boolean
language plpgsql
security definer
set search_path = private, pg_catalog, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  update private.inventory_barcode_catalog
  set status = 'not_found',
      designation = null,
      brand = null,
      photo_url = null,
      source = null,
      source_url = null,
      confidence = null,
      variant_complete = false,
      lease_token = null,
      lease_until = null,
      expires_at = v_now + make_interval(
        secs => least(greatest(coalesce(p_negative_ttl_seconds, 604800), 3600), 604800)
      ),
      last_verified_at = v_now,
      updated_at = v_now
  where barcode_key = private.inventory_barcode_cache_key(p_barcode_key)
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.inventory_barcode_cache_release(
  p_barcode_key text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = private, pg_catalog, pg_temp
as $$
begin
  delete from private.inventory_barcode_catalog
  where barcode_key = private.inventory_barcode_cache_key(p_barcode_key)
    and status = 'pending'
    and lease_token = p_lease_token;
  return found;
end;
$$;

revoke all on function public.inventory_barcode_cache_claim(text, text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.inventory_barcode_cache_complete(text, uuid, jsonb, text, text[], text, integer)
  from public, anon, authenticated;
revoke all on function public.inventory_barcode_cache_mark_not_found(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.inventory_barcode_cache_release(text, uuid)
  from public, anon, authenticated;

grant execute on function public.inventory_barcode_cache_claim(text, text, uuid, integer)
  to service_role;
grant execute on function public.inventory_barcode_cache_complete(text, uuid, jsonb, text, text[], text, integer)
  to service_role;
grant execute on function public.inventory_barcode_cache_mark_not_found(text, uuid, integer)
  to service_role;
grant execute on function public.inventory_barcode_cache_release(text, uuid)
  to service_role;

notify pgrst, 'reload schema';
