-- Give warehouse operators autonomy over ordinary inventory work while keeping
-- negative stock as a separate, exceptional permission. Existing overrides
-- used the old combined "adjust" permission for both behaviours, so copy that
-- value once to the new product-management permission to preserve intent.
update public.profiles
set permissions_override = coalesce(permissions_override, '{}'::jsonb)
  || jsonb_build_object('canManageInventoryProducts', permissions_override -> 'canAdjustInventory')
where jsonb_typeof(permissions_override -> 'canAdjustInventory') = 'boolean'
  and not (permissions_override ? 'canManageInventoryProducts');

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
    when 'view' then v_role in ('admin', 'conducteur', 'chef_equipe', 'magasinier', 'observateur')
    when 'record' then v_role in ('admin', 'conducteur', 'chef_equipe', 'magasinier')
    when 'manage' then v_role in ('admin', 'conducteur', 'magasinier')
    when 'adjust' then v_role in ('admin', 'conducteur')
    when 'export' then v_role in ('admin', 'conducteur', 'magasinier', 'observateur')
    else false
  end;

  v_override_value := v_override -> case p_permission
    when 'view' then 'canViewInventory'
    when 'record' then 'canRecordInventory'
    when 'manage' then 'canManageInventoryProducts'
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

revoke all on function private.inventory_can(text) from public, anon;
grant execute on function private.inventory_can(text) to authenticated;

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
  if auth.uid() is null or not private.inventory_can('manage') then
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

revoke all on function public.update_inventory_product(text, jsonb) from public, anon;
grant execute on function public.update_inventory_product(text, jsonb) to authenticated;
