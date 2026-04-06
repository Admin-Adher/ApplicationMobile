-- ============================================================
-- BuildTrack — Schéma Supabase complet
-- Idempotent : peut être relancé plusieurs fois sans erreur
-- Coller et exécuter dans l'éditeur SQL de Supabase
-- ============================================================

-- ---- Fonctions d'aide pour les politiques RLS ----
-- SECURITY DEFINER : contournent les politiques RLS de la table
-- profiles lors de leur appel dans d'autres politiques.

create or replace function auth_user_org()
returns uuid
language sql
security definer
stable
as $$
  select organization_id from public.profiles where id = auth.uid()
$$;

create or replace function auth_user_name()
returns text
language sql
security definer
stable
as $$
  select name from public.profiles where id = auth.uid()
$$;

-- ---- RPC : marquer des messages comme lus par un utilisateur ----
-- SECURITY DEFINER : permet à n'importe quel membre authentifié de mettre à jour
-- le tableau read_by des messages qu'il n'a pas envoyés.
create or replace function mark_messages_read_by(p_message_ids text[], p_user_name text)
returns void
language plpgsql
security definer
as $$
begin
  update public.messages
  set read_by = read_by || to_jsonb(array[p_user_name])
  where id = any(p_message_ids)
    and not (read_by @> to_jsonb(array[p_user_name]));
end;
$$;

-- ---- RPC : basculer une réaction emoji sur un message ----
-- Mise à jour atomique — évite les race conditions multi-utilisateur.
create or replace function toggle_message_reaction(p_message_id text, p_emoji text, p_user_name text)
returns void
language plpgsql
security definer
as $$
declare
  v_reactions jsonb;
  v_current   jsonb;
  v_updated   jsonb;
begin
  select reactions into v_reactions
  from public.messages
  where id = p_message_id;

  if v_reactions is null then return; end if;

  v_current := coalesce(v_reactions -> p_emoji, '[]'::jsonb);

  if v_current @> to_jsonb(p_user_name) then
    -- Retirer la réaction
    select coalesce(jsonb_agg(elem), '[]'::jsonb)
    into v_updated
    from jsonb_array_elements_text(v_current) as elem
    where elem <> p_user_name;
  else
    -- Ajouter la réaction
    v_updated := v_current || to_jsonb(p_user_name);
  end if;

  if jsonb_array_length(v_updated) = 0 then
    v_reactions := v_reactions - p_emoji;
  else
    v_reactions := jsonb_set(v_reactions, array[p_emoji], v_updated);
  end if;

  update public.messages
  set reactions = v_reactions
  where id = p_message_id;
end;
$$;

-- ---- 0. TABLES ABONNEMENT (à créer AVANT profiles) ----

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  max_users int not null default 5,
  price_monthly numeric not null default 0,
  features jsonb not null default '[]'
);
alter table public.plans enable row level security;
drop policy if exists "Plans lisibles par tous les authentifiés" on public.plans;
create policy "Plans lisibles par tous les authentifiés"
  on public.plans for select using (auth.role() = 'authenticated');
drop policy if exists "Plans modifiables par super_admin" on public.plans;
create policy "Plans modifiables par super_admin"
  on public.plans for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

insert into public.plans (name, max_users, price_monthly, features) values
  ('Entreprise', -1, 0, '["Utilisateurs illimités","Sous-traitants & observateurs inclus","Réserves, plans, OPR, visites","Rapports PDF/Excel","Pointage & présences","Support dédié","API & intégrations BTP"]')
on conflict (name) do nothing;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;
drop policy if exists "Organizations lisibles par leurs membres" on public.organizations;
create policy "Organizations lisibles par leurs membres"
  on public.organizations for select using (
    exists (select 1 from public.profiles where id = auth.uid() and organization_id = public.organizations.id)
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Organizations modifiables par super_admin" on public.organizations;
create policy "Organizations modifiables par super_admin"
  on public.organizations for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

insert into public.organizations (id, name, slug, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'Organisation Demo', 'organisation-demo', now())
on conflict do nothing;

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
drop policy if exists "Subscriptions visibles par membres et super_admin" on public.subscriptions;
create policy "Subscriptions visibles par membres et super_admin"
  on public.subscriptions for select using (
    exists (select 1 from public.profiles where id = auth.uid() and organization_id = public.subscriptions.organization_id)
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Subscriptions modifiables par super_admin" on public.subscriptions;
create policy "Subscriptions modifiables par super_admin"
  on public.subscriptions for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

insert into public.subscriptions (organization_id, plan_id, status, trial_ends_at)
  select
    '00000000-0000-0000-0000-000000000001',
    (select id from public.plans where name = 'Équipe'),
    'trial',
    now() + interval '30 days'
  where not exists (
    select 1 from public.subscriptions where organization_id = '00000000-0000-0000-0000-000000000001'
  );

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
drop policy if exists "Invitations visibles par admins de l''organisation" on public.invitations;
create policy "Invitations visibles par admins de l''organisation"
  on public.invitations for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and organization_id = public.invitations.organization_id
      and role in ('admin','super_admin')
    )
  );
drop policy if exists "Invitations créables par admins" on public.invitations;
create policy "Invitations créables par admins"
  on public.invitations for insert with check (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and organization_id = public.invitations.organization_id
      and role in ('admin','super_admin')
    )
  );
drop policy if exists "Invitations modifiables par admins" on public.invitations;
create policy "Invitations modifiables par admins"
  on public.invitations for update using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and organization_id = public.invitations.organization_id
      and role in ('admin','super_admin')
    )
  );
drop policy if exists "Invitations supprimables par admins" on public.invitations;
create policy "Invitations supprimables par admins"
  on public.invitations for delete using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and organization_id = public.invitations.organization_id
      and role in ('admin','super_admin')
    )
  );

