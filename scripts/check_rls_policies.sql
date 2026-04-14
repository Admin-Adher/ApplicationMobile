-- ============================================================
-- Script de vérification des politiques RLS Supabase
-- À exécuter dans le SQL Editor du dashboard Supabase
-- ============================================================

-- 1. Vérifier si RLS est activé sur chaque table
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

-- 2. Lister toutes les politiques RLS avec leurs détails
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,       -- PERMISSIVE ou RESTRICTIVE
  roles,            -- rôles concernés
  cmd,              -- SELECT / INSERT / UPDATE / DELETE / ALL
  qual,             -- expression WITH CHECK (lecture)
  with_check        -- expression WITH CHECK (écriture)
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

-- 3. Résumé par table : nombre de politiques par type d'opération
SELECT
  tablename,
  COUNT(*) FILTER (WHERE cmd = 'SELECT')  AS select_policies,
  COUNT(*) FILTER (WHERE cmd = 'INSERT')  AS insert_policies,
  COUNT(*) FILTER (WHERE cmd = 'UPDATE')  AS update_policies,
  COUNT(*) FILTER (WHERE cmd = 'DELETE')  AS delete_policies,
  COUNT(*) FILTER (WHERE cmd = 'ALL')     AS all_policies,
  COUNT(*)                                AS total_policies
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
GROUP BY tablename
ORDER BY tablename;

-- 4. Tables SANS aucune politique RLS (mais RLS activé = bloquant !)
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

-- 5. Vérifier les colonnes organization_id dans les tables critiques
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

-- 6. Tester les droits du rôle authentifié (anon / authenticated)
-- Simule ce qu'un utilisateur connecté peut faire
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

-- 7. Vérifier si le trigger/ fonction pour auto-générer le token d'invitation existe
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name ILIKE '%invit%'
ORDER BY routine_name;

-- 8. Vérifier les triggers liés aux invitations (token auto-generated)
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation AS event,
  action_timing AS timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('invitations', 'organizations', 'subscriptions', 'channels')
ORDER BY event_object_table, trigger_name;
