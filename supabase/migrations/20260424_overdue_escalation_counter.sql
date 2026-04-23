-- ============================================================
-- Compteur de rappels quotidiens + escalade aux administrateurs
-- Date : 2026-04-24
--
-- Après 7 rappels quotidiens consécutifs envoyés aux destinataires
-- des entreprises sous-traitantes sans résolution, la cron suspend
-- les rappels aux sous-traitants et escalade aux administrateurs
-- de l'organisation.
--
-- La colonne overdue_reminder_count est remise à 0 automatiquement
-- par la cron lorsqu'une réserve sort puis rentre à nouveau dans
-- l'état "en retard" (rupture de série détectée via la date du
-- dernier envoi).
-- ============================================================

ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS overdue_reminder_count integer NOT NULL DEFAULT 0;
