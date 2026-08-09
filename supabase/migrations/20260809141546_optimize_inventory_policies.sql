-- Follow-up optimizations reported by the Supabase database advisors (applied as migration 20260809141546).

create index if not exists inventory_products_created_by_idx
  on public.inventory_products (created_by);

create index if not exists inventory_movements_created_by_idx
  on public.inventory_movements (created_by);

drop policy if exists inventory_products_select on public.inventory_products;
create policy inventory_products_select
on public.inventory_products for select to authenticated
using (
  (select private.inventory_can('view'))
  and (
    organization_id = (select public.auth_user_org())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'super_admin'
    )
  )
);

drop policy if exists inventory_movements_select on public.inventory_movements;
create policy inventory_movements_select
on public.inventory_movements for select to authenticated
using (
  (select private.inventory_can('view'))
  and (
    organization_id = (select public.auth_user_org())
    or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.role = 'super_admin'
    )
  )
);
