-- BuildTrack chantier inventory module.
-- Stock writes are intentionally RPC-only: row locks and operation IDs keep
-- concurrent and offline-replayed movements atomic and idempotent.

create schema if not exists private;

create table if not exists public.inventory_products (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chantier_id text not null references public.chantiers(id) on delete cascade,
  reference text not null check (btrim(reference) <> ''),
  reference_normalized text not null check (btrim(reference_normalized) <> ''),
  designation text not null check (btrim(designation) <> ''),
  barcode text,
  photo_url text,
  current_stock numeric(14,3) not null default 0,
  total_entries numeric(14,3) not null default 0 check (total_entries >= 0),
  total_exits numeric(14,3) not null default 0 check (total_exits >= 0),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  location text,
  supplier text,
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (chantier_id, reference_normalized)
);

create unique index if not exists inventory_products_chantier_barcode_uidx
  on public.inventory_products (chantier_id, barcode)
  where barcode is not null and btrim(barcode) <> '';
create index if not exists inventory_products_org_chantier_idx
  on public.inventory_products (organization_id, chantier_id);
create index if not exists inventory_products_low_stock_idx
  on public.inventory_products (chantier_id, current_stock, min_stock);
create index if not exists inventory_products_reference_search_idx
  on public.inventory_products (chantier_id, reference_normalized);

create table if not exists public.inventory_movements (
  id text primary key,
  operation_id text not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chantier_id text not null references public.chantiers(id) on delete cascade,
  product_id text not null references public.inventory_products(id) on delete restrict,
  movement_type text not null check (movement_type in ('in', 'out')),
  quantity numeric(14,3) not null check (quantity > 0),
  stock_before numeric(14,3) not null,
  stock_after numeric(14,3) not null,
  reference text not null,
  designation text not null,
  supplier text,
  building_id text,
  building_name text,
  zone_id text,
  zone_name text,
  company_id text,
  company_name text,
  person_name text,
  comment text,
  created_by uuid references public.profiles(id) on delete set null,
  user_name text not null,
  created_at timestamptz not null default now()
);

create index if not exists inventory_movements_org_chantier_created_idx
  on public.inventory_movements (organization_id, chantier_id, created_at desc);
create index if not exists inventory_movements_product_created_idx
  on public.inventory_movements (product_id, created_at desc);
create index if not exists inventory_movements_building_idx
  on public.inventory_movements (chantier_id, building_id, created_at desc);
create index if not exists inventory_movements_company_idx
  on public.inventory_movements (chantier_id, company_id, created_at desc);

