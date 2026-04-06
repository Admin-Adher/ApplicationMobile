-- ============================================================
-- Migration : Ajout colonne pinned_channels dans profiles
-- Date      : 2026-04-11
--
-- Permet de synchroniser les canaux épinglés par utilisateur
-- sur tous les appareils (au lieu d'AsyncStorage seul).
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pinned_channels jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Index GIN pour les requêtes @> (contains) sur le tableau
CREATE INDEX IF NOT EXISTS idx_profiles_pinned_channels
  ON public.profiles USING GIN (pinned_channels);

COMMENT ON COLUMN public.profiles.pinned_channels IS
  'Liste des identifiants de canaux épinglés par cet utilisateur.';
