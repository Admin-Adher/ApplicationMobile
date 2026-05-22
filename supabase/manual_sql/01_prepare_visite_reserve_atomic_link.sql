alter table public.visites
  add column if not exists reserve_ids text[] default '{}'::text[];

alter table public.reserves
  add column if not exists visite_id text;

create index if not exists idx_visites_reserve_ids_gin
  on public.visites using gin (reserve_ids);

create index if not exists idx_reserves_visite_id
  on public.reserves (visite_id);
