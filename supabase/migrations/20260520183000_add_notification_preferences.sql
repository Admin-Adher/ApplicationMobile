-- User notification preferences for app alerts, push notifications and emails.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  in_app_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  messages_in_app boolean NOT NULL DEFAULT true,
  messages_push boolean NOT NULL DEFAULT true,
  messages_email boolean NOT NULL DEFAULT false,
  reserve_created_in_app boolean NOT NULL DEFAULT true,
  reserve_created_push boolean NOT NULL DEFAULT true,
  reserve_created_email boolean NOT NULL DEFAULT true,
  reserve_status_in_app boolean NOT NULL DEFAULT true,
  reserve_status_push boolean NOT NULL DEFAULT true,
  reserve_status_email boolean NOT NULL DEFAULT true,
  reserve_critical_in_app boolean NOT NULL DEFAULT true,
  reserve_critical_push boolean NOT NULL DEFAULT true,
  reserve_critical_email boolean NOT NULL DEFAULT true,
  reserve_overdue_in_app boolean NOT NULL DEFAULT true,
  reserve_overdue_push boolean NOT NULL DEFAULT true,
  reserve_overdue_email boolean NOT NULL DEFAULT true,
  due_soon_in_app boolean NOT NULL DEFAULT true,
  task_late_in_app boolean NOT NULL DEFAULT true,
  critical_always_push boolean NOT NULL DEFAULT true,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start text NOT NULL DEFAULT '19:00'
    CHECK (quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_hours_end text NOT NULL DEFAULT '07:00'
    CHECK (quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_hours_timezone text NOT NULL DEFAULT 'Europe/Paris',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notification preferences visibles par proprietaire" ON public.notification_preferences;
CREATE POLICY "Notification preferences visibles par proprietaire"
  ON public.notification_preferences FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Notification preferences creables par proprietaire" ON public.notification_preferences;
CREATE POLICY "Notification preferences creables par proprietaire"
  ON public.notification_preferences FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Notification preferences modifiables par proprietaire" ON public.notification_preferences;
CREATE POLICY "Notification preferences modifiables par proprietaire"
  ON public.notification_preferences FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Notification preferences supprimables par proprietaire" ON public.notification_preferences;
CREATE POLICY "Notification preferences supprimables par proprietaire"
  ON public.notification_preferences FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON public.notification_preferences (user_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_org
  ON public.notification_preferences (organization_id);

INSERT INTO public.notification_preferences (user_id, organization_id)
SELECT p.id, p.organization_id
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.notification_preferences np
  WHERE np.user_id = p.id
);

NOTIFY pgrst, 'reload schema';
