create table public.web_push_subscriptions (
  endpoint_hash text primary key check (endpoint_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subscription jsonb not null check (jsonb_typeof(subscription) = 'object'),
  updated_at timestamptz not null default now()
);

create index web_push_subscriptions_org_user_idx on public.web_push_subscriptions (organization_id, user_id);
alter table public.web_push_subscriptions enable row level security;
revoke all on table public.web_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.web_push_subscriptions to service_role;
notify pgrst, 'reload schema';
