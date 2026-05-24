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
