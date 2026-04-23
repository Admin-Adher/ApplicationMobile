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
