-- Migration: Policies RLS sur la table organizations pour super_admin
-- Date: 2026-04-05
-- Contexte: le super_admin doit pouvoir lire toutes les orgs, en créer, et modifier leur nom.
--           Les orgs régulières (admin/membres) ne peuvent voir que la leur.
-- À exécuter dans Supabase → SQL Editor

-- Activer RLS si ce n'est pas encore le cas
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- ── Lecture ──────────────────────────────────────────────────────────────────

-- super_admin voit toutes les organisations
DROP POLICY IF EXISTS "Organisations lisibles par super_admin" ON public.organizations;
CREATE POLICY "Organisations lisibles par super_admin"
  ON public.organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Admin et membres voient uniquement leur propre organisation
DROP POLICY IF EXISTS "Organisation lisible par ses membres" ON public.organizations;
CREATE POLICY "Organisation lisible par ses membres"
  ON public.organizations FOR SELECT
  USING (
    id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- ── Création ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Organisations créables par super_admin" ON public.organizations;
CREATE POLICY "Organisations créables par super_admin"
  ON public.organizations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ── Modification (nom) ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Organisations modifiables par super_admin" ON public.organizations;
CREATE POLICY "Organisations modifiables par super_admin"
  ON public.organizations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- =============================================================================
-- TABLE : subscriptions
-- super_admin doit pouvoir lire toutes les subscriptions, en créer (createOrganization)
-- et modifier le statut (updateOrgStatus).
-- =============================================================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Lecture — super_admin voit tout
DROP POLICY IF EXISTS "Subscriptions lisibles par super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions lisibles par super_admin"
  ON public.subscriptions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Lecture — membres voient uniquement la subscription de leur org
DROP POLICY IF EXISTS "Subscription lisible par ses membres" ON public.subscriptions;
CREATE POLICY "Subscription lisible par ses membres"
  ON public.subscriptions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
  );

-- Création — super_admin uniquement
DROP POLICY IF EXISTS "Subscriptions créables par super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions créables par super_admin"
  ON public.subscriptions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Modification (statut) — super_admin uniquement
DROP POLICY IF EXISTS "Subscriptions modifiables par super_admin" ON public.subscriptions;
CREATE POLICY "Subscriptions modifiables par super_admin"
  ON public.subscriptions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ── Suppression ───────────────────────────────────────────────────────────────
-- (réservée au super_admin ; à décommenter si une feature de suppression est ajoutée)
-- DROP POLICY IF EXISTS "Organisations supprimables par super_admin" ON public.organizations;
-- CREATE POLICY "Organisations supprimables par super_admin"
--   ON public.organizations FOR DELETE
--   USING (
--     EXISTS (
--       SELECT 1 FROM public.profiles
--       WHERE id = auth.uid() AND role = 'super_admin'
--     )
--   );
