-- ============================================================
-- BuildTrack — Schéma Supabase complet
-- Coller et exécuter dans l'éditeur SQL de Supabase
-- ============================================================

-- ---- 1. TABLE PROFILES (liée à auth.users) ----
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  name text not null,
  role text not null default 'observateur',
  role_label text not null,
  email text not null
);
alter table public.profiles enable row level security;
create policy "Profiles visibles par tous les utilisateurs connectés"
  on public.profiles for select using (auth.role() = 'authenticated');
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
create policy "Companies lisibles par tous" on public.companies for select using (auth.role() = 'authenticated');
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
  photo_uri text
);
alter table public.reserves enable row level security;
create policy "Reserves lisibles par tous" on public.reserves for select using (auth.role() = 'authenticated');
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
  deadline text not null,
  assignee text not null,
  progress int not null default 0,
  company text not null
);
alter table public.tasks enable row level security;
create policy "Tasks lisibles par tous" on public.tasks for select using (auth.role() = 'authenticated');
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
create policy "Documents lisibles par tous" on public.documents for select using (auth.role() = 'authenticated');
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
  uri text
);
alter table public.photos enable row level security;
create policy "Photos lisibles par tous" on public.photos for select using (auth.role() = 'authenticated');
create policy "Photos modifiables"
  on public.photos for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'conducteur', 'chef_equipe'))
  );

-- ---- 7. TABLE MESSAGES ----
create table if not exists public.messages (
  id text primary key,
  sender text not null,
  content text not null,
  timestamp text not null,
  type text not null default 'message',
  read boolean not null default false,
  is_me boolean not null default false
);
alter table public.messages enable row level security;
create policy "Messages lisibles par tous" on public.messages for select using (auth.role() = 'authenticated');
create policy "Messages modifiables"
  on public.messages for all using (auth.role() = 'authenticated');

-- ============================================================
-- SEED DATA — Données initiales de démonstration
-- ============================================================

insert into public.companies (id, name, short_name, color, planned_workers, actual_workers, hours_worked, zone, contact) values
('co1', 'EIFFAGE Gros Œuvre', 'EIFFAGE', '#3B82F6', 45, 38, 320, 'Bâtiment A', 'Jean Dupont — 06 12 34 56 78'),
('co2', 'BOUYGUES Construction', 'BOUYGUES', '#10B981', 28, 25, 210, 'Bâtiment B', 'Marc Martin — 06 23 45 67 89'),
('co3', 'VINCI Électricité', 'VINCI', '#F59E0B', 15, 12, 98, 'Bât. A + B', 'Paul Bernard — 06 34 56 78 90'),
('co4', 'GECINA Finitions', 'GECINA', '#8B5CF6', 20, 18, 145, 'Bâtiment C', 'Sophie Leroy — 06 45 67 89 01')
on conflict (id) do nothing;

insert into public.reserves (id, title, description, building, zone, level, company, priority, status, created_at, deadline, plan_x, plan_y, comments, history) values
('RSV-001', 'Fissure mur porteur Niveau 2', 'Fissure diagonale de 3mm visible sur le mur porteur sud du bâtiment A. Nécessite expertise structure urgente.', 'A', 'Zone Sud', 'R+2', 'EIFFAGE Gros Œuvre', 'critical', 'open', '2025-03-18', '2025-03-25', 18, 28,
  '[{"id":"c1","author":"J. Dupont","content":"Expert contacté, RDV lundi matin.","createdAt":"2025-03-19"}]',
  '[{"id":"h1","action":"Réserve créée","author":"J. Dupont","createdAt":"2025-03-18"}]'),
('RSV-002', 'Défaut étanchéité toiture Bât B', 'Infiltration d''eau détectée au niveau de la jonction toiture/acrotère côté nord. Zone de 2m² concernée.', 'B', 'Zone Nord', 'R+3', 'BOUYGUES Construction', 'high', 'in_progress', '2025-03-15', '2025-03-28', 32, 14,
  '[{"id":"c2","author":"M. Martin","content":"Travaux de reprise planifiés semaine prochaine.","createdAt":"2025-03-20"}]',
  '[{"id":"h2","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-15"},{"id":"h3","action":"Statut modifié","author":"M. Martin","oldValue":"Ouvert","newValue":"En cours","createdAt":"2025-03-18"}]'),
('RSV-003', 'Installation électrique non conforme', 'Câblage électrique non conforme aux normes NFC 15-100 dans le local technique RDC.', 'A', 'Zone Est', 'RDC', 'VINCI Électricité', 'high', 'verification', '2025-03-10', '2025-03-22', 68, 72,
  '[{"id":"c3","author":"P. Bernard","content":"Reprise effectuée, en attente de contrôle CONSUEL.","createdAt":"2025-03-21"}]',
  '[{"id":"h4","action":"Réserve créée","author":"P. Bernard","createdAt":"2025-03-10"}]'),
