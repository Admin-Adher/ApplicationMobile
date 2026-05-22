create table if not exists public.email_notification_log (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  recipient_email text not null,
  reserve_id text,
  event_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.email_notification_log enable row level security;

create unique index if not exists email_notification_log_dedupe_idx
  on public.email_notification_log (
    notification_type,
    lower(recipient_email),
    event_key,
    coalesce(reserve_id, '')
  );

create index if not exists email_notification_log_created_at_idx
  on public.email_notification_log (created_at desc);

revoke all on table public.email_notification_log from anon, authenticated;

notify pgrst, 'reload schema';
