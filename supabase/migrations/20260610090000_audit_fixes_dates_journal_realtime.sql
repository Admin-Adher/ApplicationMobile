-- Audit 10/06/2026 — corrections de cohérence des données.
-- 1) Normalisation des dates texte écrites en dd/mm/yyyy (mobile) vers ISO yyyy-mm-dd,
--    pour que les comparaisons (retards, tris) soient fiables des deux côtés.
-- 2) Tables journal_entries et checklists (jusqu'ici stockées uniquement en local
--    sur chaque appareil : invisibles entre apps, perdues à la désinstallation).
-- 3) Activation du realtime sur messages et reserves pour le web.

-- ---- 1. Normalisation deadline (dd/mm/yyyy -> yyyy-mm-dd) ----
update public.reserves
set deadline = substring(deadline, 7, 4) || '-' || substring(deadline, 4, 2) || '-' || substring(deadline, 1, 2)
where deadline ~ '^\d{2}/\d{2}/\d{4}$';

-- Mojibake de la sentinelle « pas d'échéance » déjà observé en production.
update public.reserves
set deadline = '—'
where deadline in ('â€”', '');

-- created_at texte au format FR « dd/mm/yyyy » ou « dd/mm/yyyy hh:mm » -> ISO.
update public.reserves
set created_at = substring(created_at, 7, 4) || '-' || substring(created_at, 4, 2) || '-' || substring(created_at, 1, 2)
  || case when length(created_at) >= 16 then 'T' || substring(created_at, 12, 5) || ':00' else '' end
where created_at ~ '^\d{2}/\d{2}/\d{4}';

-- ---- 2. Journal de chantier et checklists en base ----
create table if not exists public.journal_entries (
  id text primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  chantier_id text,
  entry_date text not null default '',
  weather text not null default '',
  worker_count integer,
  work_done text not null default '',
  materials text not null default '',
  incidents text not null default '',
  observations text not null default '',
  visitors text not null default '',
  author text not null default '',
  author_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_journal_entries_org on public.journal_entries(organization_id);
create index if not exists idx_journal_entries_chantier on public.journal_entries(chantier_id);

alter table public.journal_entries enable row level security;
drop policy if exists "Journal visible par organisation" on public.journal_entries;
create policy "Journal visible par organisation"
  on public.journal_entries for select using (
    organization_id = auth_user_org()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Journal modifiable par org" on public.journal_entries;
create policy "Journal modifiable par org"
  on public.journal_entries for all using (
    (
      organization_id = auth_user_org()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

create table if not exists public.checklists (
  id text primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  chantier_id text,
  title text not null default '',
  items jsonb not null default '[]',
  author text not null default '',
  author_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_checklists_org on public.checklists(organization_id);
create index if not exists idx_checklists_chantier on public.checklists(chantier_id);

alter table public.checklists enable row level security;
drop policy if exists "Checklists visibles par organisation" on public.checklists;
create policy "Checklists visibles par organisation"
  on public.checklists for select using (
    organization_id = auth_user_org()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Checklists modifiables par org" on public.checklists;
create policy "Checklists modifiables par org"
  on public.checklists for all using (
    (
      organization_id = auth_user_org()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 3. Realtime sur messages et reserves ----
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reserves'
    ) then
      alter publication supabase_realtime add table public.reserves;
    end if;
  end if;
end $$;
