-- ============================================================
-- BuildTrack — Migration abonnement
-- À exécuter UNE FOIS dans l'éditeur SQL de Supabase
-- (Project Settings > SQL Editor > New Query)
-- Toutes les instructions sont idempotentes (safe à re-exécuter)
-- ============================================================

-- ---- 1. TABLE PLANS ----
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  max_users int not null default 5,
  price_monthly numeric not null default 0,
  features jsonb not null default '[]'
);

alter table public.plans enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'plans' and policyname = 'Plans lisibles par tous les authentifies'
  ) then
    execute 'create policy "Plans lisibles par tous les authentifies" on public.plans for select using (auth.role() = ''authenticated'')';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'plans' and policyname = 'Plans modifiables par super_admin'
  ) then
    execute 'create policy "Plans modifiables par super_admin" on public.plans for all using (
      exists (select 1 from public.profiles where id = auth.uid() and role = ''super_admin'')
    )';
  end if;
end $$;

insert into public.plans (name, max_users, price_monthly, features) values
  ('Starter',   5,  49,  '["Gestion des réserves","Jusqu''à 5 utilisateurs","Support email"]'),
  ('Pro',       20, 149, '["Gestion des réserves","Rapports PDF/Excel","Jusqu''à 20 utilisateurs","Support prioritaire","Pointage & présences"]'),
  ('Entreprise',-1, 399, '["Toutes les fonctionnalités","Utilisateurs illimités","Support dédié","API access","SSO"]')
on conflict (name) do nothing;

-- ---- 2. TABLE ORGANIZATIONS ----
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'organizations' and policyname = 'Organizations lisibles par leurs membres'
  ) then
    execute 'create policy "Organizations lisibles par leurs membres" on public.organizations for select using (
      exists (select 1 from public.profiles where id = auth.uid() and organization_id = public.organizations.id)
      or exists (select 1 from public.profiles where id = auth.uid() and role = ''super_admin'')
    )';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'organizations' and policyname = 'Organizations modifiables par super_admin'
  ) then
    execute 'create policy "Organizations modifiables par super_admin" on public.organizations for all using (
      exists (select 1 from public.profiles where id = auth.uid() and role = ''super_admin'')
    )';
  end if;
end $$;

-- Organisation de démonstration
insert into public.organizations (id, name, slug, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'BuildTrack Demo', 'buildtrack-demo', now())
on conflict (slug) do nothing;

-- ---- 3. COLONNE organization_id DANS PROFILES ----
-- Ajoute la colonne si elle n'existe pas encore
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
    and table_name = 'profiles'
    and column_name = 'organization_id'
  ) then
    alter table public.profiles
    add column organization_id uuid references public.organizations(id);
  end if;
end $$;

-- Lier les utilisateurs démo existants à l'organisation démo
update public.profiles
set organization_id = '00000000-0000-0000-0000-000000000001'
where role != 'super_admin'
and organization_id is null;

-- ---- 4. TABLE SUBSCRIPTIONS ----
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status text not null default 'trial' check (status in ('trial','active','suspended','expired')),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  trial_ends_at timestamptz default (now() + interval '30 days'),
  unique(organization_id)
);

alter table public.subscriptions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'subscriptions' and policyname = 'Subscriptions visibles par membres et super_admin'
  ) then
    execute 'create policy "Subscriptions visibles par membres et super_admin" on public.subscriptions for select using (
      exists (select 1 from public.profiles where id = auth.uid() and organization_id = public.subscriptions.organization_id)
      or exists (select 1 from public.profiles where id = auth.uid() and role = ''super_admin'')
    )';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'subscriptions' and policyname = 'Subscriptions modifiables par super_admin'
  ) then
    execute 'create policy "Subscriptions modifiables par super_admin" on public.subscriptions for all using (
      exists (select 1 from public.profiles where id = auth.uid() and role = ''super_admin'')
    )';
  end if;
end $$;

-- Abonnement Pro (essai 30 jours) pour l'organisation démo
insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
  select
    '00000000-0000-0000-0000-000000000001',
    (select id from public.plans where name = 'Pro'),
    'trial',
    now() + interval '30 days'
  where not exists (
    select 1 from public.subscriptions
    where organization_id = '00000000-0000-0000-0000-000000000001'
  );

-- ---- 5. TABLE INVITATIONS ----
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'observateur',
  invited_by uuid references auth.users(id),
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  status text not null default 'pending' check (status in ('pending','accepted','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

alter table public.invitations enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'invitations' and policyname = 'Invitations visibles par admins'
  ) then
    execute 'create policy "Invitations visibles par admins" on public.invitations for select using (
      exists (
        select 1 from public.profiles
        where id = auth.uid()
        and organization_id = public.invitations.organization_id
        and role in (''admin'',''super_admin'')
      )
    )';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'invitations' and policyname = 'Invitations creables par admins'
  ) then
    execute 'create policy "Invitations creables par admins" on public.invitations for insert with check (
      exists (
        select 1 from public.profiles
        where id = auth.uid()
        and organization_id = public.invitations.organization_id
        and role in (''admin'',''super_admin'')
      )
    )';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'invitations' and policyname = 'Invitations modifiables par admins'
  ) then
    execute 'create policy "Invitations modifiables par admins" on public.invitations for update using (
      exists (
        select 1 from public.profiles
        where id = auth.uid()
        and organization_id = public.invitations.organization_id
        and role in (''admin'',''super_admin'')
      )
    )';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'invitations' and policyname = 'Invitations supprimables par admins'
  ) then
    execute 'create policy "Invitations supprimables par admins" on public.invitations for delete using (
      exists (
        select 1 from public.profiles
        where id = auth.uid()
        and organization_id = public.invitations.organization_id
        and role in (''admin'',''super_admin'')
      )
    )';
  end if;
end $$;

-- ============================================================
-- Vérification finale — doit retourner 4 lignes
-- ============================================================
select table_name, 'OK' as status
from information_schema.tables
where table_schema = 'public'
and table_name in ('plans', 'organizations', 'subscriptions', 'invitations')
order by table_name;
