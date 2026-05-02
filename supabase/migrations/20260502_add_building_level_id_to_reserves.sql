-- Migration: Ajoute building_id et level_id à la table reserves
-- Date: 2026-05-02
-- Contexte: La table site_plans dispose déjà de ces colonnes (migration
--           20260404_add_site_plan_hierarchy_ids.sql). Les réserves stockaient
--           uniquement les libellés texte (building, level). Ajouter les IDs
--           hiérarchiques permet un filtrage exact par nœud dans l'onglet Plans
--           (picker bâtiment / niveau) sans dépendre de la correspondance de
--           chaînes qui est fragile (casse, espaces, renommages).

-- 1. Ajouter les colonnes (idempotent)
ALTER TABLE public.reserves
  ADD COLUMN IF NOT EXISTS building_id text,
  ADD COLUMN IF NOT EXISTS level_id    text;

-- 2. Index pour les filtrages fréquents dans l'onglet Plans
CREATE INDEX IF NOT EXISTS idx_reserves_building_id ON public.reserves(building_id);
CREATE INDEX IF NOT EXISTS idx_reserves_level_id    ON public.reserves(level_id);

-- 3. Rétro-remplissage via plan_id → site_plans
--    Une réserve associée à un plan hérite des IDs hiérarchiques de ce plan.
--    Les réserves sans plan_id (non localisées) restent à NULL — c'est correct.
UPDATE public.reserves r
SET
  building_id = sp.building_id,
  level_id    = sp.level_id
FROM public.site_plans sp
WHERE r.plan_id = sp.id
  AND (r.building_id IS NULL OR r.level_id IS NULL)
  AND (sp.building_id IS NOT NULL OR sp.level_id IS NOT NULL);

-- 4. Vérification rapide (à exécuter manuellement si besoin)
-- SELECT
--   COUNT(*)                                           AS total,
--   COUNT(*) FILTER (WHERE building_id IS NOT NULL)    AS with_building_id,
--   COUNT(*) FILTER (WHERE level_id    IS NOT NULL)    AS with_level_id,
--   COUNT(*) FILTER (WHERE plan_id IS NOT NULL
--                      AND building_id IS NULL)        AS pinned_without_building_id
-- FROM public.reserves;
