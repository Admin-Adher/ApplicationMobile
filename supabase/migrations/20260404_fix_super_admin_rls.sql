-- Migration: Ajouter super_admin dans toutes les policies RLS write
-- Date: 2026-04-04
-- Problème : super_admin a canCreate/canEdit dans l'app mais était exclu des RLS Supabase
-- À exécuter dans Supabase → SQL Editor

-- ---- CHANTIERS ----
DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur" ON public.chantiers;
CREATE POLICY "Chantiers modifiables par admin/conducteur"
  ON public.chantiers FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur'))
  );

-- ---- COMPANIES ----
DROP POLICY IF EXISTS "Companies modifiables par admin/conducteur" ON public.companies;
CREATE POLICY "Companies modifiables par admin/conducteur"
  ON public.companies FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur'))
  );

-- ---- RESERVES ----
DROP POLICY IF EXISTS "Reserves modifiables (create/edit)" ON public.reserves;
CREATE POLICY "Reserves modifiables (create/edit)"
  ON public.reserves FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );

-- ---- TASKS ----
DROP POLICY IF EXISTS "Tasks modifiables" ON public.tasks;
CREATE POLICY "Tasks modifiables"
  ON public.tasks FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );

-- ---- DOCUMENTS ----
DROP POLICY IF EXISTS "Documents modifiables" ON public.documents;
CREATE POLICY "Documents modifiables"
  ON public.documents FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );

-- ---- PHOTOS ----
DROP POLICY IF EXISTS "Photos modifiables" ON public.photos;
CREATE POLICY "Photos modifiables"
  ON public.photos FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );

-- ---- SITE_PLANS ----
DROP POLICY IF EXISTS "Site plans modifiables" ON public.site_plans;
CREATE POLICY "Site plans modifiables"
  ON public.site_plans FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );

-- ---- VISITES ----
DROP POLICY IF EXISTS "Visites modifiables" ON public.visites;
CREATE POLICY "Visites modifiables"
  ON public.visites FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );

-- ---- LOTS ----
DROP POLICY IF EXISTS "Lots modifiables" ON public.lots;
CREATE POLICY "Lots modifiables"
  ON public.lots FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur'))
  );

-- ---- OPRS ----
DROP POLICY IF EXISTS "OPRs modifiables" ON public.oprs;
CREATE POLICY "OPRs modifiables"
  ON public.oprs FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur'))
  );

-- ---- TIME_ENTRIES ----
DROP POLICY IF EXISTS "Pointage modifiable" ON public.time_entries;
CREATE POLICY "Pointage modifiable"
  ON public.time_entries FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
  );