create or replace function private.inventory_normalize_reference(p_reference text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select upper(regexp_replace(btrim(p_reference), '[[:space:]-]+', '', 'g'))
$$;

create or replace function private.inventory_can(p_permission text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_role text;
  v_override jsonb;
  v_default boolean := false;
  v_override_value jsonb;
begin
  if auth.uid() is null then
    return false;
  end if;

  select p.role, coalesce(p.permissions_override::jsonb, '{}'::jsonb)
    into v_role, v_override
  from public.profiles p
  where p.id = auth.uid();

  if v_role is null then
    return false;
  end if;
  if v_role = 'super_admin' then
    return true;
  end if;

  v_default := case p_permission
    when 'view' then v_role in ('admin', 'conducteur', 'chef_equipe', 'observateur')
    when 'record' then v_role in ('admin', 'conducteur', 'chef_equipe')
    when 'adjust' then v_role in ('admin', 'conducteur')
    when 'export' then v_role in ('admin', 'conducteur', 'observateur')
    else false
  end;

  v_override_value := v_override -> case p_permission
    when 'view' then 'canViewInventory'
    when 'record' then 'canRecordInventory'
    when 'adjust' then 'canAdjustInventory'
    when 'export' then 'canExportInventory'
    else '__invalid__'
  end;

  if jsonb_typeof(v_override_value) = 'boolean' then
    return (v_override_value #>> '{}')::boolean;
  end if;
  return v_default;
end;
$$;

alter table public.inventory_products enable row level security;
alter table public.inventory_movements enable row level security;

drop policy if exists inventory_products_select on public.inventory_products;
create policy inventory_products_select
on public.inventory_products for select to authenticated
using (
  private.inventory_can('view')
  and (
    organization_id = public.auth_user_org()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  )
);

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select
on public.inventory_movements for select to authenticated
using (
  private.inventory_can('view')
  and (
    organization_id = public.auth_user_org()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin'
    )
  )
);

revoke all on table public.inventory_products from anon, authenticated;
revoke all on table public.inventory_movements from anon, authenticated;
grant select on table public.inventory_products to authenticated;
grant select on table public.inventory_movements to authenticated;

revoke all on function private.inventory_normalize_reference(text) from public, anon, authenticated;
revoke all on function private.inventory_can(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.inventory_can(text) to authenticated;

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
  v_profile public.profiles%rowtype;
  v_product public.inventory_products%rowtype;
  v_existing public.inventory_movements%rowtype;
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
  v_negative_allowed boolean := false;
begin
  if auth.uid() is null or not private.inventory_can('record') then
    return query select 'forbidden', 'Droit de mouvement de stock manquant.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;
  if p_operation_id is null or btrim(p_operation_id) = '' or p_movement is null then
    return query select 'invalid_payload', 'Identifiant d operation ou mouvement manquant.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  -- Serialize every retry of the same client operation, even when a malformed
  -- retry points at another product. This closes the final double-apply race.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id, 0));

  select * into v_profile from public.profiles p where p.id = auth.uid();
  v_chantier_id := nullif(btrim(p_movement ->> 'chantier_id'), '');
  if v_chantier_id is null then
    return query select 'invalid_payload', 'Chantier manquant.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  select c.organization_id into v_org_id
  from public.chantiers c where c.id = v_chantier_id;
  if v_org_id is null then
    return query select 'not_found', 'Chantier introuvable.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;
  if v_profile.role <> 'super_admin' and v_profile.organization_id is distinct from v_org_id then
    return query select 'forbidden', 'Chantier hors de votre organisation.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  select * into v_existing
  from public.inventory_movements m
  where m.operation_id = p_operation_id;
  if found then
    return query select 'ok', 'Mouvement deja enregistre.', v_existing.product_id, v_existing.id,
      v_existing.stock_before::numeric, v_existing.stock_after::numeric;
    return;
  end if;

  v_type := lower(nullif(btrim(p_movement ->> 'movement_type'), ''));
  if v_type not in ('in', 'out') then
    return query select 'invalid_payload', 'Type de mouvement invalide.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;
  begin
    v_quantity := (p_movement ->> 'quantity')::numeric(14,3);
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_quantity := null;
  end;
  if v_quantity is null or v_quantity <= 0 then
    return query select 'invalid_payload', 'La quantite doit etre strictement positive.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  v_product_id := nullif(btrim(coalesce(p_movement ->> 'product_id', p_product ->> 'id')), '');
  v_reference := nullif(btrim(coalesce(p_product ->> 'reference', p_movement ->> 'reference')), '');
  v_barcode := nullif(btrim(coalesce(p_product ->> 'barcode', p_movement ->> 'barcode')), '');
  if v_reference is not null then
    v_reference_normalized := private.inventory_normalize_reference(v_reference);
  end if;

  if v_product_id is not null then
    select * into v_product from public.inventory_products p
    where p.id = v_product_id and p.chantier_id = v_chantier_id
    for update;
  end if;
  if v_product.id is null and v_barcode is not null then
    select * into v_product from public.inventory_products p
    where p.chantier_id = v_chantier_id and p.barcode = v_barcode
    for update;
  end if;
  if v_product.id is null and v_reference_normalized is not null then
    select * into v_product from public.inventory_products p
    where p.chantier_id = v_chantier_id and p.reference_normalized = v_reference_normalized
    for update;
  end if;

  if v_product.id is null then
    if v_type <> 'in' or p_product is null or v_reference is null then
      return query select 'product_not_found', 'Produit introuvable. Une nouvelle reference doit etre creee par une entree.', null::text, null::text, null::numeric, null::numeric;
      return;
    end if;
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
        greatest(coalesce(nullif(p_product ->> 'min_stock', '')::numeric, 0), 0),
        nullif(btrim(p_product ->> 'location'), ''),
        nullif(btrim(p_product ->> 'supplier'), ''),
        auth.uid(), coalesce(v_profile.name, v_profile.email, 'Utilisateur')
      )
      returning * into v_product;
    exception when unique_violation then
      select * into v_product from public.inventory_products p
      where p.chantier_id = v_chantier_id
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
    return query select 'forbidden', 'Produit hors de l organisation du chantier.', null::text, null::text, null::numeric, null::numeric;
    return;
  end if;

  v_product_id := v_product.id;
  v_before := v_product.current_stock;
  v_negative_allowed := p_allow_negative and private.inventory_can('adjust');
  v_after := case when v_type = 'in' then v_before + v_quantity else v_before - v_quantity end;
  if v_type = 'out' and v_after < 0 and not v_negative_allowed then
    return query select 'insufficient_stock', 'Stock disponible insuffisant.', v_product_id, null::text, v_before::numeric, v_after::numeric;
    return;
  end if;

  update public.inventory_products p
  set current_stock = v_after,
      total_entries = p.total_entries + case when v_type = 'in' then v_quantity else 0 end,
      total_exits = p.total_exits + case when v_type = 'out' then v_quantity else 0 end,
      supplier = case when v_type = 'in' then coalesce(nullif(btrim(p_movement ->> 'supplier'), ''), p.supplier) else p.supplier end,
      location = coalesce(nullif(btrim(p_movement ->> 'location'), ''), p.location),
      barcode = coalesce(p.barcode, v_barcode),
      photo_url = coalesce(p.photo_url, nullif(p_product ->> 'photo_url', '')),
      updated_at = now(),
      version = p.version + 1
  where p.id = v_product_id;

  v_movement_id := coalesce(nullif(btrim(p_movement ->> 'id'), ''), 'mov-' || replace(gen_random_uuid()::text, '-', ''));
  begin
    insert into public.inventory_movements (
      id, operation_id, organization_id, chantier_id, product_id,
      movement_type, quantity, stock_before, stock_after, reference, designation,
      supplier, building_id, building_name, zone_id, zone_name,
      company_id, company_name, person_name, comment, created_by, user_name, created_at
    ) values (
      v_movement_id, p_operation_id, v_org_id, v_chantier_id, v_product_id,
      v_type, v_quantity, v_before, v_after, v_product.reference, v_product.designation,
      nullif(btrim(p_movement ->> 'supplier'), ''),
      nullif(btrim(p_movement ->> 'building_id'), ''), nullif(btrim(p_movement ->> 'building_name'), ''),
      nullif(btrim(p_movement ->> 'zone_id'), ''), nullif(btrim(p_movement ->> 'zone_name'), ''),
      nullif(btrim(p_movement ->> 'company_id'), ''), nullif(btrim(p_movement ->> 'company_name'), ''),
      nullif(btrim(p_movement ->> 'person_name'), ''), nullif(btrim(p_movement ->> 'comment'), ''),
      auth.uid(), coalesce(v_profile.name, v_profile.email, 'Utilisateur'),
      coalesce(nullif(p_movement ->> 'created_at', '')::timestamptz, now())
    );
  exception when unique_violation then
    -- The product row lock normally serializes retries. This final guard also
    -- covers a duplicated operation ID accidentally sent against another row.
    select * into v_existing from public.inventory_movements m where m.operation_id = p_operation_id;
    if found then
      return query select 'ok', 'Mouvement deja enregistre.', v_existing.product_id, v_existing.id,
        v_existing.stock_before::numeric, v_existing.stock_after::numeric;
      return;
    end if;
    raise;
  end;

  return query select 'ok', 'Mouvement enregistre.', v_product_id, v_movement_id, v_before::numeric, v_after::numeric;
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
  v_profile public.profiles%rowtype;
  v_product public.inventory_products%rowtype;
  v_reference text;
  v_min numeric(14,3);
