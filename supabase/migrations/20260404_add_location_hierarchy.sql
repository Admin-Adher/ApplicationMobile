-- Migration: Système de localisation hiérarchique (Bâtiment → Niveau → Zone)
-- Date: 2026-04-04
-- Description: Ajoute les colonnes nécessaires au système de localisation hiérarchique
--              sur les tables chantiers, oprs et visites.

-- ============================================================
-- TABLE: chantiers
-- Stocke la structure hiérarchique bâtiments/niveaux/zones
-- en JSON (sérialisé côté app comme chaîne JSON)
-- ============================================================
ALTER TABLE chantiers
  ADD COLUMN IF NOT EXISTS buildings text;

-- ============================================================
-- TABLE: oprs
-- Ajoute la colonne zone (building et level existaient déjà)
-- ============================================================
ALTER TABLE oprs
  ADD COLUMN IF NOT EXISTS zone text;

-- ============================================================
-- TABLE: visites
-- Ajoute les colonnes de localisation et les participants
-- (building et level peuvent déjà exister selon la version)
-- ============================================================
ALTER TABLE visites
  ADD COLUMN IF NOT EXISTS building text,
  ADD COLUMN IF NOT EXISTS level text,
  ADD COLUMN IF NOT EXISTS zone text,
  ADD COLUMN IF NOT EXISTS participants jsonb;

-- ============================================================
-- Vérification rapide (à exécuter manuellement si besoin)
-- ============================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name IN ('chantiers', 'oprs', 'visites')
--   AND column_name IN ('buildings', 'zone', 'building', 'level', 'participants')
-- ORDER BY table_name, column_name;
