-- ─────────────────────────────────────────────────────────────────────────────
-- Enable Supabase Realtime publication for all BuildTrack tables.
--
-- Without this, supabase.channel().on('postgres_changes', ...) subscriptions
-- receive NO events — neither from the app nor from manual Supabase edits.
--
-- REPLICA IDENTITY FULL is required so that:
--   1. DELETE events carry the full old row (enabling RLS filtering server-side)
--   2. payload.old in the app has all fields, not just the primary key
--
-- Each ADD TABLE is guarded by a NOT EXISTS check to make this migration
-- idempotent and safe to run multiple times.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reserves',
    'tasks',
    'chantiers',
    'site_plans',
    'visites',
    'lots',
    'oprs',
    'companies',
    'photos',
    'documents',
    'messages',
    'channels'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    END IF;
  END LOOP;
END $$;

-- Set REPLICA IDENTITY FULL so the complete old row is available on DELETE.
-- This lets Supabase apply RLS policies to DELETE change events.
ALTER TABLE reserves   REPLICA IDENTITY FULL;
ALTER TABLE tasks      REPLICA IDENTITY FULL;
ALTER TABLE chantiers  REPLICA IDENTITY FULL;
ALTER TABLE site_plans REPLICA IDENTITY FULL;
ALTER TABLE visites    REPLICA IDENTITY FULL;
ALTER TABLE lots       REPLICA IDENTITY FULL;
ALTER TABLE oprs       REPLICA IDENTITY FULL;
ALTER TABLE companies  REPLICA IDENTITY FULL;
ALTER TABLE photos     REPLICA IDENTITY FULL;
ALTER TABLE documents  REPLICA IDENTITY FULL;
ALTER TABLE messages   REPLICA IDENTITY FULL;
ALTER TABLE channels   REPLICA IDENTITY FULL;
