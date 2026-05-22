create or replace function public.link_reserves_to_visite(
  p_visite_id text,
  p_reserve_ids text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $bt_rpc$
declare
  v_reserve_ids text[];
  v_org_id public.visites.organization_id%type;
  v_chantier_id public.visites.chantier_id%type;
  v_expected_count integer;
  v_moved_visites integer := 0;
  v_updated_reserves integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Utilisateur non authentifie' using errcode = '28000';
  end if;

  if public.auth_user_role() not in ('admin', 'conducteur', 'chef_equipe', 'super_admin') then
    raise exception 'Permission refusee' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct cleaned_id), array[]::text[])
  into v_reserve_ids
  from (
    select nullif(trim(raw_id), '') as cleaned_id
    from unnest(coalesce(p_reserve_ids, array[]::text[])) as ids(raw_id)
  ) cleaned
  where cleaned_id is not null;

  if coalesce(array_length(v_reserve_ids, 1), 0) = 0 then
    return jsonb_build_object('visite_id', p_visite_id, 'reserve_count', 0, 'moved_visites', 0, 'updated_reserves', 0);
  end if;

  select v.organization_id, v.chantier_id
  into v_org_id, v_chantier_id
  from public.visites v
  where v.id = p_visite_id
  for update;

  if not found then
    raise exception 'Visite introuvable: %', p_visite_id using errcode = 'P0002';
  end if;

  if public.auth_user_role() <> 'super_admin'
     and not (
       v_org_id = public.auth_user_org()
       or exists (
         select 1
         from public.chantiers c
         where c.id = v_chantier_id
           and c.organization_id = public.auth_user_org()
       )
     ) then
    raise exception 'Visite hors organisation' using errcode = '42501';
  end if;

  select count(*)
  into v_expected_count
  from public.reserves r
  where r.id = any(v_reserve_ids)
    and (
      public.auth_user_role() = 'super_admin'
      or r.organization_id = public.auth_user_org()
      or exists (
        select 1
        from public.chantiers c
        where c.id = r.chantier_id
          and c.organization_id = public.auth_user_org()
      )
    )
    and (
      v_chantier_id is null
      or r.chantier_id is null
      or r.chantier_id = v_chantier_id
    );

  if v_expected_count <> array_length(v_reserve_ids, 1) then
    raise exception 'Une ou plusieurs reserves sont introuvables ou hors perimetre' using errcode = '42501';
  end if;

  update public.visites v
  set reserve_ids = coalesce((
    select array_agg(distinct existing_id)
    from unnest(coalesce(v.reserve_ids, array[]::text[])) as existing(existing_id)
    where existing_id is not null
      and existing_id <> all(v_reserve_ids)
  ), array[]::text[])
  where v.id <> p_visite_id
    and coalesce(v.reserve_ids, array[]::text[]) && v_reserve_ids
    and (
      public.auth_user_role() = 'super_admin'
      or v.organization_id = public.auth_user_org()
      or exists (
        select 1
        from public.chantiers c
        where c.id = v.chantier_id
          and c.organization_id = public.auth_user_org()
      )
    );

  get diagnostics v_moved_visites = row_count;

  update public.visites v
  set reserve_ids = coalesce((
    select array_agg(distinct merged_id)
    from unnest(coalesce(v.reserve_ids, array[]::text[]) || v_reserve_ids) as merged(merged_id)
    where merged_id is not null
  ), array[]::text[])
  where v.id = p_visite_id;

  update public.reserves r
  set visite_id = p_visite_id
  where r.id = any(v_reserve_ids)
    and (
      public.auth_user_role() = 'super_admin'
      or r.organization_id = public.auth_user_org()
      or exists (
        select 1
        from public.chantiers c
        where c.id = r.chantier_id
          and c.organization_id = public.auth_user_org()
      )
    );

  get diagnostics v_updated_reserves = row_count;

  return jsonb_build_object(
    'visite_id', p_visite_id,
    'reserve_count', array_length(v_reserve_ids, 1),
    'moved_visites', v_moved_visites,
    'updated_reserves', v_updated_reserves
  );
end;
$bt_rpc$;

revoke all on function public.link_reserves_to_visite(text, text[]) from public;
grant execute on function public.link_reserves_to_visite(text, text[]) to authenticated;

notify pgrst, 'reload schema';
