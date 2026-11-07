-- Keep compatibility with the installed 1.2.4 clients and their queued pointages.
-- These optional display fields do not grant permissions or replace recorded_by.
alter table public.time_entries
  add column if not exists updated_by text,
  add column if not exists updated_at timestamptz;

comment on column public.time_entries.updated_by is 'Display name of the last editor, supplied by the client.';
comment on column public.time_entries.updated_at is 'Time of the last edit, supplied by the client.';

notify pgrst, 'reload schema';
