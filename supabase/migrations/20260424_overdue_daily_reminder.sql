-- ============================================================
-- Rappel quotidien des réserves en retard
-- Date : 2026-04-24
--
-- Bascule du modèle "1 email par échéance" vers "1 email par jour
-- tant que la réserve reste en retard". Le suivi se fait via la
-- date du dernier envoi (YYYY-MM-DD).
-- ============================================================

ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS overdue_last_notified_date text;

-- Migration douce : si une réserve avait déjà été notifiée avec
-- l'ancien mécanisme, on considère que la dernière notification
-- date d'aujourd'hui pour ne pas re-spammer immédiatement à la
-- toute première exécution post-déploiement.
UPDATE public.reserves
SET overdue_last_notified_date = to_char(now(), 'YYYY-MM-DD')
WHERE overdue_last_notified_date IS NULL
  AND overdue_notified_for_deadline IS NOT NULL
  AND overdue_notified_for_deadline = deadline;
