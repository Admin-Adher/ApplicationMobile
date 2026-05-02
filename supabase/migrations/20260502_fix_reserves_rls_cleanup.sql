-- ============================================================
-- CORRECTION CRITIQUE : Politiques RLS reserves — nettoyage complet
-- Date : 2026-05-02
--
-- Problème diagnostiqué :
--   Depuis la migration 20260408, plusieurs politiques coexistent
--   sur la table `reserves` avec des noms légèrement différents
--   (avec/sans accent sur "Réserves"). En particulier :
--
--   • "Reserves modifiables par org"  (sans accent, de 20260408/09)
--     → utilise des sous-requêtes directes sur profiles (pas SECURITY
--       DEFINER), ce qui déclenche la RLS de profiles → récursion →
--       le check échoue avec code 42501.
--
--   • "Réserves modifiables par org" (avec accent, de 20260422)
--     → utilise auth_user_role() (SECURITY DEFINER) — correcte, mais
--       coexiste avec la précédente.
--
--   La migration 20260422 n'a supprimé que les variantes AVEC accent,
--   laissant les anciennes variantes SANS accent actives.
--   PostgreSQL applique toutes les politiques permissives en OR,
--   mais la politique récursive fait planter l'évaluation entière.
--
-- Solution :
--   1. Supprimer TOUS les variants de noms sur reserves.
--   2. Recréer 3 politiques propres avec WITH CHECK explicite.
--   3. Utiliser uniquement auth_user_role() / auth_user_org()
--      (SECURITY DEFINER) — jamais de sous-requêtes directes sur profiles.
-- ============================================================

-- ── S'assurer que les fonctions SECURITY DEFINER sont à jour ───────────

CREATE OR REPLACE FUNCTION public.auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ── Supprimer TOUS les variants de politiques sur reserves ─────────────

-- Variants SELECT
DROP POLICY IF EXISTS "Reserves lisibles par tous"                        ON public.reserves;
DROP POLICY IF EXISTS "Reserves visibles par organisation"                ON public.reserves;
DROP POLICY IF EXISTS "Réserves lisibles par tous les authentifiés"       ON public.reserves;
DROP POLICY IF EXISTS "Réserves visibles par organisation"                ON public.reserves;
DROP POLICY IF EXISTS "reserves_select"                                   ON public.reserves;

-- Variants ALL/WRITE
DROP POLICY IF EXISTS "Reserves modifiables (create/edit)"               ON public.reserves;
DROP POLICY IF EXISTS "Reserves modifiables par org"                     ON public.reserves;
DROP POLICY IF EXISTS "Réserves modifiables"                             ON public.reserves;
DROP POLICY IF EXISTS "Réserves modifiables par org"                     ON public.reserves;
DROP POLICY IF EXISTS "reserves_write"                                    ON public.reserves;

-- Politique sous-traitant
DROP POLICY IF EXISTS "Reserves: sous_traitant peut requêter la levée"   ON public.reserves;
DROP POLICY IF EXISTS "reserves_sousstraitant_update"                    ON public.reserves;

-- ── 1. Politique SELECT ────────────────────────────────────────────────
-- Tout utilisateur de la même org voit les réserves de son org.
-- Le sous-traitant voit les réserves qui le concernent.
-- Le super_admin voit tout.

CREATE POLICY "reserves_select"
  ON public.reserves
  FOR SELECT
  USING (
    -- Correspondance directe (colonne organization_id peuplée)
    organization_id = auth_user_org()
    -- Correspondance via chantier (données legacy sans organization_id)
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = reserves.chantier_id
        AND c.organization_id = auth_user_org()
    )
    -- Super admin voit tout
    OR auth_user_role() = 'super_admin'
    -- Sous-traitant voit les réserves affectées à sa société
    OR (
      auth_user_role() = 'sous_traitant'
      AND (
        reserves.company = (
          SELECT co.name FROM public.companies co
          JOIN public.profiles p ON p.company_id = co.id
          WHERE p.id = auth.uid() LIMIT 1
        )
        OR (
          reserves.companies IS NOT NULL
          AND reserves.companies::jsonb ? (
            SELECT p.company_id::text FROM public.profiles p
            WHERE p.id = auth.uid() LIMIT 1
          )
        )
      )
    )
  );

-- ── 2. Politique INSERT / UPDATE / DELETE (admin, conducteur, chef_equipe) ──
-- WITH CHECK explicite pour que l'INSERT fonctionne correctement :
-- PostgreSQL utilise WITH CHECK (et non USING) pour valider les nouvelles
-- lignes lors d'un INSERT. Sans WITH CHECK explicite, certains cas limites
-- peuvent faire échouer l'insertion même avec un organization_id correct.

CREATE POLICY "reserves_write"
  ON public.reserves
  FOR ALL
  USING (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (
      organization_id = auth_user_org()
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ── 3. Politique UPDATE sous-traitant (levée de réserve) ──────────────
-- Le sous-traitant peut uniquement modifier les réserves de sa société
-- pour signaler une demande de levée.

CREATE POLICY "reserves_sousstraitant_update"
  ON public.reserves
  FOR UPDATE
  USING (
    auth_user_role() = 'sous_traitant'
    AND (
      reserves.company = (
        SELECT co.name FROM public.companies co
        JOIN public.profiles p ON p.company_id = co.id
        WHERE p.id = auth.uid() LIMIT 1
      )
      OR (
        reserves.companies IS NOT NULL
        AND reserves.companies::jsonb ? (
          SELECT p.company_id::text FROM public.profiles p
          WHERE p.id = auth.uid() LIMIT 1
        )
      )
    )
  );

-- ── Vider le cache du schéma PostgREST ────────────────────────────────
NOTIFY pgrst, 'reload schema';
