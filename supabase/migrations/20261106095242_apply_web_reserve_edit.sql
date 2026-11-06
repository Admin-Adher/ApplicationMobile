-- Replay one web form as a single transaction. The existing reserve mutation
-- records the operation ID, checks the version and merges the history.
create function public.apply_web_reserve_edit(
  p_operation_id uuid,
  p_reserve_id text,
  p_base_version bigint,
  p_patch jsonb,
  p_gallery jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reserve public.reserves%rowtype;
  v_result jsonb;
  v_patch jsonb;
  v_visit_id text;
  v_chantier_id text;
  v_photo_id text;
  v_photos jsonb;
  v_company_change boolean;
  v_operation_id text := 'web-edit:' || p_reserve_id || ':' || p_operation_id::text;
  v_request_hash text := encode(sha256(convert_to(jsonb_build_array(p_reserve_id, p_base_version, p_patch, p_gallery)::text, 'UTF8')), 'hex');
begin
  if auth.uid() is null or not coalesce(public.auth_user_has_permission('canEdit'), false) then
    raise exception 'Modification de réserve non autorisée' using errcode = '42501';
  end if;
  if p_operation_id is null or p_base_version is null or jsonb_typeof(p_patch) is distinct from 'object'
     or (p_gallery is not null and (
       jsonb_typeof(p_gallery) is distinct from 'object'
       or jsonb_typeof(p_gallery->'photos') is distinct from 'array'
       or jsonb_typeof(p_gallery->'rows') is distinct from 'array'
       or jsonb_typeof(p_gallery->'remove_ids') is distinct from 'array'
     )) then
    raise exception 'Modification de réserve invalide' using errcode = '22023';
  end if;

  select * into v_reserve
  from public.reserves
  where id = p_reserve_id and organization_id = public.auth_user_org() and deleted_at is null
  for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- On retry, this returns the stored result or a version conflict. The
  -- protected fields must never be replayed onto the newer row.
  if v_reserve.version <> p_base_version then
    return public.apply_reserve_patch(v_operation_id, v_request_hash, p_reserve_id, p_base_version, '{}'::jsonb);
  end if;

  -- Keep the RPC focused on the fields edited by the web form.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
  from jsonb_each(p_patch)
  where key in ('kind', 'title', 'description', 'building', 'building_id', 'zone', 'level', 'level_id',
                'priority', 'deadline', 'plan_id', 'plan_x', 'plan_y', 'lot_id', 'chantier_id', 'history');
  if p_patch ? 'companies' then
    if jsonb_typeof(p_patch->'companies') is distinct from 'array' then
      raise exception 'Entreprises invalides' using errcode = '22023';
    end if;
    if jsonb_array_length(p_patch->'companies') = 0 or exists (
      select 1 from jsonb_array_elements_text(p_patch->'companies') as selected(name)
      where not exists (
        select 1 from public.companies c where c.organization_id = v_reserve.organization_id and c.name = selected.name
      )
    ) then
      raise exception 'Entreprise indisponible dans cette organisation' using errcode = '22023';
    end if;
    v_patch := v_patch || jsonb_build_object('companies', p_patch->'companies', 'company', p_patch->'companies'->>0);
  end if;

  v_visit_id := case when p_patch ? 'visite_id' then nullif(p_patch->>'visite_id', '') else v_reserve.visite_id end;
  v_chantier_id := case when v_patch ? 'chantier_id' then nullif(v_patch->>'chantier_id', '') else v_reserve.chantier_id end;
  if v_visit_id is not null and (v_visit_id is distinct from v_reserve.visite_id or v_chantier_id is distinct from v_reserve.chantier_id) and not exists (
    select 1 from public.visites v where v.id = v_visit_id
      and v.organization_id = v_reserve.organization_id and v.chantier_id is not distinct from v_chantier_id
  ) then
    raise exception 'La visite doit appartenir au chantier de la réserve' using errcode = '22023';
  end if;

  v_result := public.apply_reserve_patch(v_operation_id, v_request_hash, p_reserve_id, p_base_version, v_patch);
  if v_result->>'status' is distinct from 'ok' then
    return v_result;
  end if;

  if p_gallery is not null then
    v_photos := p_gallery->'photos';
    if exists (
      select 1 from jsonb_array_elements(v_photos) as photo(item)
      where coalesce(item->>'uri', '') = '' or (
        item->>'uri' !~* '^btmedia://'
        and item->>'uri' is distinct from v_reserve.photo_uri
        and not exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(v_reserve.photos) = 'array' then v_reserve.photos else '[]'::jsonb end
          ) as old_photo(old_item)
          where old_item->>'uri' = item->>'uri'
        )
        and not exists (
          select 1 from public.photos p
          where p.reserve_id = p_reserve_id and p.organization_id = v_reserve.organization_id
            and p.deleted_at is null and p.uri = item->>'uri'
        ))
    ) then
      raise exception 'Une photo de réserve doit être téléversée avant la synchronisation' using errcode = '22023';
    end if;

    for v_photo_id in
      select p.id from public.photos p
      where p.reserve_id = p_reserve_id and p.organization_id = v_reserve.organization_id and p.deleted_at is null
        and p_gallery->'remove_ids' ? p.id
      order by p.id
    loop
      perform public.soft_delete_photo(v_photo_id, 'reserve_gallery_reconciliation_web');
    end loop;

    -- The private-media triggers check the organization and asset state.
    update public.photos p
    set uri = photo.item->>'uri'
    from jsonb_array_elements(v_photos) as photo(item)
    where p.reserve_id = p_reserve_id and p.organization_id = v_reserve.organization_id and p.deleted_at is null
      and p.id = photo.item->>'id' and p.uri is distinct from photo.item->>'uri';

    insert into public.photos (id, comment, location, taken_at, taken_by, color_code, uri, reserve_id, organization_id)
    select row.id, row.comment, row.location, row.taken_at, row.taken_by, row.color_code, row.uri,
           p_reserve_id, v_reserve.organization_id
    from jsonb_populate_recordset(null::public.photos, p_gallery->'rows') as row
    where exists (
      select 1 from jsonb_array_elements(v_photos) as photo(item)
      where item->>'id' = row.id and item->>'uri' = row.uri
    );
  end if;

  v_company_change := v_patch ? 'companies' and (
    v_reserve.companies is distinct from v_patch->'companies'
    or v_reserve.company is distinct from v_patch->>'company'
  );
  update public.reserves
  set photos = case when p_gallery is not null then nullif(v_photos, '[]'::jsonb) else photos end,
      photo_uri = case when p_gallery is not null then v_photos->0->>'uri' else photo_uri end,
      enterprise_signature = case when v_company_change then null else enterprise_signature end,
      enterprise_signataire = case when v_company_change then null else enterprise_signataire end,
      enterprise_acknowledged_at = case when v_company_change then null else enterprise_acknowledged_at end,
      company_signatures = case when v_company_change then null else company_signatures end,
      version = version + 1
  where id = p_reserve_id and organization_id = v_reserve.organization_id;
  if not found then
    raise exception 'Modification de réserve non autorisée' using errcode = '42501';
  end if;

  if v_visit_id is distinct from v_reserve.visite_id then
    if v_visit_id is not null then
      perform public.link_reserves_to_visite(v_visit_id, array[p_reserve_id]);
    elsif v_reserve.visite_id is not null then
      perform public.unlink_reserves_from_visite(v_reserve.visite_id, array[p_reserve_id]);
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.apply_web_reserve_edit(uuid, text, bigint, jsonb, jsonb) from public, anon;
grant execute on function public.apply_web_reserve_edit(uuid, text, bigint, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
