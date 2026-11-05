create table public.organization_webhook_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('make', 'n8n')),
  encrypted_url text not null,
  configured_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  last_tested_at timestamptz,
  last_sent_at timestamptz
);

alter table public.organization_webhook_connections enable row level security;
revoke all on public.organization_webhook_connections from public, anon, authenticated;
grant select, insert, update, delete on public.organization_webhook_connections to service_role;
notify pgrst, 'reload schema';
