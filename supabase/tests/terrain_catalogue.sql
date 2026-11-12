-- Extend the disposable catalogue with existing production columns. Apply the
-- actual production triggers/RPCs unchanged after this fixture.
alter table public.visites
  add column title text not null default '', add column date text not null default '',
  add column conducteur text not null default '', add column status text not null default 'planned',
  add column start_time text, add column end_time text, add column visit_type text,
  add column concerned_company_ids jsonb, add column visited_locations jsonb default '[]',
  add column building text, add column level text, add column zone text, add column notes text,
  add column tags jsonb default '[]', add column checklist_items jsonb default '[]',
  add column reserve_deadline_date text, add column conducteur_signature text, add column entreprise_signature text,
  add column signed_at text, add column entreprise_signataire text, add column participants jsonb,
  add column reserve_ids text[] not null default '{}', add column created_at timestamptz not null default now();
alter table public.oprs
  add column title text not null default '', add column date text not null default '',
  add column building text not null default '', add column level text not null default '', add column zone text,
  add column conducteur text not null default '', add column status text not null default 'draft',
  add column items jsonb not null default '[]', add column signed_by text, add column signed_at text,
  add column maire_ouvrage text, add column conducteur_signature text, add column mo_signature text,
  add column visit_contradictoire boolean, add column visit_participants jsonb, add column signatories jsonb,
  add column invited_emails jsonb, add column session_token text, add column created_at timestamptz not null default now();
alter table public.reserves
  add column status text not null default 'open', add column title text not null default '',
  add column closed_at text, add column closed_by text, add column history jsonb default '[]',
  add column deleted_at timestamptz, add column deleted_by text;
alter table public.reserve_status_events
  add column from_status text, add column to_status text, add column actor_id uuid,
  add column actor_name text, add column reason text, add column occurred_at timestamptz,
  add column created_at timestamptz default now(), add column operation_id text,
  add column request_hash text, add column closed_at text, add column closed_by text,
  add column history_entry jsonb;
