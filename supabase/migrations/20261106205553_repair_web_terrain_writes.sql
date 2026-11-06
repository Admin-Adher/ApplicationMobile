-- Older deployments can lack the additive company-logo migration.
alter table public.companies add column if not exists logo_url text;
alter table public.photos add column if not exists chantier_id text references public.chantiers(id) on delete set null;
create index if not exists photos_chantier_id_idx on public.photos(chantier_id) where chantier_id is not null;

create policy photos_project_matches_tenant_insert on public.photos as restrictive for insert to authenticated
with check (chantier_id is null or exists (
  select 1 from public.chantiers c where c.id = photos.chantier_id
  and c.organization_id = photos.organization_id and c.deleted_at is null
));
create policy photos_project_matches_tenant_update on public.photos as restrictive for update to authenticated
using (true)
with check (chantier_id is null or exists (
  select 1 from public.chantiers c where c.id = photos.chantier_id
  and c.organization_id = photos.organization_id
));

create function public.apply_web_reserve_pin(
  p_organization_id uuid, p_reserve_id text, p_plan_id text, p_operation_id uuid, p_x integer, p_y integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_author text;
  v_plan public.site_plans%rowtype;
  v_reserve public.reserves%rowtype;
  v_history jsonb;
begin
  if v_actor is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
       (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canMovePins'), false))) then
    raise exception 'Déplacement de l’épingle non autorisé.' using errcode = '42501';
  end if;
  if p_operation_id is null or p_x is null or p_y is null or p_x not between 0 and 100 or p_y not between 0 and 100 then
    raise exception 'Coordonnées invalides.' using errcode = '22023';
  end if;

  select p.* into v_plan from public.site_plans p
  where p.id = p_plan_id and p.deleted_at is null
    and coalesce(p.organization_id, (select c.organization_id from public.chantiers c where c.id = p.chantier_id)) = p_organization_id
  for share;
  if not found then raise exception 'Plan inaccessible.' using errcode = '42501'; end if;

  select r.* into v_reserve from public.reserves r
  where r.id = p_reserve_id and r.deleted_at is null
    and coalesce(r.organization_id, (select c.organization_id from public.chantiers c where c.id = r.chantier_id)) = p_organization_id
    and (r.chantier_id is null or r.chantier_id = v_plan.chantier_id)
  for update;
  if not found then raise exception 'Réserve inaccessible depuis ce plan.' using errcode = '42501'; end if;

  v_history := case when jsonb_typeof(v_reserve.history) = 'array' then v_reserve.history else '[]'::jsonb end;
  if v_history @> jsonb_build_array(jsonb_build_object('id', p_operation_id, 'actorId', v_actor)) then
    return to_jsonb(v_reserve);
  end if;
  select coalesce(nullif(btrim(name), ''), nullif(btrim(email), '')) into v_author from public.profiles where id = v_actor;

  update public.reserves r set plan_id = v_plan.id, plan_x = p_x, plan_y = p_y,
    building = coalesce(nullif(v_plan.building, ''), r.building, ''),
    building_id = coalesce(v_plan.building_id, r.building_id),
    level = coalesce(nullif(v_plan.level, ''), r.level, ''),
    level_id = coalesce(v_plan.level_id, r.level_id),
    history = v_history || jsonb_build_array(jsonb_build_object(
      'id', p_operation_id, 'actorId', v_actor, 'author', coalesce(v_author, 'Équipe'),
      'action', 'Épingle déplacée depuis le web', 'createdAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ))
  where r.id = p_reserve_id returning r.* into v_reserve;
  if not found then raise exception 'Déplacement de l’épingle refusé.' using errcode = '42501'; end if;
  return to_jsonb(v_reserve);
end;
$$;

create function public.replace_web_plan_file(
  p_organization_id uuid, p_plan_id text, p_before jsonb, p_patch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.site_plans%rowtype;
  v_target public.site_plans%rowtype;
begin
  if auth.uid() is null or p_organization_id is null or
     (public.auth_user_role() is distinct from 'super_admin' and
       (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canCreate'), false))) then
    raise exception 'Modification du plan non autorisée.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_before) is distinct from 'object' or jsonb_typeof(p_patch) is distinct from 'object'
     or coalesce(p_patch->>'uri', '') not like 'btmedia://%'
     or p_patch - array['name','uri','file_type','dxf_name','size','uploaded_at','pdf_page_count',
                       'building','building_id','level','level_id','revision_code','revision_note'] <> '{}'::jsonb then
    raise exception 'Fichier ou modification invalide.' using errcode = '22023';
  end if;

  select p.* into v_plan from public.site_plans p
  where p.id = p_plan_id and p.deleted_at is null
    and coalesce(p.organization_id, (select c.organization_id from public.chantiers c where c.id = p.chantier_id)) = p_organization_id
  for update;
  if not found then raise exception 'Plan inaccessible.' using errcode = '42501'; end if;

  if to_jsonb(v_plan) @> p_patch then return to_jsonb(v_plan); end if;
  if exists (
    select 1 from jsonb_each(p_patch) e(key, value)
    where (to_jsonb(v_plan)->e.key) is distinct from e.value
      and (to_jsonb(v_plan)->e.key) is distinct from (p_before->e.key)
  ) then
    raise exception 'Le plan a été modifié entre-temps. Le fichier est conservé dans la file.' using errcode = '22023';
  end if;

  select * into v_plan from public.replace_site_plan_file_safely(p_plan_id, p_patch, 'web_update_site_plan_file');
  if v_plan.id is null then raise exception 'Remplacement du plan refusé.' using errcode = '42501'; end if;
  v_target := jsonb_populate_record(v_plan, p_patch);
  if (v_plan.building, v_plan.building_id, v_plan.level, v_plan.level_id, v_plan.revision_code, v_plan.revision_note)
     is distinct from (v_target.building, v_target.building_id, v_target.level, v_target.level_id, v_target.revision_code, v_target.revision_note) then
    update public.site_plans set building = v_target.building, building_id = v_target.building_id,
      level = v_target.level, level_id = v_target.level_id, revision_code = v_target.revision_code, revision_note = v_target.revision_note
    where id = p_plan_id returning * into v_plan;
    if not found then raise exception 'Modification du plan refusée.' using errcode = '42501'; end if;
  end if;
  return to_jsonb(v_plan);
end;
$$;

-- Product writes already use an authorized RPC. Lock the row while checking
-- the edited fields, then delegate to that same RPC without granting table UPDATE.
create function private.apply_web_inventory_edit(
  p_organization_id uuid, p_product_id text, p_before jsonb, p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.inventory_products%rowtype;
  v_result record;
begin
  if auth.uid() is null or p_organization_id is null or
     (not coalesce(public.auth_is_platform_admin(), false) and
       (p_organization_id is distinct from public.auth_user_org() or not coalesce(public.auth_user_has_permission('canManageInventoryProducts'), false))) then
    raise exception 'Modification de la fiche produit non autorisée.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_before) is distinct from 'object' or jsonb_typeof(p_patch) is distinct from 'object'
     or p_patch - array['reference','designation','barcode','min_stock','location','supplier','photo_url'] <> '{}'::jsonb then
    raise exception 'Modification de la fiche produit invalide.' using errcode = '22023';
  end if;

  select p.* into v_product from public.inventory_products p
  where p.id = p_product_id and p.organization_id = p_organization_id
  for update;
  if not found then raise exception 'Fiche produit inaccessible.' using errcode = '42501'; end if;
  if to_jsonb(v_product) @> p_patch then return to_jsonb(v_product); end if;
  if exists (
    select 1 from jsonb_each(p_patch) e(key, value)
    where (to_jsonb(v_product)->e.key) is distinct from e.value
      and (to_jsonb(v_product)->e.key) is distinct from (p_before->e.key)
  ) then
    raise exception 'La fiche produit a changé entre-temps. La saisie est conservée dans la file.' using errcode = '22023';
  end if;

  select * into v_result from public.update_inventory_product(p_product_id, p_patch);
  if v_result.status is distinct from 'ok' then
    raise exception '%' , coalesce(v_result.message, 'Modification de la fiche produit refusée.')
      using errcode = case when v_result.status = 'forbidden' then '42501' else '22023' end;
  end if;

  select p.* into v_product from public.inventory_products p where p.id = p_product_id and p.organization_id = p_organization_id;
  return to_jsonb(v_product);
end;
$$;

create function public.apply_web_inventory_edit(
  p_organization_id uuid, p_product_id text, p_before jsonb, p_patch jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.apply_web_inventory_edit(p_organization_id, p_product_id, p_before, p_patch);
$$;

revoke all on function private.apply_web_inventory_edit(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function private.apply_web_inventory_edit(uuid, text, jsonb, jsonb) to authenticated;
revoke all on function public.apply_web_inventory_edit(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.apply_web_inventory_edit(uuid, text, jsonb, jsonb) to authenticated;
revoke all on function public.apply_web_reserve_pin(uuid, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.apply_web_reserve_pin(uuid, text, text, uuid, integer, integer) to authenticated;
revoke all on function public.replace_web_plan_file(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.replace_web_plan_file(uuid, text, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
