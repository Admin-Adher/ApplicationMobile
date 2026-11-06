-- Keep the existing free-text location and persist the optional site hierarchy.
set local lock_timeout = '5s';

alter table public.incidents
  add column level text,
  add column zone text;

notify pgrst, 'reload schema';
