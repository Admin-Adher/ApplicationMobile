-- ============================================================
-- Suivi des notifications de retard d'échéance des réserves
-- Date : 2026-04-23
--
-- Ajoute une colonne pour mémoriser à quelle date d'échéance la
-- notification "réserve en retard" a déjà été envoyée. Si la date
-- d'échéance d'une réserve change, la valeur ne correspondra plus
-- et une nouvelle notification pourra être envoyée.
-- ============================================================

ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS overdue_notified_for_deadline text;

CREATE INDEX IF NOT EXISTS idx_reserves_overdue_scan
  ON public.reserves (status, deadline)
  WHERE status NOT IN ('closed', 'verification') AND deadline IS NOT NULL;
