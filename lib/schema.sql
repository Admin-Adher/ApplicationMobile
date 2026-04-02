-- ============================================================
-- BuildTrack — Schéma Supabase complet
-- Idempotent : peut être relancé plusieurs fois sans erreur
-- Coller et exécuter dans l'éditeur SQL de Supabase
-- ============================================================

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
  ('Starter',   5,  49,  '["Gestion des réserves","Jusqu''à 5 utilisateurs","Support email"]'),
  ('Pro',       20, 149, '["Gestion des réserves","Rapports PDF/Excel","Jusqu''à 20 utilisateurs","Support prioritaire","Pointage & présences"]'),
  ('Entreprise',-1, 399, '["Toutes les fonctionnalités","Utilisateurs illimités","Support dédié","API access","SSO"]')
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
  ('00000000-0000-0000-0000-000000000001', 'BuildTrack Demo', 'buildtrack-demo', now())
on conflict (slug) do nothing;

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
    (select id from public.plans where name = 'Pro'),
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

-- ---- 2. TABLE COMPANIES ----
create table if not exists public.companies (
  id text primary key,
  name text not null,
  short_name text not null,
  color text not null,
  planned_workers int not null default 0,
  actual_workers int not null default 0,
  hours_worked int not null default 0,
  zone text not null,
  contact text not null
);
alter table public.companies enable row level security;
drop policy if exists "Companies lisibles par tous" on public.companies;
create policy "Companies lisibles par tous" on public.companies for select using (auth.role() = 'authenticated');
drop policy if exists "Companies modifiables par admin/conducteur" on public.companies;
create policy "Companies modifiables par admin/conducteur"
  on public.companies for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur'))
  );

-- ---- 3. TABLE RESERVES ----
create table if not exists public.reserves (
  id text primary key,
  title text not null,
  description text not null,
  building text not null,
  zone text not null,
  level text not null,
  company text not null,
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
alter table public.reserves enable row level security;
drop policy if exists "Reserves lisibles par tous" on public.reserves;
create policy "Reserves lisibles par tous" on public.reserves for select using (auth.role() = 'authenticated');
drop policy if exists "Reserves modifiables (create/edit)" on public.reserves;
create policy "Reserves modifiables (create/edit)"
  on public.reserves for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
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
alter table public.tasks enable row level security;
drop policy if exists "Tasks lisibles par tous" on public.tasks;
create policy "Tasks lisibles par tous" on public.tasks for select using (auth.role() = 'authenticated');
drop policy if exists "Tasks modifiables" on public.tasks;
create policy "Tasks modifiables"
  on public.tasks for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
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
  uri text
);
alter table public.documents enable row level security;
drop policy if exists "Documents lisibles par tous" on public.documents;
create policy "Documents lisibles par tous" on public.documents for select using (auth.role() = 'authenticated');
drop policy if exists "Documents modifiables" on public.documents;
create policy "Documents modifiables"
  on public.documents for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
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
alter table public.photos enable row level security;
drop policy if exists "Photos lisibles par tous" on public.photos;
create policy "Photos lisibles par tous" on public.photos for select using (auth.role() = 'authenticated');
drop policy if exists "Photos modifiables" on public.photos;
create policy "Photos modifiables"
  on public.photos for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
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
  reserve_id text
);
alter table public.messages enable row level security;
drop policy if exists "Messages lisibles par tous" on public.messages;
create policy "Messages lisibles par tous" on public.messages for select using (auth.role() = 'authenticated');
drop policy if exists "Messages modifiables" on public.messages;
create policy "Messages modifiables"
  on public.messages for all using (auth.role() = 'authenticated');

-- ---- 8. TABLE SITE_PLANS ----
create table if not exists public.site_plans (
  id text primary key,
  chantier_id text,
  name text not null,
  building text,
  level text,
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
alter table public.site_plans enable row level security;
drop policy if exists "Site plans lisibles par tous" on public.site_plans;
create policy "Site plans lisibles par tous"
  on public.site_plans for select using (auth.role() = 'authenticated');
drop policy if exists "Site plans modifiables" on public.site_plans;
create policy "Site plans modifiables"
  on public.site_plans for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
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

insert into public.messages (id, sender, content, timestamp, type, read, is_me) values
('m1', 'Système', 'Réserve RSV-001 créée — Fissure mur porteur Niveau 2 [CRITIQUE]', '2025-03-18 08:30', 'notification', true, false),
('m2', 'Marc Martin', 'Bonjour, les travaux de reprise toiture sont planifiés pour lundi.', '2025-03-20 09:15', 'message', true, false),
('m3', 'Moi', 'Parfait. N''oubliez pas le rapport photo avant/après.', '2025-03-20 09:22', 'message', true, true),
('m4', 'Système', 'RSV-003 passée en statut "Vérification" par Paul Bernard', '2025-03-21 14:10', 'notification', true, false),
('m5', 'Paul Bernard', 'CONSUEL prévu jeudi après-midi pour validation installation électrique bât A.', '2025-03-21 16:00', 'message', false, false),
('m6', 'Sophie Leroy', 'Attention, la livraison du carrelage prévu lundi est repoussée au mercredi.', '2025-03-22 07:45', 'message', false, false),
('m7', 'Système', 'RSV-007 créée — Porte coupe-feu CF60 non installée [CRITIQUE]', '2025-03-21 11:30', 'notification', false, false),
('m8', 'Moi', 'Réunion chantier mercredi 9h30 en base vie. Présence obligatoire des chefs d''équipe.', '2025-03-22 08:15', 'message', true, true)
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