-- ---- 1. TABLE PROFILES (liée à auth.users) ----
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  role text not null default 'observateur',
  role_label text not null,
  email text not null,
  organization_id uuid references public.organizations(id)
);
alter table public.profiles enable row level security;
drop policy if exists "Profiles visibles par tous les utilisateurs connectés" on public.profiles;
create policy "Profiles visibles par tous les utilisateurs connectés"
  on public.profiles for select using (auth.role() = 'authenticated');
drop policy if exists "Profil créable par son propriétaire" on public.profiles;
create policy "Profil créable par son propriétaire"
  on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "Profil modifiable par son propriétaire" on public.profiles;
create policy "Profil modifiable par son propriétaire"
  on public.profiles for update using (auth.uid() = id);

-- ---- 2. TABLE CHANTIERS ----
create table if not exists public.chantiers (
  id text primary key,
  name text not null,
  address text,
  description text,
  start_date text,
  end_date text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  created_by text,
  organization_id uuid references public.organizations(id) on delete set null
);
alter table public.chantiers add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists idx_chantiers_org on public.chantiers(organization_id);
alter table public.chantiers enable row level security;
drop policy if exists "Chantiers lisibles par tous les authentifiés" on public.chantiers;
drop policy if exists "Chantiers visibles par organisation" on public.chantiers;
create policy "Chantiers visibles par organisation"
  on public.chantiers for select using (
    organization_id = auth_user_org()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Chantiers modifiables par admin/conducteur" on public.chantiers;
drop policy if exists "Chantiers modifiables par admin/conducteur de la même org" on public.chantiers;
create policy "Chantiers modifiables par admin/conducteur de la même org"
  on public.chantiers for all using (
    (
      organization_id = auth_user_org()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 3. TABLE COMPANIES ----
create table if not exists public.companies (
  id text primary key,
  name text not null,
  short_name text not null,
  color text not null,
  planned_workers int not null default 0,
  actual_workers int not null default 0,
  hours_worked int not null default 0,
  zone text not null,
  contact text not null,
  organization_id uuid references public.organizations(id) on delete set null
);
alter table public.companies add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists idx_companies_org on public.companies(organization_id);
alter table public.companies enable row level security;
drop policy if exists "Companies lisibles par tous" on public.companies;
drop policy if exists "Companies visibles par organisation" on public.companies;
create policy "Companies visibles par organisation"
  on public.companies for select using (
    organization_id = auth_user_org()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Companies modifiables par admin/conducteur" on public.companies;
drop policy if exists "Companies modifiables par admin/conducteur de la même org" on public.companies;
create policy "Companies modifiables par admin/conducteur de la même org"
  on public.companies for all using (
    (
      organization_id = auth_user_org()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 3. TABLE RESERVES ----
-- NOTE: `company` (text) is legacy — kept for backward compatibility. Use `companies` (jsonb array) instead.
-- Migration cible : supprimer `company` et ne conserver que `companies` une fois tous les clients migrés.
create table if not exists public.reserves (
  id text primary key,
  title text not null,
  description text not null,
  building text not null,
  zone text not null,
  level text not null,
  company text not null default '',
  priority text not null default 'medium',
  status text not null default 'open',
  created_at text not null,
  deadline text not null default '—',
  comments jsonb not null default '[]',
  history jsonb not null default '[]',
  plan_x int not null default 50,
  plan_y int not null default 50,
  photo_uri text,
  chantier_id text,
  plan_id text,
  lot_id text,
  kind text,
  visite_id text,
  linked_task_id text,
  photos jsonb,
  photo_annotations jsonb,
  enterprise_signature text,
  enterprise_signataire text,
  enterprise_acknowledged_at text,
  closed_at text,
  closed_by text
);
alter table public.reserves add column if not exists chantier_id text;
alter table public.reserves add column if not exists plan_id text;
alter table public.reserves add column if not exists lot_id text;
alter table public.reserves add column if not exists kind text;
alter table public.reserves add column if not exists visite_id text;
alter table public.reserves add column if not exists linked_task_id text;
alter table public.reserves add column if not exists photos jsonb;
alter table public.reserves add column if not exists photo_annotations jsonb;
alter table public.reserves add column if not exists enterprise_signature text;
alter table public.reserves add column if not exists enterprise_signataire text;
alter table public.reserves add column if not exists enterprise_acknowledged_at text;
alter table public.reserves add column if not exists closed_at text;
alter table public.reserves add column if not exists closed_by text;
alter table public.reserves add column if not exists responsable_nom text;
alter table public.reserves add column if not exists companies jsonb;
alter table public.reserves add column if not exists company_signatures jsonb;
alter table public.chantiers add column if not exists company_ids jsonb;
create index if not exists idx_reserves_chantier on public.reserves(chantier_id);
alter table public.reserves enable row level security;
drop policy if exists "Reserves lisibles par tous" on public.reserves;
drop policy if exists "Reserves visibles par organisation" on public.reserves;
create policy "Reserves visibles par organisation"
  on public.reserves for select using (
    exists (
      select 1 from public.chantiers c
      where c.id = reserves.chantier_id and c.organization_id = auth_user_org()
    )
    or (reserves.chantier_id is null and auth_user_org() is not null)
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'sous_traitant' and p.company_id is not null
        and (
          reserves.company = (select name from public.companies where id = p.company_id limit 1)
          or (reserves.companies is not null and reserves.companies::jsonb ? p.company_id)
        )
    )
  );
drop policy if exists "Reserves modifiables (create/edit)" on public.reserves;
drop policy if exists "Reserves modifiables par org" on public.reserves;
create policy "Reserves modifiables par org"
  on public.reserves for all using (
    (
      exists (
        select 1 from public.chantiers c
        where c.id = reserves.chantier_id and c.organization_id = auth_user_org()
      )
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- Sous-traitant peut mettre à jour le statut des réserves de son entreprise (demande de levée + signature)
drop policy if exists "Reserves: sous_traitant peut requêter la levée" on public.reserves;
create policy "Reserves: sous_traitant peut requêter la levée"
  on public.reserves for update using (
    exists (
      select 1 from public.profiles p
      left join public.companies co on co.id = p.company_id
      where p.id = auth.uid()
      and p.role = 'sous_traitant'
      and p.company_id is not null
      and (
        public.reserves.company = co.name
        or (public.reserves.companies is not null
            and public.reserves.companies::jsonb ? p.company_id)
      )
    )
  );

-- ---- 4. TABLE TASKS ----
create table if not exists public.tasks (
  id text primary key,
  title text not null,
  description text not null,
  status text not null default 'todo',
  priority text not null default 'medium',
  start_date text,
  deadline text not null,
  assignee text not null,
  progress int not null default 0,
  company text not null,
  chantier_id text,
  reserve_id text,
  comments jsonb not null default '[]',
  history jsonb not null default '[]',
  created_at text
);
alter table public.tasks add column if not exists chantier_id text;
alter table public.tasks add column if not exists reserve_id text;
alter table public.tasks add column if not exists comments jsonb;
alter table public.tasks add column if not exists history jsonb;
alter table public.tasks add column if not exists created_at text;
create index if not exists idx_tasks_chantier on public.tasks(chantier_id);
alter table public.tasks enable row level security;
drop policy if exists "Tasks lisibles par tous" on public.tasks;
drop policy if exists "Tasks visibles par organisation" on public.tasks;
create policy "Tasks visibles par organisation"
  on public.tasks for select using (
    exists (
      select 1 from public.chantiers c
      where c.id = tasks.chantier_id and c.organization_id = auth_user_org()
    )
    or (tasks.chantier_id is null and auth_user_org() is not null)
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'sous_traitant' and p.company_id is not null
        and tasks.company = (select name from public.companies where id = p.company_id limit 1)
    )
  );
drop policy if exists "Tasks modifiables" on public.tasks;
drop policy if exists "Tasks modifiables par org" on public.tasks;
create policy "Tasks modifiables par org"
  on public.tasks for all using (
    (
      exists (
        select 1 from public.chantiers c
        where c.id = tasks.chantier_id and c.organization_id = auth_user_org()
      )
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 5. TABLE DOCUMENTS ----
create table if not exists public.documents (
  id text primary key,
  name text not null,
  type text not null,
  category text not null,
  uploaded_at text not null,
  size text not null,
  version int not null default 1,
  uri text,
  organization_id uuid references public.organizations(id) on delete set null
);
alter table public.documents add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists idx_documents_org on public.documents(organization_id);
alter table public.documents enable row level security;
drop policy if exists "Documents lisibles par tous" on public.documents;
drop policy if exists "Documents visibles par organisation" on public.documents;
create policy "Documents visibles par organisation"
  on public.documents for select using (
    organization_id = auth_user_org()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Documents modifiables" on public.documents;
drop policy if exists "Documents modifiables par org" on public.documents;
create policy "Documents modifiables par org"
  on public.documents for all using (
    (
      organization_id = auth_user_org()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 6. TABLE PHOTOS ----
create table if not exists public.photos (
  id text primary key,
  comment text not null,
  location text not null,
  taken_at text not null,
  taken_by text not null,
  color_code text not null,
  uri text,
  reserve_id text
);
alter table public.photos add column if not exists reserve_id text;
create index if not exists idx_photos_reserve on public.photos(reserve_id);
alter table public.photos enable row level security;
drop policy if exists "Photos lisibles par tous" on public.photos;
drop policy if exists "Photos visibles par organisation" on public.photos;
create policy "Photos visibles par organisation"
  on public.photos for select using (
    exists (
      select 1 from public.reserves r
      join public.chantiers c on c.id = r.chantier_id
      where r.id = photos.reserve_id and c.organization_id = auth_user_org()
    )
    or (photos.reserve_id is null and auth_user_org() is not null)
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Photos modifiables" on public.photos;
drop policy if exists "Photos modifiables par org" on public.photos;
create policy "Photos modifiables par org"
  on public.photos for all using (
    (
      exists (
        select 1 from public.reserves r
        join public.chantiers c on c.id = r.chantier_id
        where r.id = photos.reserve_id and c.organization_id = auth_user_org()
      )
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or (photos.reserve_id is null and auth_user_org() is not null
        and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe')))
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 7. TABLE MESSAGES ----
create table if not exists public.messages (
  id text primary key,
  channel_id text not null default 'general',
  sender text not null,
  content text not null,
  timestamp text not null,
  type text not null default 'message',
  read boolean not null default false,
  is_me boolean not null default false,
  reply_to_id text,
  reply_to_content text,
  reply_to_sender text,
  attachment_uri text,
  reactions jsonb not null default '{}',
  is_pinned boolean not null default false,
  read_by jsonb not null default '[]',
  mentions jsonb not null default '[]',
  reserve_id text,
  linked_item_type text,
  linked_item_id text,
  linked_item_title text,
  created_at timestamptz not null default now()
);
alter table public.messages add column if not exists linked_item_type text;
alter table public.messages add column if not exists linked_item_id text;
alter table public.messages add column if not exists linked_item_title text;
alter table public.messages add column if not exists created_at timestamptz not null default now();
create index if not exists idx_messages_channel_created_at on public.messages(channel_id, created_at desc);
alter table public.messages enable row level security;
drop policy if exists "Messages lisibles par tous" on public.messages;
drop policy if exists "Messages visibles par membres habilités" on public.messages;
create policy "Messages visibles par membres habilités"
  on public.messages for select
  using (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and (
          (c.type in ('general','building','company','custom') and c.organization_id = auth_user_org())
          or
          (c.type in ('group','dm') and exists (
            select 1 from jsonb_array_elements_text(c.members) as m where m = auth_user_name()
          ))
        )
    )
    or
    (
      messages.channel_id like 'dm-%'
      and not exists (select 1 from public.channels where id = messages.channel_id)
      and auth_user_name() = any(
        string_to_array(substring(messages.channel_id from 4), '__')
      )
    )
  );
drop policy if exists "Messages insertables par authentifiés" on public.messages;
drop policy if exists "Messages insertables par membres habilités" on public.messages;
create policy "Messages insertables par membres habilités"
  on public.messages for insert
  with check (
    sender = auth_user_name()
    and (
      exists (
        select 1 from public.channels c
        where c.id = messages.channel_id
          and (
            (c.type in ('general','building','company','custom') and c.organization_id = auth_user_org())
            or
            (c.type in ('group','dm') and exists (
              select 1 from jsonb_array_elements_text(c.members) as m where m = auth_user_name()
            ))
          )
      )
      or
      (
        messages.channel_id like 'dm-%'
        and auth_user_name() = any(
          string_to_array(substring(messages.channel_id from 4), '__')
        )
      )
    )
  );
drop policy if exists "Messages modifiables" on public.messages;
drop policy if exists "Messages modifiables par expéditeur" on public.messages;
create policy "Messages modifiables par expéditeur"
  on public.messages for all
  using (sender = auth_user_name());

-- ---- 8. TABLE SITE_PLANS ----
create table if not exists public.site_plans (
  id text primary key,
  chantier_id text,
  name text not null,
  building text,
  level text,
  building_id text,
  level_id text,
  uri text,
  file_type text,
  dxf_name text,
  uploaded_at text,
  size text,
  revision_code text,
  revision_number int,
  parent_plan_id text references public.site_plans(id),
  is_latest_revision boolean,
  revision_note text,
  annotations jsonb,
  pdf_page_count int,
  created_at timestamptz not null default now()
);
create index if not exists idx_site_plans_chantier on public.site_plans(chantier_id);
alter table public.site_plans enable row level security;
drop policy if exists "Site plans lisibles par tous" on public.site_plans;
drop policy if exists "Site plans visibles par organisation" on public.site_plans;
create policy "Site plans visibles par organisation"
  on public.site_plans for select using (
    exists (
      select 1 from public.chantiers c
      where c.id = site_plans.chantier_id and c.organization_id = auth_user_org()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Site plans modifiables" on public.site_plans;
drop policy if exists "Site plans modifiables par org" on public.site_plans;
create policy "Site plans modifiables par org"
  on public.site_plans for all using (
    (
      exists (
        select 1 from public.chantiers c
        where c.id = site_plans.chantier_id and c.organization_id = auth_user_org()
      )
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 9. TABLE INCIDENTS ----
create table if not exists public.incidents (
  id text primary key,
  title text not null,
  description text,
  severity text not null,
  location text,
  building text,
  reported_at text not null,
  reported_by text not null,
  status text not null,
  witnesses text,
  actions text,
  closed_at text,
  closed_by text,
  photo_uri text,
  created_at timestamptz not null default now()
);
alter table public.incidents add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists idx_incidents_org on public.incidents(organization_id);
alter table public.incidents enable row level security;
drop policy if exists "Incidents lisibles par tous" on public.incidents;
drop policy if exists "Incidents visibles par organisation" on public.incidents;
create policy "Incidents visibles par organisation"
  on public.incidents for select using (
    organization_id = auth_user_org()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Incidents modifiables" on public.incidents;
drop policy if exists "Incidents modifiables par org" on public.incidents;
create policy "Incidents modifiables par org"
  on public.incidents for all using (
    (
      organization_id = auth_user_org()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 10. TABLE VISITES ----
create table if not exists public.visites (
  id text primary key,
  chantier_id text,
  title text not null,
  date text not null,
  conducteur text not null,
  status text not null,
  building text,
  level text,
  notes text,
  reserve_ids jsonb not null default '[]',
  conducteur_signature text,
  entreprise_signature text,
  signed_at text,
  entreprise_signataire text,
  created_at timestamptz not null default now()
);
create index if not exists idx_visites_chantier on public.visites(chantier_id);
alter table public.visites enable row level security;
drop policy if exists "Visites lisibles par tous" on public.visites;
drop policy if exists "Visites visibles par organisation" on public.visites;
create policy "Visites visibles par organisation"
  on public.visites for select using (
    exists (
      select 1 from public.chantiers c
      where c.id = visites.chantier_id and c.organization_id = auth_user_org()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Visites modifiables" on public.visites;
drop policy if exists "Visites modifiables par org" on public.visites;
create policy "Visites modifiables par org"
  on public.visites for all using (
    (
      exists (
        select 1 from public.chantiers c
        where c.id = visites.chantier_id and c.organization_id = auth_user_org()
      )
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 11. TABLE LOTS ----
create table if not exists public.lots (
  id text primary key,
  code text not null,
  name text not null,
  color text not null,
  chantier_id text,
  company_id text,
  cctp_ref text,
  number int,
  created_at timestamptz not null default now()
);
create index if not exists idx_lots_chantier on public.lots(chantier_id);
alter table public.lots enable row level security;
drop policy if exists "Lots lisibles par tous" on public.lots;
drop policy if exists "Lots visibles par organisation" on public.lots;
create policy "Lots visibles par organisation"
  on public.lots for select using (
    exists (
      select 1 from public.chantiers c
      where c.id = lots.chantier_id and c.organization_id = auth_user_org()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Lots modifiables" on public.lots;
drop policy if exists "Lots modifiables par org" on public.lots;
create policy "Lots modifiables par org"
  on public.lots for all using (
    (
      exists (
        select 1 from public.chantiers c
        where c.id = lots.chantier_id and c.organization_id = auth_user_org()
      )
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 12. TABLE OPRS ----
create table if not exists public.oprs (
  id text primary key,
  chantier_id text,
  title text not null,
  date text not null,
  building text not null,
  level text not null,
  conducteur text not null,
  status text not null,
  items jsonb not null default '[]',
  signed_by text,
  signed_at text,
  maire_ouvrage text,
  conducteur_signature text,
  mo_signature text,
  visit_contradictoire boolean,
  visit_participants jsonb,
  signatories jsonb,
  invited_emails jsonb,
  session_token text,
  created_at timestamptz not null default now()
);
create index if not exists idx_oprs_chantier on public.oprs(chantier_id);
alter table public.oprs enable row level security;
drop policy if exists "OPRs lisibles par tous" on public.oprs;
drop policy if exists "OPRs visibles par organisation" on public.oprs;
create policy "OPRs visibles par organisation"
  on public.oprs for select using (
    exists (
      select 1 from public.chantiers c
      where c.id = oprs.chantier_id and c.organization_id = auth_user_org()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "OPRs modifiables" on public.oprs;
drop policy if exists "OPRs modifiables par org" on public.oprs;
create policy "OPRs modifiables par org"
  on public.oprs for all using (
    (
      exists (
        select 1 from public.chantiers c
        where c.id = oprs.chantier_id and c.organization_id = auth_user_org()
      )
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- 13. TABLE CHANNELS (canaux personnalisés et groupes) ----
create table if not exists public.channels (
  id text primary key,
  name text not null,
  description text,
  icon text not null default 'chatbubbles',
  color text not null default '#10B981',
  type text not null,
  members jsonb not null default '[]',
  created_by text,
  organization_id uuid references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.channels enable row level security;
drop policy if exists "Channels lisibles par tous" on public.channels;
drop policy if exists "Channels visibles par membres habilités" on public.channels;
create policy "Channels visibles par membres habilités"
  on public.channels for select
  using (
    (type in ('general','building','company','custom') and organization_id = auth_user_org())
    or
    (type in ('group','dm') and exists (
      select 1 from jsonb_array_elements_text(members) as m where m = auth_user_name()
    ))
  );
drop policy if exists "Channels modifiables" on public.channels;
drop policy if exists "Channels modifiables par membres habilités" on public.channels;
create policy "Channels modifiables par membres habilités"
  on public.channels for all
  using (
    (type in ('general','building','company','custom') and organization_id = auth_user_org())
    or
    (type in ('group','dm') and (
      created_by = auth_user_name()
      or exists (select 1 from jsonb_array_elements_text(members) as m where m = auth_user_name())
    ))
  );

-- ---- 14. TABLE TIME_ENTRIES (pointage) ----
create table if not exists public.time_entries (
  id text primary key,
  date text not null,
  company_id text,
  company_name text,
  company_color text,
  worker_name text not null,
  arrival_time text not null,
  departure_time text,
  notes text,
  recorded_by text,
  created_at timestamptz not null default now()
);
alter table public.time_entries add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists idx_time_entries_org on public.time_entries(organization_id);
alter table public.time_entries enable row level security;
drop policy if exists "Pointage lisible par tous" on public.time_entries;
drop policy if exists "Pointage visible par organisation" on public.time_entries;
create policy "Pointage visible par organisation"
  on public.time_entries for select using (
    organization_id = auth_user_org()
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );
drop policy if exists "Pointage modifiable" on public.time_entries;
drop policy if exists "Pointage modifiable par org" on public.time_entries;
create policy "Pointage modifiable par org"
  on public.time_entries for all using (
    (
      organization_id = auth_user_org()
      and exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin')
  );

-- ---- COLONNES MANQUANTES — companies ----
alter table public.companies add column if not exists email text;
alter table public.companies add column if not exists lots jsonb;
alter table public.companies add column if not exists siret text;
alter table public.companies add column if not exists insurance text;
alter table public.companies add column if not exists qualifications text;

-- ---- COLONNES MANQUANTES — invitations & profiles ----
alter table public.invitations add column if not exists company_id text;
alter table public.profiles add column if not exists company_id text;
alter table public.profiles add column if not exists last_read_by_channel jsonb not null default '{}';
alter table public.profiles add column if not exists pinned_channels jsonb not null default '[]';

-- ---- POLITIQUES MANQUANTES — profiles ----
-- Permet aux admins de mettre à jour les profils d'autres utilisateurs (updateUserRole)
drop policy if exists "Profil modifiable par admin de la même organisation" on public.profiles;
create policy "Profil modifiable par admin de la même organisation"
  on public.profiles for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.organization_id = public.profiles.organization_id
      and p.role in ('admin', 'super_admin')
    )
  );

-- Permet aux admins de supprimer des profils (deleteUserProfile)
drop policy if exists "Profil supprimable par admin de la même organisation" on public.profiles;
create policy "Profil supprimable par admin de la même organisation"
  on public.profiles for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.organization_id = public.profiles.organization_id
      and p.role in ('admin', 'super_admin')
    )
    or auth.uid() = id
  );

-- ---- POLITIQUE MANQUANTE — subscriptions auto-expiration ----
-- Permet à un membre d'organisation de mettre à jour le statut de son abonnement
-- uniquement pour passer en 'expired' (gestion de l'expiration côté client)
drop policy if exists "Subscriptions auto-expiration par membres" on public.subscriptions;
create policy "Subscriptions auto-expiration par membres"
  on public.subscriptions for update using (
    exists (
      select 1 from public.profiles
      where id = auth.uid()
      and organization_id = public.subscriptions.organization_id
    )
  ) with check (status = 'expired');

-- ---- 15. TABLE REGULATORY_DOCS ----
create table if not exists public.regulatory_docs (
  id text primary key,
  type text not null,
  title text not null,
  company text,
  reference text,
  issue_date text,
  expiry_date text,
  status text not null default 'valid',
  notes text,
  uri text,
  created_at text not null,
  created_by text not null
);
alter table public.regulatory_docs enable row level security;
drop policy if exists "Docs réglementaires lisibles par tous" on public.regulatory_docs;
create policy "Docs réglementaires lisibles par tous"
  on public.regulatory_docs for select using (auth.role() = 'authenticated');
drop policy if exists "Docs réglementaires modifiables" on public.regulatory_docs;
create policy "Docs réglementaires modifiables"
  on public.regulatory_docs for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );

-- ============================================================
-- SEED DATA — Données initiales de démonstration
-- ============================================================

insert into public.companies (id, name, short_name, color, planned_workers, actual_workers, hours_worked, zone, contact) values
('co1', 'BOUYGUES Construction', 'BOUYGUES', '#10B981', 28, 25, 210, 'Bâtiment A', 'Marc Martin — 06 23 45 67 89')
on conflict (id) do nothing;

insert into public.reserves (id, title, description, building, zone, level, company, priority, status, created_at, deadline, plan_x, plan_y, comments, history) values
('RSV-001', 'Fissure mur porteur Niveau 2', 'Fissure diagonale de 3mm visible sur le mur porteur sud du bâtiment A. Nécessite expertise structure urgente.', 'A', 'Zone Sud', 'R+2', 'BOUYGUES Construction', 'critical', 'open', '2025-03-18', '2025-03-25', 18, 28,
  '[{"id":"c1","author":"M. Martin","content":"Expert contacté, RDV lundi matin.","createdAt":"2025-03-19"}]',
  '[{"id":"h1","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-18"}]'),
('RSV-002', 'Défaut étanchéité toiture Bât B', 'Infiltration d''eau détectée au niveau de la jonction toiture/acrotère côté nord. Zone de 2m² concernée.', 'B', 'Zone Nord', 'R+3', 'BOUYGUES Construction', 'high', 'in_progress', '2025-03-15', '2025-03-28', 32, 14,
  '[{"id":"c2","author":"M. Martin","content":"Travaux de reprise planifiés semaine prochaine.","createdAt":"2025-03-20"}]',
  '[{"id":"h2","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-15"},{"id":"h3","action":"Statut modifié","author":"M. Martin","oldValue":"Ouvert","newValue":"En cours","createdAt":"2025-03-18"}]'),
('RSV-003', 'Installation électrique non conforme', 'Câblage électrique non conforme aux normes NFC 15-100 dans le local technique RDC.', 'A', 'Zone Est', 'RDC', 'BOUYGUES Construction', 'high', 'verification', '2025-03-10', '2025-03-22', 68, 72,
  '[{"id":"c3","author":"M. Martin","content":"Reprise effectuée, en attente de contrôle CONSUEL.","createdAt":"2025-03-21"}]',
  '[{"id":"h4","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-10"}]'),
('RSV-004', 'Revêtement sol dégradé Hall C', 'Carrelage fissuré et décollé sur environ 8m² dans le hall principal du bâtiment C. Risque de chute.', 'C', 'Zone Centre', 'RDC', 'BOUYGUES Construction', 'medium', 'waiting', '2025-03-12', '2025-04-02', 26, 58, '[]',
  '[{"id":"h6","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-12"}]'),
('RSV-005', 'Joints façade manquants Bât B', 'Joints de dilatation absents sur la façade ouest, sur une longueur de 12 mètres au niveau R+1.', 'B', 'Zone Ouest', 'R+1', 'BOUYGUES Construction', 'medium', 'open', '2025-03-20', '2025-04-05', 58, 62, '[]',
  '[{"id":"h8","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-20"}]'),
('RSV-006', 'Câblage réseau informatique incomplet', 'Câblage réseau non terminé dans les bureaux 201 à 208. 24 prises RJ45 manquantes.', 'A', 'Zone Nord', 'R+2', 'BOUYGUES Construction', 'low', 'in_progress', '2025-03-17', '2025-03-31', 42, 45,
  '[{"id":"c4","author":"M. Martin","content":"12 prises posées ce jour, reste 12.","createdAt":"2025-03-22"}]',
  '[{"id":"h9","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-17"}]'),
('RSV-007', 'Porte coupe-feu CF60 non installée', 'Porte coupe-feu CF60 manquante au niveau cage escalier bâtiment C. Non-conformité réglementaire ERP.', 'C', 'Zone Est', 'R+1', 'BOUYGUES Construction', 'critical', 'open', '2025-03-21', '2025-03-26', 62, 32, '[]',
  '[{"id":"h11","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-21"}]'),
('RSV-008', 'Peinture façade sud non terminée', 'Peinture façade côté sud bâtiment B non terminée. Il manque environ 30% de la surface totale.', 'B', 'Zone Sud', 'R+2', 'BOUYGUES Construction', 'low', 'closed', '2025-03-05', '2025-03-15', 72, 80,
  '[{"id":"c5","author":"M. Martin","content":"Travaux terminés et validés.","createdAt":"2025-03-15"}]',
  '[{"id":"h12","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-05"}]'),
('RSV-009', 'Escalier de secours Bât A incomplet', 'Main courante escalier de secours côté nord non fixée. Garde-corps à hauteur insuffisante.', 'A', 'Zone Nord', 'R+3', 'BOUYGUES Construction', 'high', 'open', '2025-03-19', '2025-03-30', 82, 22, '[]',
  '[{"id":"h14","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-19"}]'),
('RSV-010', 'Robinetterie non conforme Bât C', 'Mitigeurs thermostatiques non installés dans les sanitaires du niveau 2. Normes EHPAD non respectées.', 'C', 'Zone Ouest', 'R+2', 'BOUYGUES Construction', 'medium', 'verification', '2025-03-13', '2025-03-27', 46, 76,
  '[{"id":"c6","author":"M. Martin","content":"Pose effectuée, vérification en cours.","createdAt":"2025-03-24"}]',
  '[{"id":"h15","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-13"}]')
on conflict (id) do nothing;

insert into public.tasks (id, title, description, status, priority, deadline, assignee, progress, company) values
('t1', 'Coulage dalle béton Bât A Niv. 3', 'Mise en œuvre dalle béton armé C30/37 sur 450m²', 'in_progress', 'high', '2025-03-28', 'BOUYGUES Construction', 75, 'co1'),
('t2', 'Pose menuiseries extérieures Bât B', 'Installation fenêtres et baies vitrées double vitrage', 'todo', 'medium', '2025-04-10', 'BOUYGUES Construction', 0, 'co1'),
('t3', 'Installation réseau électrique Bât A', 'Câblage tableau général + distribution étages', 'in_progress', 'high', '2025-04-05', 'BOUYGUES Construction', 45, 'co1'),
('t4', 'Carrelage halls et couloirs Bât C', 'Pose carrelage grès cérame 60x60 zones communes', 'done', 'low', '2025-03-15', 'BOUYGUES Construction', 100, 'co1'),
('t5', 'Peinture intérieure Bât B', 'Enduit + peinture blanche toutes pièces Bât B', 'delayed', 'medium', '2025-03-20', 'BOUYGUES Construction', 20, 'co1'),
('t6', 'Étanchéité toiture Bât C', 'Mise en œuvre étanchéité bicouche + isolation', 'todo', 'high', '2025-04-15', 'BOUYGUES Construction', 0, 'co1')
on conflict (id) do nothing;

insert into public.documents (id, name, type, category, uploaded_at, size, version) values
('d1', 'Plan Bâtiment A — Niveau RDC', 'plan', 'Plans', '2025-03-01', '4.2 Mo', 3),
('d2', 'Plan Bâtiment A — Niveaux R+1/R+2', 'plan', 'Plans', '2025-03-01', '5.8 Mo', 2),
('d3', 'Plan Bâtiment B — Vue générale', 'plan', 'Plans', '2025-03-05', '3.9 Mo', 2),
('d4', 'Plan Bâtiment C — Niveaux', 'plan', 'Plans', '2025-03-08', '4.5 Mo', 1),
('d5', 'DCE Électricité — Lot 6', 'technical', 'DCE', '2025-02-15', '2.1 Mo', 1),
('d6', 'DCE Plomberie — Lot 8', 'technical', 'DCE', '2025-02-15', '1.8 Mo', 1),
('d7', 'CCTP Gros Œuvre', 'technical', 'DCE', '2025-02-10', '3.2 Mo', 2),
('d8', 'Rapport journalier S12-J1', 'report', 'Rapports', '2025-03-17', '0.8 Mo', 1),
('d9', 'Rapport hebdomadaire Semaine 11', 'report', 'Rapports', '2025-03-14', '1.2 Mo', 1),
('d10', 'PV Réception Phase 1', 'report', 'PV', '2025-03-01', '0.5 Mo', 1),
('d11', 'Fiche technique béton C30/37', 'technical', 'Fiches', '2025-02-20', '0.3 Mo', 1),
('d12', 'Plan évacuation incendie', 'plan', 'Sécurité', '2025-03-10', '1.5 Mo', 2)
on conflict (id) do nothing;

insert into public.photos (id, comment, location, taken_at, taken_by, color_code) values
('p1', 'Fissure mur porteur — vue d''ensemble', 'Bât A, R+2, Zone Sud', '2025-03-18 09:15', 'J. Dupont', '#EF4444'),
('p2', 'Avancement coulage dalle niveau 3', 'Bât A, R+3', '2025-03-22 14:30', 'J. Dupont', '#3B82F6'),
('p3', 'Infiltration toiture bât B', 'Bât B, Toiture', '2025-03-15 11:00', 'M. Martin', '#F59E0B'),
('p4', 'Pose carrelage hall C — terminé', 'Bât C, RDC, Hall', '2025-03-14 16:45', 'S. Leroy', '#10B981'),
('p5', 'Installation tableau électrique TG', 'Bât A, RDC, Local tech.', '2025-03-20 10:00', 'P. Bernard', '#8B5CF6'),
('p6', 'Façade ouest bâtiment B — état actuel', 'Bât B, Façade Ouest', '2025-03-21 09:30', 'M. Martin', '#F97316'),
('p7', 'Joints façade manquants zone R+1', 'Bât B, R+1, Façade', '2025-03-20 15:20', 'J. Dupont', '#EF4444'),
('p8', 'Avancement chantier vue globale', 'Vue générale', '2025-03-22 08:00', 'J. Dupont', '#FF6B2B')
on conflict (id) do nothing;

insert into public.messages (id, channel_id, sender, content, timestamp, type, read, is_me) values
('m1', 'general', 'Système', 'Réserve RSV-001 créée — Fissure mur porteur Niveau 2 [CRITIQUE]', '2025-03-18 08:30', 'notification', true, false),
('m2', 'general', 'Marc Martin', 'Bonjour, les travaux de reprise toiture sont planifiés pour lundi.', '2025-03-20 09:15', 'message', true, false),
('m3', 'general', 'Moi', 'Parfait. N''oubliez pas le rapport photo avant/après.', '2025-03-20 09:22', 'message', true, true),
('m4', 'general', 'Système', 'RSV-003 passée en statut "Vérification" par Paul Bernard', '2025-03-21 14:10', 'notification', true, false),
('m5', 'general', 'Paul Bernard', 'CONSUEL prévu jeudi après-midi pour validation installation électrique bât A.', '2025-03-21 16:00', 'message', false, false),
('m6', 'general', 'Sophie Leroy', 'Attention, la livraison du carrelage prévu lundi est repoussée au mercredi.', '2025-03-22 07:45', 'message', false, false),
('m7', 'general', 'Système', 'RSV-007 créée — Porte coupe-feu CF60 non installée [CRITIQUE]', '2025-03-21 11:30', 'notification', false, false),
('m8', 'general', 'Moi', 'Réunion chantier mercredi 9h30 en base vie. Présence obligatoire des chefs d''équipe.', '2025-03-22 08:15', 'message', true, true)
on conflict (id) do nothing;

-- ============================================================
-- STORAGE — Buckets pour photos et documents
-- ============================================================

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

drop policy if exists "authenticated_upload_photos" on storage.objects;
create policy "authenticated_upload_photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'photos');

drop policy if exists "public_read_photos" on storage.objects;
create policy "public_read_photos"
on storage.objects for select
using (bucket_id = 'photos');

drop policy if exists "authenticated_upload_documents" on storage.objects;
create policy "authenticated_upload_documents"
on storage.objects for insert to authenticated
with check (bucket_id = 'documents');

drop policy if exists "public_read_documents" on storage.objects;
create policy "public_read_documents"
on storage.objects for select
using (bucket_id = 'documents');

-- ============================================================
-- POLITIQUES INSCRIPTION — Permettre la création de compte
-- ============================================================

-- Permettre à tout utilisateur authentifié de créer son organisation
-- (lors de l'inscription d'un nouveau client)
drop policy if exists "Organizations créables par tout utilisateur authentifié" on public.organizations;
create policy "Organizations créables par tout utilisateur authentifié"
  on public.organizations for insert with check (auth.role() = 'authenticated');

-- Permettre à tout utilisateur authentifié de créer un abonnement
-- (lors de l'inscription, l'org vient d'être créée par ce même utilisateur)
drop policy if exists "Subscriptions créables par tout utilisateur authentifié" on public.subscriptions;
create policy "Subscriptions créables par tout utilisateur authentifié"
  on public.subscriptions for insert with check (auth.role() = 'authenticated');

-- Permettre à un utilisateur de lire les invitations où il est invité (par email)
-- Nécessaire pour que linkPendingInvitation fonctionne sans être admin
drop policy if exists "Invitations lisibles par l''invité lui-même" on public.invitations;
create policy "Invitations lisibles par l''invité lui-même"
  on public.invitations for select using (
    email = (select email from public.profiles where id = auth.uid())
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
      and organization_id = public.invitations.organization_id
      and role in ('admin','super_admin')
    )
  );

-- Permettre à un invité de mettre à jour son invitation (passer en 'accepted')
drop policy if exists "Invitations acceptables par l''invité" on public.invitations;
create policy "Invitations acceptables par l''invité"
  on public.invitations for update using (
    email = (select email from public.profiles where id = auth.uid())
    or exists (
      select 1 from public.profiles
      where id = auth.uid()
      and organization_id = public.invitations.organization_id
      and role in ('admin','super_admin')
    )
  );

-- ============================================================
-- MIGRATION PLANS v2 — À exécuter dans le SQL Editor Supabase
-- si votre base existe déjà avec les anciens plans Starter/Pro/Entreprise
-- ============================================================

-- Renommer les anciens plans (si présents) vers les nouveaux noms
-- La condition "and not exists" évite un conflit si le plan cible existe déjà
update public.plans set
  name          = 'Solo',
  max_users     = 3,
  price_monthly = 79,
  features      = '["Gestion des réserves","Jusqu''à 3 utilisateurs actifs","Sous-traitants & observateurs gratuits","Support email"]'
where name = 'Starter'
  and not exists (select 1 from public.plans where name = 'Solo');

update public.plans set
  name          = 'Équipe',
  max_users     = 15,
  price_monthly = 199,
  features      = '["Gestion des réserves","Jusqu''à 15 utilisateurs actifs","Sous-traitants & observateurs gratuits","Rapports PDF/Excel","Pointage & présences","Support prioritaire"]'
where name = 'Pro'
  and not exists (select 1 from public.plans where name = 'Équipe');

update public.plans set
  name          = 'Groupe',
  max_users     = -1,
  price_monthly = 499,
  features      = '["Utilisateurs actifs illimités","Sous-traitants & observateurs gratuits","Toutes les fonctionnalités","Support dédié","API access","SSO"]'
where name = 'Entreprise'
  and not exists (select 1 from public.plans where name = 'Groupe');

-- Insérer les nouveaux plans s'ils n'existent pas encore
insert into public.plans (name, max_users, price_monthly, features) values
  ('Entreprise', -1, 0, '["Utilisateurs illimités","Sous-traitants & observateurs inclus","Réserves, plans, OPR, visites","Rapports PDF/Excel","Pointage & présences","Support dédié","API & intégrations BTP"]')
on conflict (name) do nothing;
