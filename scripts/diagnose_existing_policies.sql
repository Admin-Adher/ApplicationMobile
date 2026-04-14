-- ============================================================
-- Diagnostic des politiques RLS existantes
-- Vérifie si chaque politique filtre bien par organization_id
-- Exécuter chaque requête UNE PAR UNE
-- ============================================================

-- ▶ 1. Détail complet de TOUTES les politiques (sauf organizations/channels déjà vérifiés)
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename NOT IN ('organizations', 'channels')
ORDER BY tablename, cmd;

-- ▶ 2. Tables qui ont une colonne organization_id
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'organization_id'
ORDER BY table_name;

-- ▶ 3. Tables SANS colonne organization_id (mais avec RLS activé)
-- Ces tables ne peuvent PAS filtrer par org au niveau RLS !
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

-- ▶ 4. Politiques qui ne mentionnent PAS organization_id (potentiellement trop permissives)
SELECT tablename, policyname, cmd,
  CASE WHEN qual IS NULL THEN 'NULL' ELSE qual END AS qual,
  CASE WHEN with_check IS NULL THEN 'NULL' ELSE with_check END AS with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    SELECT t.tablename FROM pg_tables t
    WHERE t.schemaname = 'public' AND t.rowsecurity = true
    AND EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = t.tablename
        AND c.column_name = 'organization_id'
    )
  )
  AND (
    (qual IS NOT NULL AND qual NOT LIKE '%organization_id%')
    OR (with_check IS NOT NULL AND with_check NOT LIKE '%organization_id%')
  )
ORDER BY tablename, policyname;
