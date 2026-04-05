-- Migration: Fix message insert failures
-- Date: 2026-04-05
-- Problem: Messages fail to insert due to:
--   1. Missing columns (is_me, reactions, is_pinned, read_by, mentions, reserve_id)
--      that may not exist if the full schema.sql was never applied
--   2. RLS policy uses FOR ALL USING which may not cover INSERT in all Supabase versions
-- Fix: Ensure all columns exist + add explicit INSERT WITH CHECK policy

-- ============================================================
-- 1. Ensure all required columns exist
-- ============================================================
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_me           boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reactions        jsonb   NOT NULL DEFAULT '{}';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_pinned        boolean NOT NULL DEFAULT false;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_by          jsonb   NOT NULL DEFAULT '[]';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS mentions         jsonb   NOT NULL DEFAULT '[]';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reserve_id       text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_id      text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_content text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS reply_to_sender  text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_uri   text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS linked_item_type  text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS linked_item_id    text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS linked_item_title text;

-- ============================================================
-- 2. Add explicit INSERT policy (WITH CHECK) to guarantee
--    that authenticated users can insert messages regardless
--    of how the FOR ALL USING policy is interpreted
-- ============================================================
DROP POLICY IF EXISTS "Messages insertables par authentifiés" ON public.messages;
CREATE POLICY "Messages insertables par authentifiés"
  ON public.messages
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- Vérification (à exécuter manuellement si besoin)
-- ============================================================
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'messages'
-- ORDER BY ordinal_position;
