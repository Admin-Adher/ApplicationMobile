-- Migration: Ajoute visit_type et concerned_company_ids à visites
-- Date: 2026-04-05
-- Description: Champs nécessaires au type de visite et aux entreprises concernées

ALTER TABLE public.visites
  ADD COLUMN IF NOT EXISTS visit_type text,
  ADD COLUMN IF NOT EXISTS concerned_company_ids jsonb;
