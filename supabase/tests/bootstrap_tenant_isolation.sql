\set ON_ERROR_STOP on

-- Minimal disposable Supabase-compatible catalogue used by the CI isolation
-- matrix. Production migrations are applied unchanged on top of this schema.
-- It intentionally grants broad legacy access first: the restrictive policies
-- under test must be what prevents tenant A from reaching tenant B.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

create schema if not exists auth;
create schema if not exists storage;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
$$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.companies (
  id text primary key,
  organization_id uuid references public.organizations(id),
  name text not null default ''
);

create table public.profiles (
  id uuid primary key references auth.users(id),
  name text not null,
  email text not null,
  role text not null default 'observateur',
  role_label text not null default 'Observer',
  organization_id uuid references public.organizations(id),
  company_id text,
  permissions_override jsonb not null default '{}'::jsonb,
  last_read_by_channel jsonb not null default '{}'::jsonb,
  pinned_channels jsonb not null default '[]'::jsonb,
  preferred_language text
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price_monthly numeric not null default 0
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  plan_id uuid references public.plans(id),
  status text not null default 'active',
  started_at timestamptz not null default now()
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  email text not null,
  role text not null,
  company_id text,
  invited_by uuid references auth.users(id),
  token text not null unique default gen_random_uuid()::text,
  status text not null default 'pending',
  expires_at timestamptz not null default now() + interval '7 days',
  resend_count integer not null default 0,
  last_resent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.channels (
  id text primary key,
  organization_id uuid references public.organizations(id),
  name text not null default '',
  type text not null default 'general',
  created_by text,
  members jsonb not null default '[]'::jsonb
);

create table public.chantiers (
  id text primary key,
  organization_id uuid references public.organizations(id),
  name text not null default ''
);

create table public.tasks (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text,
  reserve_id text
);

create table public.lots (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text,
  company_id text
);

create table public.site_plans (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text,
  parent_plan_id text,
  replaced_by_plan_id text,
  uri text
);

create table public.visites (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text,
  default_plan_id text,
  cover_photo_uri text
);

create table public.reserves (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text,
  plan_id text,
  visite_id text,
  linked_task_id text,
  lot_id text,
  photo_uri text,
  photos jsonb not null default '[]'::jsonb
);

create table public.photos (
  id text primary key,
  organization_id uuid references public.organizations(id),
  reserve_id text,
  uri text
);

create table public.documents (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text,
  uri text
);

create table public.messages (
  id text primary key,
  organization_id uuid references public.organizations(id),
  channel_id text not null,
  sender text not null default '',
  content text not null default '',
  timestamp text not null default '',
  created_at timestamptz not null default now(),
  type text not null default 'text',
  reactions jsonb not null default '{}'::jsonb,
  is_pinned boolean not null default false,
  read_by jsonb not null default '[]'::jsonb,
  attachment_uri text
);

create table public.incidents (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text,
  photo_uri text
);

create table public.regulatory_docs (
  id text primary key,
  organization_id uuid references public.organizations(id),
  uri text
);

create table public.oprs (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text
);

create table public.checklists (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text
);

create table public.journal_entries (
  id text primary key,
  organization_id uuid references public.organizations(id),
  chantier_id text
);

create table public.inventory_products (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  chantier_id text not null,
  photo_url text
);

create table public.inventory_movements (
  id text primary key,
  organization_id uuid not null references public.organizations(id),
  chantier_id text not null,
  product_id text not null,
  company_id text
);

create table public.time_entries (
  id text primary key,
  organization_id uuid references public.organizations(id),
  company_id text,
  task_id text
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  user_id uuid references auth.users(id)
);

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  user_id uuid references auth.users(id)
);

create table public.data_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id)
);

create table public.reserve_status_events (
  id text primary key,
  reserve_id text not null
);

create table storage.buckets (
  id text primary key,
  public boolean not null default false
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  owner_id uuid,
  unique (bucket_id, name)
);

insert into storage.buckets(id, public)
values ('photos', true), ('documents', true);

create or replace function public.delete_organization(p_organization_id uuid)
returns boolean language sql as $$ select false $$;
create or replace function public.check_pending_invitation(p_email text)
returns boolean language sql as $$ select false $$;

-- Broad pre-hardening privileges and permissive policies reproduce the legacy
-- condition. The production migrations must add the fail-closed boundary.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'channels', 'chantiers', 'checklists', 'companies', 'data_audit_log',
    'documents', 'incidents', 'inventory_movements', 'inventory_products',
    'journal_entries', 'lots', 'messages', 'notification_preferences', 'oprs',
    'photos', 'profiles', 'push_tokens', 'regulatory_docs', 'reserves',
    'site_plans', 'subscriptions', 'tasks', 'time_entries', 'visites',
    'invitations'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format(
      'create policy fixture_legacy_all on public.%I for all to public '
      'using (true) with check (true)',
      v_table
    );
    execute format(
      'grant select, insert, update, delete on public.%I to anon, authenticated',
      v_table
    );
  end loop;
end
$$;

alter table storage.objects enable row level security;
create policy fixture_legacy_storage_all
  on storage.objects for all to public using (true) with check (true);
grant select, insert, update, delete on storage.objects to anon, authenticated;

-- Deterministic A/B fixtures.
insert into auth.users(id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'a@example.test', '{"full_name":"User A"}'),
  ('20000000-0000-4000-8000-000000000002', 'b@example.test', '{"full_name":"User B"}'),
  ('30000000-0000-4000-8000-000000000003', 'none@example.test', '{"full_name":"No Tenant"}');

insert into public.organizations(id, name, slug) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Tenant A', 'tenant-a'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Tenant B', 'tenant-b');

insert into public.companies(id, organization_id, name) values
  ('company-a', 'aaaaaaaa-0000-4000-8000-000000000001', 'Company A'),
  ('company-b', 'bbbbbbbb-0000-4000-8000-000000000002', 'Company B');

insert into public.profiles(
  id, name, email, role, role_label, organization_id, company_id
) values
  ('10000000-0000-4000-8000-000000000001', 'User A', 'a@example.test', 'admin', 'Administrator', 'aaaaaaaa-0000-4000-8000-000000000001', 'company-a'),
  ('20000000-0000-4000-8000-000000000002', 'User B', 'b@example.test', 'admin', 'Administrator', 'bbbbbbbb-0000-4000-8000-000000000002', 'company-b'),
  ('30000000-0000-4000-8000-000000000003', 'No Tenant', 'none@example.test', 'observateur', 'Observer', null, null);

insert into public.chantiers(id, organization_id, name) values
  ('chantier-a', 'aaaaaaaa-0000-4000-8000-000000000001', 'Chantier A'),
  ('chantier-b', 'bbbbbbbb-0000-4000-8000-000000000002', 'Chantier B');

insert into public.reserves(id, organization_id, chantier_id) values
  ('reserve-a', 'aaaaaaaa-0000-4000-8000-000000000001', 'chantier-a'),
  ('reserve-b', 'bbbbbbbb-0000-4000-8000-000000000002', 'chantier-b');

insert into public.channels(id, organization_id, name, members) values
  ('channel-a', 'aaaaaaaa-0000-4000-8000-000000000001', 'General A', '["User A"]'),
  ('channel-b', 'bbbbbbbb-0000-4000-8000-000000000002', 'General B', '["User B"]');
