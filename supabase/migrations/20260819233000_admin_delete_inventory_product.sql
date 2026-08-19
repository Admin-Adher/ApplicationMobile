create or replace function public.admin_delete_inventory_product(p_product_id text)
returns table(status text, message text, product_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_product public.inventory_products%rowtype;
  v_org uuid;
  v_role text;
begin
  if v_actor_id is null or p_product_id is null or btrim(p_product_id) = '' then
    return query select 'forbidden', 'Droit administrateur requis.', null::text;
    return;
  end if;

  select *
  into v_product
  from public.inventory_products p
  where p.id = p_product_id;

  if not found then
    return query select 'not_found', 'Produit introuvable.', null::text;
    return;
  end if;
  v_org := v_product.organization_id;

  if not public.auth_is_platform_admin() then
    select om.role
    into v_role
    from public.organization_memberships om
    where om.user_id = v_actor_id
      and om.organization_id = v_org
      and om.status = 'active'
    order by om.is_primary desc, om.updated_at desc, om.created_at desc
    limit 1;

    if v_role is distinct from 'admin' then
      return query select 'forbidden', 'Droit administrateur requis.', null::text;
      return;
    end if;
  end if;

  delete from public.inventory_movements m
  where m.product_id = p_product_id
    and m.organization_id = v_org;

  delete from public.inventory_products p
  where p.id = p_product_id
    and p.organization_id = v_org;

  if not found then
    return query select 'not_found', 'Produit introuvable.', null::text;
    return;
  end if;

  return query select 'ok', 'Produit supprime.', p_product_id;
end;
$$;

revoke all on function public.admin_delete_inventory_product(text) from public, anon;
grant execute on function public.admin_delete_inventory_product(text) to authenticated;
