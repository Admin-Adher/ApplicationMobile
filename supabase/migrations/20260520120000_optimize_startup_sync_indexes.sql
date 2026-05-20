-- ============================================================
-- Optimisation de la synchronisation de demarrage
-- Date : 2026-05-20
--
-- Les hooks mobiles filtrent principalement par organization_id et trient
-- plusieurs tables par date descendante. Ces index evitent des scans et tris
-- inutiles pendant le refresh initial Supabase.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_chantiers_org_created_at_desc
  ON public.chantiers (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reserves_org_created_at_desc
  ON public.reserves (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_org_chantier
  ON public.tasks (organization_id, chantier_id);

CREATE INDEX IF NOT EXISTS idx_site_plans_org_created_at_desc
  ON public.site_plans (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visites_org_created_at_desc
  ON public.visites (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oprs_org_created_at_desc
  ON public.oprs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_org_uploaded_at_desc
  ON public.documents (organization_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_photos_org_taken_at_desc
  ON public.photos (organization_id, taken_at DESC);

CREATE INDEX IF NOT EXISTS idx_lots_org
  ON public.lots (organization_id);

CREATE INDEX IF NOT EXISTS idx_profiles_org_name
  ON public.profiles (organization_id, name);
