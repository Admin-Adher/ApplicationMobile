-- Push notifications support for BuildTrack.
-- Stores Expo push tokens per authenticated user and tracks push-specific
-- overdue reminder state independently from email reminder state.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT 'unknown'
    CHECK (platform IN ('ios', 'android', 'web', 'unknown')),
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Push tokens visibles par proprietaire" ON public.push_tokens;
CREATE POLICY "Push tokens visibles par proprietaire"
  ON public.push_tokens FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Push tokens creables par proprietaire" ON public.push_tokens;
CREATE POLICY "Push tokens creables par proprietaire"
  ON public.push_tokens FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Push tokens modifiables par proprietaire" ON public.push_tokens;
CREATE POLICY "Push tokens modifiables par proprietaire"
  ON public.push_tokens FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Push tokens supprimables par proprietaire" ON public.push_tokens;
CREATE POLICY "Push tokens supprimables par proprietaire"
  ON public.push_tokens FOR DELETE
  TO authenticated
  USING ((select auth.uid()) = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_tokens TO authenticated;
GRANT ALL ON public.push_tokens TO service_role;

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_enabled
  ON public.push_tokens (user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_push_tokens_org_enabled
  ON public.push_tokens (organization_id, enabled);
CREATE INDEX IF NOT EXISTS idx_push_tokens_last_seen
  ON public.push_tokens (last_seen_at DESC);

ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS overdue_push_last_notified_date date,
  ADD COLUMN IF NOT EXISTS overdue_push_reminder_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_reserves_overdue_push
  ON public.reserves (organization_id, deadline, overdue_push_last_notified_date)
  WHERE deadline IS NOT NULL AND status NOT IN ('closed', 'verification');

NOTIFY pgrst, 'reload schema';
