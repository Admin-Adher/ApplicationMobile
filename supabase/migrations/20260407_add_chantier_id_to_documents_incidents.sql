-- ─────────────────────────────────────────────────────────────────────────────
-- Ajout de chantier_id sur documents et incidents
--
-- Objectif : permettre de filtrer et supprimer documents/incidents par chantier.
--   • La sécurité reste basée sur organization_id (RLS inchangée).
--   • chantier_id est facultatif (NULL = document/incident d'organisation globale).
--   • NULL preservé pour les données existantes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. documents ──────────────────────────────────────────────────────────────
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS chantier_id text;

CREATE INDEX IF NOT EXISTS idx_documents_chantier
  ON public.documents(chantier_id);

-- ── 2. incidents ──────────────────────────────────────────────────────────────
ALTER TABLE public.incidents
  ADD COLUMN IF NOT EXISTS chantier_id text;

CREATE INDEX IF NOT EXISTS idx_incidents_chantier
  ON public.incidents(chantier_id);

-- Recharger le cache PostgREST
NOTIFY pgrst, 'reload schema';
