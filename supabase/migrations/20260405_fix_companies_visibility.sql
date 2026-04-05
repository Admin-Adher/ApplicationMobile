-- ============================================================
-- Migration : Visibilité des entreprises sans organization_id
-- Date      : 2026-04-05
--
-- Problème :
--   Les entreprises créées avant l'ajout de la colonne
--   organization_id ont organization_id = NULL.
--   La politique RLS actuelle filtre strictement sur
--     organization_id = auth_user_org()
--   ce qui exclut ces lignes dès que auth_user_org() renvoie
--   un UUID valide → zéro entreprise visible sur un appareil
--   sans cache local.
--
-- Solution :
--   1. Backfill : tenter de rattacher les entreprises sans org
--      à une organisation via les réserves ou tâches qui les
--      mentionnent.
--   2. Mettre à jour la politique SELECT pour que les entreprises
--      dont organization_id est toujours NULL soient visibles
--      par tous les utilisateurs authentifiés (données legacy
--      partagées).
--
-- Idempotent : oui.
-- ============================================================

-- ── 0. Fonction d'aide (idempotente) ─────────────────────────
CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ── 1. Backfill organization_id via les réserves ─────────────
-- Si une entreprise est mentionnée dans les réserves d'un
-- chantier dont on connaît l'organisation, on hérite cette org.
UPDATE public.companies co
SET organization_id = subq.organization_id
FROM (
  SELECT DISTINCT
    c.id              AS company_id,
    ch.organization_id
  FROM public.companies c
  JOIN public.reserves r
    ON r.company = c.name
    OR (r.companies IS NOT NULL AND r.companies::jsonb ? c.id::text)
  JOIN public.chantiers ch
    ON ch.id = r.chantier_id
  WHERE c.organization_id IS NULL
    AND ch.organization_id IS NOT NULL
) subq
WHERE co.id = subq.company_id
  AND co.organization_id IS NULL;

-- ── 2. Backfill organization_id via les tâches ───────────────
UPDATE public.companies co
SET organization_id = subq.organization_id
FROM (
  SELECT DISTINCT
    c.id              AS company_id,
    ch.organization_id
  FROM public.companies c
  JOIN public.tasks t
    ON t.company = c.name
  JOIN public.chantiers ch
    ON ch.id = t.chantier_id
  WHERE c.organization_id IS NULL
    AND ch.organization_id IS NOT NULL
) subq
WHERE co.id = subq.company_id
  AND co.organization_id IS NULL;

-- ── 3. Mettre à jour la politique SELECT ─────────────────────
-- Les entreprises rattachées à une org ne sont visibles que par
-- cette org (+ super_admin).
-- Les entreprises encore sans org (legacy) restent visibles par
-- tous les utilisateurs authentifiés.
DROP POLICY IF EXISTS "Companies visibles par organisation" ON public.companies;
CREATE POLICY "Companies visibles par organisation"
  ON public.companies FOR SELECT
  USING (
    -- Entreprise rattachée à la même organisation
    organization_id = auth_user_org()
    -- Entreprise legacy sans organisation → visible par tous les
    -- utilisateurs connectés (toute org ou super_admin)
    OR organization_id IS NULL
    -- Super-admin voit tout
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ── 4. Recharger le cache PostgREST ──────────────────────────
NOTIFY pgrst, 'reload schema';
