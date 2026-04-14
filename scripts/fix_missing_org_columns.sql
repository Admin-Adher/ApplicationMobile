-- ============================================================
-- Ajouter organization_id aux tables qui en manquent
-- + Mettre à jour les lignes existantes avec le bon org_id
-- Exécuter chaque bloc SÉPARÉMENT
-- ============================================================

-- ▶ 1. Voir quelles tables ont organization_id et lesquelles n'en ont pas
SELECT table_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'organization_id'
ORDER BY table_name;

-- ▶ 2. Ajouter organization_id à photos (si la colonne n'existe pas)
ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id);

-- ▶ 3. Backfill photos.organization_id depuis la réserve associée
UPDATE public.photos p
SET organization_id = r.organization_id
FROM public.reserves r
WHERE p.reserve_id = r.id
  AND p.organization_id IS NULL
  AND r.organization_id IS NOT NULL;

-- ▶ 4. Vérifier le résultat
SELECT organization_id IS NOT NULL AS has_org, COUNT(*)
FROM public.photos
GROUP BY organization_id IS NOT NULL;

-- ▶ 5. Vérifier s'il y a d'autres tables avec RLS mais sans organization_id
-- (exécuter la requête 3 du script diagnose_existing_policies.sql)
SELECT t.tablename
FROM pg_tables t
WHERE t.schemaname = 'public'
  AND t.rowsecurity = true
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = t.tablename
      AND c.column_name = 'organization_id'
  )
ORDER BY t.tablename;