begin
  if auth.uid() is null or not private.inventory_can('adjust') then
    return query select 'forbidden', 'Droit de modification produit manquant.', null::text;
    return;
  end if;
  if p_product_id is null or btrim(p_product_id) = '' or p_patch is null then
    return query select 'invalid_payload', 'Produit ou modification manquante.', null::text;
    return;
  end if;

  select * into v_profile from public.profiles p where p.id = auth.uid();
  select * into v_product from public.inventory_products p where p.id = p_product_id for update;
  if not found then
    return query select 'not_found', 'Produit introuvable.', null::text;
    return;
  end if;
  if v_profile.role <> 'super_admin' and v_profile.organization_id is distinct from v_product.organization_id then
    return query select 'forbidden', 'Produit hors de votre organisation.', null::text;
    return;
  end if;

  v_reference := coalesce(nullif(btrim(p_patch ->> 'reference'), ''), v_product.reference);
  begin
    v_min := greatest(coalesce(nullif(p_patch ->> 'min_stock', '')::numeric, v_product.min_stock), 0);
  exception when invalid_text_representation or numeric_value_out_of_range then
    return query select 'invalid_payload', 'Stock minimum invalide.', null::text;
    return;
  end;

  begin
    update public.inventory_products p
    set reference = v_reference,
        reference_normalized = private.inventory_normalize_reference(v_reference),
        designation = coalesce(nullif(btrim(p_patch ->> 'designation'), ''), p.designation),
        barcode = case when p_patch ? 'barcode' then nullif(btrim(p_patch ->> 'barcode'), '') else p.barcode end,
        photo_url = case when p_patch ? 'photo_url' then nullif(p_patch ->> 'photo_url', '') else p.photo_url end,
        min_stock = v_min,
        location = case when p_patch ? 'location' then nullif(btrim(p_patch ->> 'location'), '') else p.location end,
        supplier = case when p_patch ? 'supplier' then nullif(btrim(p_patch ->> 'supplier'), '') else p.supplier end,
        updated_at = now(),
        version = p.version + 1
    where p.id = p_product_id;
  exception when unique_violation then
    return query select 'duplicate_product', 'Reference ou code-barres deja utilise sur ce chantier.', p_product_id;
    return;
  end;

  return query select 'ok', 'Produit mis a jour.', p_product_id;
end;
$$;

revoke all on function public.record_inventory_movement(text, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.update_inventory_product(text, jsonb) from public, anon;
grant execute on function public.record_inventory_movement(text, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.update_inventory_product(text, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory_products'
    ) then
      alter publication supabase_realtime add table public.inventory_products;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inventory_movements'
    ) then
      alter publication supabase_realtime add table public.inventory_movements;
    end if;
  end if;
end
$$;
