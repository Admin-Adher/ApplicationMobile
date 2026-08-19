alter table public.journal_entries
  add column if not exists weather_temp numeric,
  add column if not exists weather_wind numeric,
  add column if not exists weather_code integer,
  add column if not exists weather_description text,
  add column if not exists photo_uri text;
