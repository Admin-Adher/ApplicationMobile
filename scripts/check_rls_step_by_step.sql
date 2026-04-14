-- ============================================================
-- Exécuter CHAQUE requête UNE PAR UNE dans le SQL Editor
-- (Supabase ne montre que le résultat de la dernière)
-- ============================================================

-- ▶ REQUÊTE 1 : RLS activé sur chaque table ?
SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'companies',
    'organizations',
    'subscriptions',
    'channels',
    'invitations',
    'profiles',
    'plans',
    'reserves',
    'tasks',
    'photos',
    'documents',
    'chantiers',
    'site_plans',
    'visites',
    'lots',
    'oprs',
    'incidents',
    'messages',
    'time_entries',
    'regulatory_docs'
  )
ORDER BY tablename;

-- ▶ REQUÊTE 2 : Tables avec RLS activé mais AUCUNE politique (= tout bloqué !)
SELECT
  t.tablename,
  t.rowsecurity AS rls_enabled,
  COALESCE(p.policy_count, 0) AS policy_count
FROM pg_tables t
LEFT JOIN (
  SELECT tablename, COUNT(*) AS policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) p ON t.tablename = p.tablename
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'companies',
    'organizations',
    'subscriptions',
    'channels',
    'invitations',
    'profiles',
    'plans'
  )
  AND t.rowsecurity = true
  AND COALESCE(p.policy_count, 0) = 0
ORDER BY t.tablename;

-- ▶ REQUÊTE 3 : Droits du rôle authenticated
SELECT
  has_table_privilege('authenticated', 'public.companies', 'SELECT')        AS can_select_companies,
  has_table_privilege('authenticated', 'public.companies', 'INSERT')        AS can_insert_companies,
  has_table_privilege('authenticated', 'public.companies', 'UPDATE')        AS can_update_companies,
  has_table_privilege('authenticated', 'public.companies', 'DELETE')        AS can_delete_companies,
  has_table_privilege('authenticated', 'public.organizations', 'SELECT')    AS can_select_organizations,
  has_table_privilege('authenticated', 'public.organizations', 'INSERT')    AS can_insert_organizations,
  has_table_privilege('authenticated', 'public.organizations', 'UPDATE')    AS can_update_organizations,
  has_table_privilege('authenticated', 'public.organizations', 'DELETE')    AS can_delete_organizations,
  has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')    AS can_select_subscriptions,
  has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')    AS can_insert_subscriptions,
  has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')    AS can_update_subscriptions,
  has_table_privilege('authenticated', 'public.channels', 'INSERT')         AS can_insert_channels,
  has_table_privilege('authenticated', 'public.invitations', 'SELECT')      AS can_select_invitations,
  has_table_privilege('authenticated', 'public.invitations', 'INSERT')      AS can_insert_invitations,
  has_table_privilege('authenticated', 'public.invitations', 'DELETE')      AS can_delete_invitations,
  has_table_privilege('authenticated', 'public.plans', 'SELECT')           AS can_select_plans;

-- ▶ REQUÊTE 4 : Détail des politiques RLS
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
  AND tablename IN (
    'companies',
    'organizations',
    'subscriptions',
    'channels',
    'invitations',
    'profiles',
    'plans'
  )
ORDER BY tablename, cmd, policyname;

-- ▶ REQUÊTE 5 : Colonne organization_id présente ?
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'organization_id'
  AND table_name IN (
    'companies',
    'organizations',
    'subscriptions',
    'channels',
    'invitations',
    'profiles',
    'reserves',
    'tasks',
    'chantiers',
    'incidents'
  )
ORDER BY table_name;
