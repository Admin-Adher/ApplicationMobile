-- ============================================================
-- Migration : Suivi des renvois d'invitations
-- Date : 2026-04-24
--
-- Ajoute deux colonnes à public.invitations pour tracer
-- combien de fois un email d'invitation a été renvoyé et quand,
-- afin d'éviter de spammer les destinataires.
--
-- Idempotent : oui (IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS resend_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS last_resent_at timestamptz;

NOTIFY pgrst, 'reload schema';
