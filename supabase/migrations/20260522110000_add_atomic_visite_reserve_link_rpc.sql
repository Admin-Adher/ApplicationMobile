-- Rattachement atomique reserves <-> visites.
--
-- Objectif:
-- - eviter les demi-synchronisations entre public.visites.reserve_ids
--   et public.reserves.visite_id;
-- - reduire plusieurs PATCH REST en un seul appel RPC PostgREST;
-- - garder l'operation compatible offline: l'app peut la rejouer depuis
--   la file de synchronisation.

create or replace function pg_temp.bt_jsonb_to_text_array(value jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(item order by ordinality), '{}'::text[])
  from jsonb_array_elements_text(
    case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end
  ) with ordinality as items(item, ordinality);
$$;

do $$
declare
  v_udt_name text;
begin
  select c.udt_name
  into v_udt_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'visites'
    and c.column_name = 'reserve_ids';

  if v_udt_name is null then
    alter table public.visites
      add column reserve_ids text[] default '{}'::text[];
  elsif v_udt_name <> '_text' then
    alter table public.visites
      alter column reserve_ids drop default;

    execute 'alter table public.visites alter column reserve_ids type text[] using pg_temp.bt_jsonb_to_text_array(reserve_ids::jsonb)';

    alter table public.visites
      alter column reserve_ids set default '{}'::text[];
  end if;
end;
$$;

update public.visites
set reserve_ids = '{}'::text[]
where reserve_ids is null;

alter table public.reserves
  add column if not exists visite_id text;

create index if not exists idx_visites_reserve_ids_gin
  on public.visites using gin (reserve_ids);

create index if not exists idx_reserves_visite_id
  on public.reserves (visite_id);

create or replace function public.link_reserves_to_visite(
  p_visite_id text,
  p_reserve_ids text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  linked_reserve_ids text[];
  moved_visites integer := 0;
  updated_reserves integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Utilisateur non authentifie' using errcode = '28000';
  end if;

  select coalesce(array_agg(distinct cleaned_id), array[]::text[])
  into linked_reserve_ids
  from (
    select nullif(trim(raw_id), '') as cleaned_id
    from unnest(coalesce(p_reserve_ids, array[]::text[])) as ids(raw_id)
  ) cleaned
  where cleaned_id is not null;

  if coalesce(array_length(linked_reserve_ids, 1), 0) = 0 then
    return jsonb_build_object(
      'visite_id', p_visite_id,
      'reserve_count', 0,
      'moved_visites', 0,
      'updated_reserves', 0
    );
  end if;

  perform 1
  from public.visites
  where id = p_visite_id
  for update;
  if not found then
    raise exception 'Visite introuvable: %', p_visite_id using errcode = 'P0002';
  end if;

  update public.visites v
  set reserve_ids = coalesce((
    select array_agg(distinct existing_id)
    from unnest(coalesce(v.reserve_ids, array[]::text[])) as existing(existing_id)
    where existing_id is not null
      and existing_id <> all(linked_reserve_ids)
  ), array[]::text[])
  where v.id <> p_visite_id
    and coalesce(v.reserve_ids, array[]::text[]) && linked_reserve_ids;

  get diagnostics moved_visites = row_count;

  update public.visites v
  set reserve_ids = coalesce((
    select array_agg(distinct merged_id)
    from unnest(coalesce(v.reserve_ids, array[]::text[]) || linked_reserve_ids) as merged(merged_id)
    where merged_id is not null
  ), array[]::text[])
  where v.id = p_visite_id;

  update public.reserves r
  set visite_id = p_visite_id
  where r.id = any(linked_reserve_ids);

  get diagnostics updated_reserves = row_count;

  if updated_reserves <> array_length(linked_reserve_ids, 1) then
    raise exception 'Une ou plusieurs reserves sont introuvables ou hors perimetre' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'visite_id', p_visite_id,
    'reserve_count', array_length(linked_reserve_ids, 1),
    'moved_visites', moved_visites,
    'updated_reserves', updated_reserves
  );
end;
$function$;

revoke all on function public.link_reserves_to_visite(text, text[]) from public;
grant execute on function public.link_reserves_to_visite(text, text[]) to authenticated;

notify pgrst, 'reload schema';
