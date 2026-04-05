-- Migration: Rebuild messages table with all required columns
-- Date: 2026-04-05
-- Reason: Schema cache error proves column(s) are missing from the actual table

-- ============================================================
-- 1. Create the table if it doesn't exist (with all columns)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id              text PRIMARY KEY,
  channel_id      text NOT NULL DEFAULT 'general',
  sender          text NOT NULL,
  content         text NOT NULL DEFAULT '',
  timestamp       text NOT NULL,
  type            text NOT NULL DEFAULT 'message',
  read            boolean NOT NULL DEFAULT false,
  is_me           boolean NOT NULL DEFAULT false,
  reply_to_id     text,
  reply_to_content text,
  reply_to_sender text,
  attachment_uri  text,
  reactions       jsonb NOT NULL DEFAULT '{}',
  is_pinned       boolean NOT NULL DEFAULT false,
  read_by         jsonb NOT NULL DEFAULT '[]',
  mentions        jsonb NOT NULL DEFAULT '[]',
  reserve_id      text,
  linked_item_type  text,
  linked_item_id    text,
  linked_item_title text
);

-- ============================================================
-- 2. Add any missing columns to an already-existing table
-- ============================================================
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS channel_id        text NOT NULL DEFAULT 'general';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender            text NOT NULL DEFAULT '';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS content           text NOT NULL DEFAULT '';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS timestamp         text NOT NULL DEFAULT '';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS type              text NOT NULL DEFAULT 'message';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read              boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_me             boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id       text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_content  text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_sender   text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_uri    text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reactions         jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_pinned         boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_by           jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mentions          jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reserve_id        text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS linked_item_type  text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS linked_item_id    text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS linked_item_title text;

-- ============================================================
-- 3. Enable RLS and recreate all policies
-- ============================================================
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Messages lisibles par tous" ON public.messages;
CREATE POLICY "Messages lisibles par tous"
  ON public.messages FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Messages modifiables" ON public.messages;
CREATE POLICY "Messages modifiables"
  ON public.messages FOR ALL
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Messages insertables par authentifiés" ON public.messages;
CREATE POLICY "Messages insertables par authentifiés"
  ON public.messages FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- 4. Force PostgREST schema cache reload
-- ============================================================
NOTIFY pgrst, 'reload schema';
