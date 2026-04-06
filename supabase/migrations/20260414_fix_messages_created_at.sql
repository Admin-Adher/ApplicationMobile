-- ============================================================
-- Migration : Ajout de created_at (timestamptz) sur messages
-- Date      : 2026-04-14
--
-- Problème :
--   La colonne timestamp est stockée en texte au format
--   dd/mm/yyyy HH:mm (format français). Le tri côté Supabase
--   par cette colonne n'est pas fiable entre jours/mois/années.
--   Il n'est pas non plus possible de faire une pagination
--   cursor-based fiable avec un texte non-ISO.
--
-- Solution :
--   Ajouter une colonne created_at TIMESTAMPTZ DEFAULT NOW()
--   qui sera renseignée automatiquement par Postgres à l'INSERT.
--   Un index (channel_id, created_at DESC) est créé pour
--   optimiser les requêtes de pagination par canal.
--
--   Les messages existants auront created_at = NOW() (valeur
--   approximative). Les nouveaux messages auront l'horodatage
--   exact d'insertion.
--
-- Idempotent : oui (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Index pour la pagination par canal (cursor-based)
CREATE INDEX IF NOT EXISTS messages_channel_created_at_idx
  ON public.messages (channel_id, created_at DESC);

-- Index global pour la requête initiale (les N plus récents)
CREATE INDEX IF NOT EXISTS messages_created_at_idx
  ON public.messages (created_at DESC);

NOTIFY pgrst, 'reload schema';
