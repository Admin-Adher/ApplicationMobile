-- ============================================================
-- Audit RLS complet — Exécuter chaque requête UNE PAR UNE
-- ============================================================

-- ▶ 1. Toutes les tables public avec RLS
SELECT tablename, rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- ▶ 2. Toutes les politiques RLS (détail complet)
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- ▶ 3. Résumé : nb politiques par table par opération
SELECT
  tablename,
  COUNT(*) FILTER (WHERE cmd = 'SELECT')  AS nb_select,
  COUNT(*) FILTER (WHERE cmd = 'INSERT')  AS nb_insert,
  COUNT(*) FILTER (WHERE cmd = 'UPDATE')  AS nb_update,
  COUNT(*) FILTER (WHERE cmd = 'DELETE')  AS nb_delete,
  COUNT(*) FILTER (WHERE cmd = 'ALL')     AS nb_all,
  COUNT(*)                                AS total
FROM pg_policies
WHERE schemaname = 'public'
GROUP BY tablename
ORDER BY tablename;

-- ▶ 4. Tables avec RLS activé mais AUCUNE politique (BLOQUANTES)
SELECT t.tablename
FROM pg_tables t
LEFT JOIN (
  SELECT tablename, COUNT(*) AS cnt FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
) p ON t.tablename = p.tablename
WHERE t.schemaname = 'public'
  AND t.rowsecurity = true
  AND COALESCE(p.cnt, 0) = 0
ORDER BY t.tablename;

-- ▶ 5. Tables SANS RLS (accessible à tous = risque de fuite de données)
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;

-- ▶ 6. Tables avec politique ALL mais SANS politique INSERT séparée
-- (ALL couvre tout mais with_check peut être null = INSERT non contrôlé)
SELECT DISTINCT p1.tablename
FROM pg_policies p1
WHERE p1.schemaname = 'public'
  AND p1.cmd = 'ALL'
  AND p1.with_check IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p2
    WHERE p2.schemaname = 'public'
      AND p2.tablename = p1.tablename
      AND p2.cmd = 'INSERT'
      AND p2.with_check IS NOT NULL
  )
ORDER BY p1.tablename;

-- ▶ 7. Colonnes organization_id dans toutes les tables
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'organization_id'
ORDER BY table_name;

-- ▶ 8. Fonctions helper RLS (auth_user_org, auth_user_role, etc.)
SELECT routine_name, routine_type, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'auth_user_org',
    'auth_user_role',
    'auth_user_name'
  )
ORDER BY routine_name;

-- ▶ 9. Triggers sur toutes les tables
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation AS event,
  action_timing AS timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- ▶ 10. Contraintes FK vers organizations
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table,
  ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ccu.table_name = 'organizations'
ORDER BY tc.table_name;
