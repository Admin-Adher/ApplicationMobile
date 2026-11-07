-- Executed in the disposable CI catalogue; no production records are written.
begin;
do $$
declare
  edited public.time_entries;
begin
  select * into edited from jsonb_populate_record(null::public.time_entries,
    '{"id":"queued-pointage","updated_by":"Chef de chantier","updated_at":"2026-11-07T16:00:00Z"}'::jsonb);
  if edited.id <> 'queued-pointage' or edited.updated_by <> 'Chef de chantier'
    or edited.updated_at <> '2026-11-07T16:00:00Z'::timestamptz then
    raise exception 'pointage edit metadata not accepted';
  end if;
  select * into edited from jsonb_populate_record(null::public.time_entries,
    '{"id":"queued-pointage","updated_by":null,"updated_at":null}'::jsonb);
  if edited.updated_by is not null or edited.updated_at is not null then
    raise exception 'new pointage null metadata not accepted';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.time_entries'::regclass) then
    raise exception 'pointage tenant RLS disabled';
  end if;
end;
$$;
rollback;
