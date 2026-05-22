alter table public.notification_preferences
  add column if not exists email_admin_updated_at timestamptz,
  add column if not exists email_admin_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists email_admin_action text
    check (email_admin_action is null or email_admin_action in ('disabled', 'enabled'));

create index if not exists idx_notification_preferences_email_admin_updated_at
  on public.notification_preferences (email_admin_updated_at desc)
  where email_admin_updated_at is not null;

notify pgrst, 'reload schema';
