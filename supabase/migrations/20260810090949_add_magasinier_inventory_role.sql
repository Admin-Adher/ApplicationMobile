-- Dedicated paid role for warehouse operators. The role can read inventory
-- and record ordinary receipts/issues. Manual adjustments, negative stock and
-- exports remain disabled unless an administrator grants a per-user override.
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

revoke all on function private.inventory_can(text) from public, anon;
grant execute on function private.inventory_can(text) to authenticated;

-- Existing permissive organization policies allow every recognized role to
-- read most project tables. Add a restrictive policy so a magasinier remains
-- inventory-only even when calling PostgREST directly instead of using the UI.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'reserves',
    'tasks',
    'documents',
    'photos',
    'messages',
    'plans',
    'site_plans',
    'incidents',
    'visites',
    'lots',
    'oprs',
    'channels',
    'time_entries',
    'regulatory_docs',
    'journal_entries',
    'checklists',
    'reserve_outbox_operations',
    'reserve_status_events'
  ]
  loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('drop policy if exists magasinier_inventory_only on public.%I', v_table);
      execute format(
        'create policy magasinier_inventory_only on public.%I as restrictive for all to authenticated using ((select public.auth_user_role()) <> ''magasinier'') with check ((select public.auth_user_role()) <> ''magasinier'')',
        v_table
      );
    end if;
  end loop;
end;
$$;
