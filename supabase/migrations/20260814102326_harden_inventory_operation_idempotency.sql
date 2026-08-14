-- Durable, tenant-scoped outcomes for offline inventory movement replay.
--
-- The original RPC used inventory_movements(operation_id) as its only replay
-- ledger. That protected successful writes, but it could not remember a
-- deterministic rejection and it did not bind an operation ID to its payload.
-- This migration adds a private outcome registry and keeps the public RPC as
-- the only inventory write surface.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_operation_id_key;

create unique index if not exists inventory_movements_org_operation_uidx
  on public.inventory_movements (organization_id, operation_id);

create table if not exists private.inventory_operation_registry (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id text not null,
  request_hash text not null,
  status text not null,
  message text not null,
  product_id text,
  movement_id text,
  stock_before numeric,
  stock_after numeric,
  created_by uuid references auth.users(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  replay_count integer not null default 0 check (replay_count >= 0),
  primary key (organization_id, operation_id),
  constraint inventory_operation_registry_operation_not_blank
    check (btrim(operation_id) <> ''),
  constraint inventory_operation_registry_hash_sha256
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint inventory_operation_registry_status_not_blank
    check (btrim(status) <> '')
);

comment on table private.inventory_operation_registry is
  'Tenant-scoped durable outcomes for idempotent inventory movement replay.';

create index if not exists inventory_operation_registry_created_by_idx
  on private.inventory_operation_registry (created_by)
  where created_by is not null;

alter table private.inventory_operation_registry enable row level security;
revoke all on table private.inventory_operation_registry from public, anon, authenticated;

drop policy if exists inventory_operation_registry_deny_clients
  on private.inventory_operation_registry;
create policy inventory_operation_registry_deny_clients
  on private.inventory_operation_registry
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function private.inventory_operation_request_hash(
  p_movement jsonb,
  p_product jsonb,
  p_allow_negative boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          -- Hash only the normalized business command. In particular,
          -- photo_url is deliberately excluded: an offline retry may upload
          -- the same photo under a different object URL after a lost reply.
          'movement', pg_catalog.jsonb_build_object(
            'id', nullif(btrim(p_movement ->> 'id'), ''),
            'chantier_id', nullif(btrim(p_movement ->> 'chantier_id'), ''),
            'product_id', nullif(btrim(coalesce(
              p_movement ->> 'product_id',
              p_product ->> 'id'
            )), ''),
            'movement_type', lower(nullif(btrim(p_movement ->> 'movement_type'), '')),
            'quantity', case
              when pg_catalog.jsonb_typeof(p_movement -> 'quantity') = 'number'
                then pg_catalog.to_jsonb(
                  pg_catalog.trim_scale((p_movement ->> 'quantity')::numeric)
                )
              else pg_catalog.to_jsonb(nullif(btrim(p_movement ->> 'quantity'), ''))
            end,
            'reference', case
              when nullif(btrim(p_movement ->> 'reference'), '') is null then null
              else private.inventory_normalize_reference(p_movement ->> 'reference')
            end,
            'barcode', nullif(btrim(p_movement ->> 'barcode'), ''),
            'supplier', nullif(btrim(p_movement ->> 'supplier'), ''),
            'location', nullif(btrim(p_movement ->> 'location'), ''),
            'building_id', nullif(btrim(p_movement ->> 'building_id'), ''),
            'building_name', nullif(btrim(p_movement ->> 'building_name'), ''),
            'zone_id', nullif(btrim(p_movement ->> 'zone_id'), ''),
            'zone_name', nullif(btrim(p_movement ->> 'zone_name'), ''),
            'company_id', nullif(btrim(p_movement ->> 'company_id'), ''),
            'company_name', nullif(btrim(p_movement ->> 'company_name'), ''),
            'person_name', nullif(btrim(p_movement ->> 'person_name'), ''),
            'comment', nullif(btrim(p_movement ->> 'comment'), ''),
            'created_at', nullif(btrim(p_movement ->> 'created_at'), '')
          ),
          'product', pg_catalog.jsonb_build_object(
            'id', nullif(btrim(p_product ->> 'id'), ''),
            'reference', case
              when nullif(btrim(p_product ->> 'reference'), '') is null then null
              else private.inventory_normalize_reference(p_product ->> 'reference')
            end,
            'designation', nullif(btrim(p_product ->> 'designation'), ''),
            'barcode', nullif(btrim(p_product ->> 'barcode'), ''),
            'min_stock', case
              when pg_catalog.jsonb_typeof(p_product -> 'min_stock') = 'number'
                then pg_catalog.to_jsonb(
                  pg_catalog.trim_scale((p_product ->> 'min_stock')::numeric)
                )
              else pg_catalog.to_jsonb(nullif(btrim(p_product ->> 'min_stock'), ''))
            end,
            'location', nullif(btrim(p_product ->> 'location'), ''),
            'supplier', nullif(btrim(p_product ->> 'supplier'), '')
          ),
          'allow_negative', coalesce(p_allow_negative, false)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function private.inventory_store_operation_result(
  p_organization_id uuid,
  p_operation_id text,
  p_request_hash text,
  p_status text,
  p_message text,
  p_product_id text,
  p_movement_id text,
  p_stock_before numeric,
  p_stock_after numeric,
  p_created_by uuid
)
returns void
language sql
set search_path = ''
as $$
  insert into private.inventory_operation_registry (
    organization_id,
    operation_id,
    request_hash,
    status,
    message,
    product_id,
    movement_id,
    stock_before,
    stock_after,
    created_by
  ) values (
    p_organization_id,
    p_operation_id,
    p_request_hash,
    p_status,
    p_message,
    p_product_id,
    p_movement_id,
    p_stock_before,
    p_stock_after,
    p_created_by
  )
$$;

revoke all on function private.inventory_operation_request_hash(jsonb, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function private.inventory_store_operation_result(
  uuid, text, text, text, text, text, text, numeric, numeric, uuid
) from public, anon, authenticated;

create or replace function public.record_inventory_movement(
  p_operation_id text,
  p_movement jsonb,
  p_product jsonb default null,
  p_allow_negative boolean default false
)
returns table (
  status text,
  message text,
  product_id text,
  movement_id text,
  stock_before numeric,
  stock_after numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_is_platform_admin boolean := false;
  v_membership_role text;
  v_permissions_override jsonb := '{}'::jsonb;
  v_can_record boolean := false;
  v_can_adjust boolean := false;
  v_registry private.inventory_operation_registry%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_existing_product_barcode text;
  v_product public.inventory_products%rowtype;
  v_org_id uuid;
  v_chantier_id text;
  v_product_id text;
  v_movement_id text;
  v_reference text;
  v_reference_normalized text;
  v_barcode text;
  v_type text;
  v_quantity numeric(14,3);
  v_before numeric(14,3);
  v_after numeric(14,3);
  v_min_stock numeric(14,3) := 0;
  v_negative_allowed boolean := false;
  v_request_hash text;
  v_created_at timestamptz;
  v_created_at_supplied boolean := false;
  v_created_at_valid boolean := true;
  v_historical_matches boolean := false;
begin
  if v_actor_id is null then
    return query select
      'forbidden',
      'Droit de mouvement de stock manquant.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  if p_operation_id is null or btrim(p_operation_id) = '' or p_movement is null then
    return query select
      'invalid_payload',
      'Identifiant d operation ou mouvement manquant.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  v_chantier_id := nullif(btrim(p_movement ->> 'chantier_id'), '');
  if v_chantier_id is null then
    return query select
      'invalid_payload',
      'Chantier manquant.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  select c.organization_id
  into v_org_id
  from public.chantiers c
  where c.id = v_chantier_id;

  if v_org_id is null then
    return query select
      'not_found',
      'Chantier introuvable.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  v_is_platform_admin := public.auth_is_platform_admin();
  if not v_is_platform_admin and not public.auth_has_active_membership(v_org_id) then
    return query select
      'forbidden',
      'Chantier hors de vos organisations actives.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  if v_is_platform_admin then
    v_can_record := true;
    v_can_adjust := true;
  else
    select om.role, coalesce(om.permissions_override, '{}'::jsonb)
    into v_membership_role, v_permissions_override
    from public.organization_memberships om
    where om.user_id = v_actor_id
      and om.organization_id = v_org_id
      and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc, om.created_at desc
    limit 1;

    if v_membership_role is null then
      return query select
        'forbidden',
        'Organisation active introuvable.',
        null::text, null::text, null::numeric, null::numeric;
      return;
    end if;

    v_can_record := v_membership_role in ('admin', 'conducteur', 'chef_equipe', 'magasinier');
    if pg_catalog.jsonb_typeof(v_permissions_override -> 'canRecordInventory') = 'boolean' then
      v_can_record := (v_permissions_override ->> 'canRecordInventory')::boolean;
    end if;

    v_can_adjust := v_membership_role in ('admin', 'conducteur');
    if pg_catalog.jsonb_typeof(v_permissions_override -> 'canAdjustInventory') = 'boolean' then
      v_can_adjust := (v_permissions_override ->> 'canAdjustInventory')::boolean;
    end if;
  end if;

  if not v_can_record then
    return query select
      'forbidden',
      'Droit de mouvement de stock manquant.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  select coalesce(nullif(btrim(p.name), ''), nullif(btrim(p.email), ''), 'Utilisateur')
  into v_actor_name
  from public.profiles p
  where p.id = v_actor_id;
  v_actor_name := coalesce(v_actor_name, 'Utilisateur');

  v_request_hash := private.inventory_operation_request_hash(
    p_movement,
    p_product,
    p_allow_negative
  );

  -- Serialize only this tenant-scoped operation. Every code path takes the
  -- operation lock before a product lock, which gives concurrent replays a
  -- deterministic and short lock order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_org_id::text || pg_catalog.chr(31) || p_operation_id, 0)
  );

  select *
  into v_registry
  from private.inventory_operation_registry r
  where r.organization_id = v_org_id
    and r.operation_id = p_operation_id
  for update;

  if found then
    if v_registry.request_hash is distinct from v_request_hash then
      return query select
        'duplicate_operation_mismatch',
        'Cet identifiant d operation est deja lie a une autre demande.',
        v_registry.product_id,
        v_registry.movement_id,
        v_registry.stock_before,
        v_registry.stock_after;
      return;
    end if;

    update private.inventory_operation_registry r
    set last_seen_at = now(),
        replay_count = r.replay_count + 1
    where r.organization_id = v_org_id
      and r.operation_id = p_operation_id;

    return query select
      v_registry.status,
      v_registry.message,
      v_registry.product_id,
      v_registry.movement_id,
      v_registry.stock_before,
      v_registry.stock_after;
    return;
  end if;

  v_type := lower(nullif(btrim(p_movement ->> 'movement_type'), ''));
  begin
    v_quantity := (p_movement ->> 'quantity')::numeric(14,3);
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_quantity := null;
  end;

  v_product_id := nullif(btrim(coalesce(p_movement ->> 'product_id', p_product ->> 'id')), '');
  v_reference := nullif(btrim(coalesce(p_product ->> 'reference', p_movement ->> 'reference')), '');
  v_barcode := nullif(btrim(coalesce(p_product ->> 'barcode', p_movement ->> 'barcode')), '');
  if v_reference is not null then
    v_reference_normalized := private.inventory_normalize_reference(v_reference);
  end if;

  v_created_at_supplied := nullif(p_movement ->> 'created_at', '') is not null;
  if v_created_at_supplied then
    begin
      v_created_at := (p_movement ->> 'created_at')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      v_created_at_valid := false;
      v_created_at := null;
    end;
  end if;

  -- Successful movements written before this registry existed remain
  -- idempotent. Compare their material movement fields, then lazily register
  -- the exact request hash used by the first post-migration replay.
  select *
  into v_existing
  from public.inventory_movements m
  where m.organization_id = v_org_id
    and m.operation_id = p_operation_id;

  if found then
    select p.barcode
    into v_existing_product_barcode
    from public.inventory_products p
    where p.organization_id = v_org_id
      and p.id = v_existing.product_id;

    v_historical_matches :=
      v_type = v_existing.movement_type
      and v_quantity is not null
      and v_quantity = v_existing.quantity
      and v_existing.chantier_id = v_chantier_id
      and (
        nullif(btrim(p_movement ->> 'id'), '') is null
        or nullif(btrim(p_movement ->> 'id'), '') = v_existing.id
      )
      and (
        v_product_id is not null
        or v_reference_normalized is not null
        or v_barcode is not null
      )
      and (v_product_id is null or v_product_id = v_existing.product_id)
      and (
        v_reference_normalized is null
        or private.inventory_normalize_reference(v_existing.reference) = v_reference_normalized
      )
      and (v_barcode is null or v_barcode = v_existing_product_barcode)
      and (
        nullif(btrim(p_product ->> 'designation'), '') is null
        or nullif(btrim(p_product ->> 'designation'), '') = v_existing.designation
      )
      and nullif(btrim(p_movement ->> 'supplier'), '') is not distinct from v_existing.supplier
      and nullif(btrim(p_movement ->> 'building_id'), '') is not distinct from v_existing.building_id
      and nullif(btrim(p_movement ->> 'building_name'), '') is not distinct from v_existing.building_name
      and nullif(btrim(p_movement ->> 'zone_id'), '') is not distinct from v_existing.zone_id
      and nullif(btrim(p_movement ->> 'zone_name'), '') is not distinct from v_existing.zone_name
      and nullif(btrim(p_movement ->> 'company_id'), '') is not distinct from v_existing.company_id
      and nullif(btrim(p_movement ->> 'company_name'), '') is not distinct from v_existing.company_name
      and nullif(btrim(p_movement ->> 'person_name'), '') is not distinct from v_existing.person_name
      and nullif(btrim(p_movement ->> 'comment'), '') is not distinct from v_existing.comment
      and (
        not v_created_at_supplied
        or (v_created_at_valid and v_created_at = v_existing.created_at)
      )
      and (v_existing.stock_after >= 0 or coalesce(p_allow_negative, false));

    if not v_historical_matches then
      return query select
        'duplicate_operation_mismatch',
        'Cet identifiant d operation historique correspond a un autre mouvement.',
        v_existing.product_id,
        v_existing.id,
        v_existing.stock_before::numeric,
        v_existing.stock_after::numeric;
      return;
    end if;

    perform private.inventory_store_operation_result(
      v_org_id,
      p_operation_id,
      v_request_hash,
      'ok',
      'Mouvement deja enregistre.',
      v_existing.product_id,
      v_existing.id,
      v_existing.stock_before,
      v_existing.stock_after,
      v_actor_id
    );

    return query select
      'ok',
      'Mouvement deja enregistre.',
      v_existing.product_id,
      v_existing.id,
      v_existing.stock_before::numeric,
      v_existing.stock_after::numeric;
    return;
  end if;

  if v_type is null or v_type not in ('in', 'out') then
    perform private.inventory_store_operation_result(
      v_org_id, p_operation_id, v_request_hash,
      'invalid_payload', 'Type de mouvement invalide.',
      null, null, null, null, v_actor_id
    );
    return query select
      'invalid_payload', 'Type de mouvement invalide.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  if v_quantity is null or v_quantity = 'NaN'::numeric or v_quantity <= 0 then
    perform private.inventory_store_operation_result(
      v_org_id, p_operation_id, v_request_hash,
      'invalid_payload', 'La quantite doit etre strictement positive.',
      null, null, null, null, v_actor_id
    );
    return query select
      'invalid_payload', 'La quantite doit etre strictement positive.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  if not v_created_at_valid then
    perform private.inventory_store_operation_result(
      v_org_id, p_operation_id, v_request_hash,
      'invalid_payload', 'Date de mouvement invalide.',
      null, null, null, null, v_actor_id
    );
    return query select
      'invalid_payload', 'Date de mouvement invalide.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  if v_product_id is not null then
    select *
    into v_product
    from public.inventory_products p
    where p.organization_id = v_org_id
      and p.id = v_product_id
      and p.chantier_id = v_chantier_id
    for update;
  end if;

  if v_product.id is null and v_barcode is not null then
    select *
    into v_product
    from public.inventory_products p
    where p.organization_id = v_org_id
      and p.chantier_id = v_chantier_id
      and p.barcode = v_barcode
    for update;
  end if;

  if v_product.id is null and v_reference_normalized is not null then
    select *
    into v_product
    from public.inventory_products p
    where p.organization_id = v_org_id
      and p.chantier_id = v_chantier_id
      and p.reference_normalized = v_reference_normalized
    for update;
  end if;

  if v_product.id is null then
    if v_type <> 'in' or p_product is null or v_reference is null then
      perform private.inventory_store_operation_result(
        v_org_id, p_operation_id, v_request_hash,
        'product_not_found',
        'Produit introuvable. Une nouvelle reference doit etre creee par une entree.',
        null, null, null, null, v_actor_id
      );
      return query select
        'product_not_found',
        'Produit introuvable. Une nouvelle reference doit etre creee par une entree.',
        null::text, null::text, null::numeric, null::numeric;
      return;
    end if;

    begin
      v_min_stock := greatest(coalesce(nullif(p_product ->> 'min_stock', '')::numeric, 0), 0);
      if v_min_stock = 'NaN'::numeric then
        raise exception 'non-finite minimum stock' using errcode = '22023';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
      perform private.inventory_store_operation_result(
        v_org_id, p_operation_id, v_request_hash,
        'invalid_payload', 'Stock minimum invalide.',
        null, null, null, null, v_actor_id
      );
      return query select
        'invalid_payload', 'Stock minimum invalide.',
        null::text, null::text, null::numeric, null::numeric;
      return;
    end;

    -- The tenant trigger trusts this transaction-local value only because the
    -- target organization was authorized above. This is required for platform
    -- administrators and non-primary active memberships.
    perform pg_catalog.set_config('app.trusted_tenant_org', v_org_id::text, true);

    v_product_id := coalesce(v_product_id, 'inv-' || replace(gen_random_uuid()::text, '-', ''));
    begin
      insert into public.inventory_products (
        id, organization_id, chantier_id, reference, reference_normalized,
        designation, barcode, photo_url, min_stock, location, supplier,
        created_by, created_by_name
      ) values (
        v_product_id, v_org_id, v_chantier_id, v_reference, v_reference_normalized,
        coalesce(nullif(btrim(p_product ->> 'designation'), ''), v_reference),
        v_barcode, nullif(p_product ->> 'photo_url', ''),
        v_min_stock,
        nullif(btrim(p_product ->> 'location'), ''),
        nullif(btrim(p_product ->> 'supplier'), ''),
        v_actor_id, v_actor_name
      )
      returning * into v_product;
    exception when unique_violation then
      select *
      into v_product
      from public.inventory_products p
      where p.organization_id = v_org_id
        and p.chantier_id = v_chantier_id
        and (
          p.reference_normalized = v_reference_normalized
          or (v_barcode is not null and p.barcode = v_barcode)
        )
      order by case when p.reference_normalized = v_reference_normalized then 0 else 1 end
      limit 1
      for update;

      if not found then
        raise;
      end if;
    end;
  end if;

  if v_product.organization_id is distinct from v_org_id then
    perform private.inventory_store_operation_result(
      v_org_id, p_operation_id, v_request_hash,
      'forbidden', 'Produit hors de l organisation du chantier.',
      null, null, null, null, v_actor_id
    );
    return query select
      'forbidden', 'Produit hors de l organisation du chantier.',
      null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  v_product_id := v_product.id;
  v_before := v_product.current_stock;
  v_negative_allowed := coalesce(p_allow_negative, false) and v_can_adjust;
  v_after := case
    when v_type = 'in' then v_before + v_quantity
    else v_before - v_quantity
  end;

  if v_type = 'out' and v_after < 0 and not v_negative_allowed then
    perform private.inventory_store_operation_result(
      v_org_id, p_operation_id, v_request_hash,
      'insufficient_stock', 'Stock disponible insuffisant.',
      v_product_id, null, v_before, v_after, v_actor_id
    );
    return query select
      'insufficient_stock', 'Stock disponible insuffisant.',
      v_product_id, null::text, v_before::numeric, v_after::numeric;
    return;
  end if;

  perform pg_catalog.set_config('app.trusted_tenant_org', v_org_id::text, true);

  update public.inventory_products p
  set current_stock = v_after,
      total_entries = p.total_entries + case when v_type = 'in' then v_quantity else 0 end,
      total_exits = p.total_exits + case when v_type = 'out' then v_quantity else 0 end,
      supplier = case
        when v_type = 'in'
          then coalesce(nullif(btrim(p_movement ->> 'supplier'), ''), p.supplier)
        else p.supplier
      end,
      location = coalesce(nullif(btrim(p_movement ->> 'location'), ''), p.location),
      barcode = coalesce(p.barcode, v_barcode),
      photo_url = coalesce(p.photo_url, nullif(p_product ->> 'photo_url', '')),
      updated_at = now(),
      version = p.version + 1
  where p.organization_id = v_org_id
    and p.id = v_product_id;

  v_movement_id := coalesce(
    nullif(btrim(p_movement ->> 'id'), ''),
    'mov-' || replace(gen_random_uuid()::text, '-', '')
  );

  insert into public.inventory_movements (
    id, operation_id, organization_id, chantier_id, product_id,
    movement_type, quantity, stock_before, stock_after, reference, designation,
    supplier, building_id, building_name, zone_id, zone_name,
    company_id, company_name, person_name, comment, created_by, user_name, created_at
  ) values (
    v_movement_id, p_operation_id, v_org_id, v_chantier_id, v_product_id,
    v_type, v_quantity, v_before, v_after, v_product.reference, v_product.designation,
    nullif(btrim(p_movement ->> 'supplier'), ''),
    nullif(btrim(p_movement ->> 'building_id'), ''),
    nullif(btrim(p_movement ->> 'building_name'), ''),
    nullif(btrim(p_movement ->> 'zone_id'), ''),
    nullif(btrim(p_movement ->> 'zone_name'), ''),
    nullif(btrim(p_movement ->> 'company_id'), ''),
    nullif(btrim(p_movement ->> 'company_name'), ''),
    nullif(btrim(p_movement ->> 'person_name'), ''),
    nullif(btrim(p_movement ->> 'comment'), ''),
    v_actor_id, v_actor_name,
    coalesce(v_created_at, now())
  );

  perform private.inventory_store_operation_result(
    v_org_id,
    p_operation_id,
    v_request_hash,
    'ok',
    'Mouvement enregistre.',
    v_product_id,
    v_movement_id,
    v_before,
    v_after,
    v_actor_id
  );

  return query select
    'ok', 'Mouvement enregistre.',
    v_product_id, v_movement_id, v_before::numeric, v_after::numeric;
end;
$$;

create or replace function public.update_inventory_product(
  p_product_id text,
  p_patch jsonb
)
returns table (status text, message text, product_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_product public.inventory_products%rowtype;
  v_is_platform_admin boolean := false;
  v_membership_role text;
  v_permissions_override jsonb := '{}'::jsonb;
  v_can_manage boolean := false;
  v_product_org_id uuid;
  v_reference text;
  v_min numeric(14,3);
begin
  if v_actor_id is null then
    return query select
      'forbidden', 'Droit de modification produit manquant.', null::text;
    return;
  end if;

  if p_product_id is null or btrim(p_product_id) = '' or p_patch is null then
    return query select
      'invalid_payload', 'Produit ou modification manquante.', null::text;
    return;
  end if;

  -- Resolve the target tenant before authorization, without retaining a row
  -- lock for a caller that is not allowed to manage this product.
  select *
  into v_product
  from public.inventory_products p
  where p.id = p_product_id;

  if not found then
    return query select 'not_found', 'Produit introuvable.', null::text;
    return;
  end if;
  v_product_org_id := v_product.organization_id;

  v_is_platform_admin := public.auth_is_platform_admin();
  if v_is_platform_admin then
    v_can_manage := true;
  else
    select om.role, coalesce(om.permissions_override, '{}'::jsonb)
    into v_membership_role, v_permissions_override
    from public.organization_memberships om
    where om.user_id = v_actor_id
      and om.organization_id = v_product_org_id
      and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc, om.created_at desc
    limit 1;

    if v_membership_role is not null then
      v_can_manage := v_membership_role in ('admin', 'conducteur', 'magasinier');
      if pg_catalog.jsonb_typeof(
        v_permissions_override -> 'canManageInventoryProducts'
      ) = 'boolean' then
        v_can_manage := (
          v_permissions_override ->> 'canManageInventoryProducts'
        )::boolean;
      end if;
    end if;
  end if;

  if not v_can_manage then
    return query select
      'forbidden', 'Droit de modification produit manquant.', null::text;
    return;
  end if;

  -- Reacquire and lock only the authorized tenant row. The organization key
  -- cannot be redirected between the authorization check and this lock.
  select *
  into v_product
  from public.inventory_products p
  where p.id = p_product_id
    and p.organization_id = v_product_org_id
  for update;

  if not found then
    return query select 'not_found', 'Produit introuvable.', null::text;
    return;
  end if;

  v_reference := coalesce(
    nullif(btrim(p_patch ->> 'reference'), ''),
    v_product.reference
  );
  begin
    v_min := greatest(
      coalesce(
        nullif(p_patch ->> 'min_stock', '')::numeric,
        v_product.min_stock
      ),
      0
    );
    if v_min = 'NaN'::numeric then
      raise exception 'non-finite minimum stock' using errcode = '22023';
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
    return query select
      'invalid_payload', 'Stock minimum invalide.', null::text;
    return;
  end;

  -- The target membership/platform authority was validated above. Supply the
  -- transaction-local tenant expected by private.enforce_actor_tenant().
  perform pg_catalog.set_config(
    'app.trusted_tenant_org',
    v_product_org_id::text,
    true
  );

  begin
    update public.inventory_products p
    set reference = v_reference,
        reference_normalized = private.inventory_normalize_reference(v_reference),
        designation = coalesce(
          nullif(btrim(p_patch ->> 'designation'), ''),
          p.designation
        ),
        barcode = case
          when p_patch ? 'barcode'
            then nullif(btrim(p_patch ->> 'barcode'), '')
          else p.barcode
        end,
        photo_url = case
          when p_patch ? 'photo_url'
            then nullif(p_patch ->> 'photo_url', '')
          else p.photo_url
        end,
        min_stock = v_min,
        location = case
          when p_patch ? 'location'
            then nullif(btrim(p_patch ->> 'location'), '')
          else p.location
        end,
        supplier = case
          when p_patch ? 'supplier'
            then nullif(btrim(p_patch ->> 'supplier'), '')
          else p.supplier
        end,
        updated_at = now(),
        version = p.version + 1
    where p.id = p_product_id
      and p.organization_id = v_product_org_id;
  exception when unique_violation then
    return query select
      'duplicate_product',
      'Reference ou code-barres deja utilise sur ce chantier.',
      p_product_id;
    return;
  end;

  return query select 'ok', 'Produit mis a jour.', p_product_id;
end;
$$;

revoke all on function public.record_inventory_movement(text, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.record_inventory_movement(text, jsonb, jsonb, boolean)
  to authenticated;

revoke all on function public.update_inventory_product(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_inventory_product(text, jsonb)
  to authenticated;