('RSV-004', 'Revêtement sol dégradé Hall C', 'Carrelage fissuré et décollé sur environ 8m² dans le hall principal du bâtiment C. Risque de chute.', 'C', 'Zone Centre', 'RDC', 'GECINA Finitions', 'medium', 'waiting', '2025-03-12', '2025-04-02', 26, 58, '[]',
  '[{"id":"h6","action":"Réserve créée","author":"S. Leroy","createdAt":"2025-03-12"}]'),
('RSV-005', 'Joints façade manquants Bât B', 'Joints de dilatation absents sur la façade ouest, sur une longueur de 12 mètres au niveau R+1.', 'B', 'Zone Ouest', 'R+1', 'BOUYGUES Construction', 'medium', 'open', '2025-03-20', '2025-04-05', 58, 62, '[]',
  '[{"id":"h8","action":"Réserve créée","author":"J. Dupont","createdAt":"2025-03-20"}]'),
('RSV-006', 'Câblage réseau informatique incomplet', 'Câblage réseau non terminé dans les bureaux 201 à 208. 24 prises RJ45 manquantes.', 'A', 'Zone Nord', 'R+2', 'VINCI Électricité', 'low', 'in_progress', '2025-03-17', '2025-03-31', 42, 45,
  '[{"id":"c4","author":"P. Bernard","content":"12 prises posées ce jour, reste 12.","createdAt":"2025-03-22"}]',
  '[{"id":"h9","action":"Réserve créée","author":"P. Bernard","createdAt":"2025-03-17"}]'),
('RSV-007', 'Porte coupe-feu CF60 non installée', 'Porte coupe-feu CF60 manquante au niveau cage escalier bâtiment C. Non-conformité réglementaire ERP.', 'C', 'Zone Est', 'R+1', 'GECINA Finitions', 'critical', 'open', '2025-03-21', '2025-03-26', 62, 32, '[]',
  '[{"id":"h11","action":"Réserve créée","author":"S. Leroy","createdAt":"2025-03-21"}]'),
('RSV-008', 'Peinture façade sud non terminée', 'Peinture façade côté sud bâtiment B non terminée. Il manque environ 30% de la surface totale.', 'B', 'Zone Sud', 'R+2', 'BOUYGUES Construction', 'low', 'closed', '2025-03-05', '2025-03-15', 72, 80,
  '[{"id":"c5","author":"M. Martin","content":"Travaux terminés et validés.","createdAt":"2025-03-15"}]',
  '[{"id":"h12","action":"Réserve créée","author":"M. Martin","createdAt":"2025-03-05"}]'),
('RSV-009', 'Escalier de secours Bât A incomplet', 'Main courante escalier de secours côté nord non fixée. Garde-corps à hauteur insuffisante.', 'A', 'Zone Nord', 'R+3', 'EIFFAGE Gros Œuvre', 'high', 'open', '2025-03-19', '2025-03-30', 82, 22, '[]',
  '[{"id":"h14","action":"Réserve créée","author":"J. Dupont","createdAt":"2025-03-19"}]'),
('RSV-010', 'Robinetterie non conforme Bât C', 'Mitigeurs thermostatiques non installés dans les sanitaires du niveau 2. Normes EHPAD non respectées.', 'C', 'Zone Ouest', 'R+2', 'GECINA Finitions', 'medium', 'verification', '2025-03-13', '2025-03-27', 46, 76,
  '[{"id":"c6","author":"S. Leroy","content":"Pose effectuée, vérification en cours.","createdAt":"2025-03-24"}]',
  '[{"id":"h15","action":"Réserve créée","author":"S. Leroy","createdAt":"2025-03-13"}]')
on conflict (id) do nothing;

insert into public.tasks (id, title, description, status, priority, deadline, assignee, progress, company) values
('t1', 'Coulage dalle béton Bât A Niv. 3', 'Mise en œuvre dalle béton armé C30/37 sur 450m²', 'in_progress', 'high', '2025-03-28', 'EIFFAGE Gros Œuvre', 75, 'co1'),
('t2', 'Pose menuiseries extérieures Bât B', 'Installation fenêtres et baies vitrées double vitrage', 'todo', 'medium', '2025-04-10', 'BOUYGUES Construction', 0, 'co2'),
('t3', 'Installation réseau électrique Bât A', 'Câblage tableau général + distribution étages', 'in_progress', 'high', '2025-04-05', 'VINCI Électricité', 45, 'co3'),
('t4', 'Carrelage halls et couloirs Bât C', 'Pose carrelage grès cérame 60x60 zones communes', 'done', 'low', '2025-03-15', 'GECINA Finitions', 100, 'co4'),
('t5', 'Peinture intérieure Bât B', 'Enduit + peinture blanche toutes pièces Bât B', 'delayed', 'medium', '2025-03-20', 'BOUYGUES Construction', 20, 'co2'),
('t6', 'Étanchéité toiture Bât C', 'Mise en œuvre étanchéité bicouche + isolation', 'todo', 'high', '2025-04-15', 'BOUYGUES Construction', 0, 'co2')
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
-- COMPTES DEMO — À exécuter dans Supabase Authentication
-- Les 4 utilisateurs seront créés automatiquement au 1er lancement
-- de l'app via la fonction de seed intégrée.
-- ============================================================
