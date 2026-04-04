-- Migration: Ajoute building_id et level_id à site_plans
-- Date: 2026-04-04
-- Description: Lie chaque plan à un nœud précis de la hiérarchie Bâtiment → Niveau
--              définie dans chantiers.buildings (JSON). Ces IDs permettent un
--              filtrage exact dans l'onglet Plans et un pré-remplissage verrouillé
--              du formulaire de réserve créé depuis un plan.

ALTER TABLE public.site_plans
  ADD COLUMN IF NOT EXISTS building_id text,
  ADD COLUMN IF NOT EXISTS level_id    text;

-- Vérification rapide (à exécuter manuellement si besoin)
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'site_plans'
--   AND column_name IN ('building_id', 'level_id')
-- ORDER BY column_name;
