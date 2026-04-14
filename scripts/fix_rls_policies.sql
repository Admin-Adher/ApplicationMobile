-- ============================================================
-- Fix des politiques RLS manquantes / incorrectes
-- À exécuter dans le SQL Editor du dashboard Supabase
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. ORGANIZATIONS : Ajouter les politiques INSERT/UPDATE/DELETE manquantes
-- ──────────────────────────────────────────────────────────

-- INSERT : super_admin peut créer, admin peut créer pour son org
CREATE POLICY "organizations_insert"
  ON public.organizations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_user_role() = 'super_admin'
  );

-- UPDATE : super_admin peut modifier n'importe quelle org, admin peut modifier la sienne
CREATE POLICY "organizations_update"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    (id = auth_user_org()) OR (auth_user_role() = 'super_admin')
  )
  WITH CHECK (
    (id = auth_user_org()) OR (auth_user_role() = 'super_admin')
  );

-- DELETE : seul super_admin peut supprimer
CREATE POLICY "organizations_delete"
  ON public.organizations
  FOR DELETE
  TO authenticated
  USING (
    auth_user_role() = 'super_admin'
  );

-- ──────────────────────────────────────────────────────────
-- 2. CHANNELS : Autoriser l'INSERT lors de la création d'org
--    Le canal "Général" est créé juste après l'org, mais
--    l'utilisateur n'a pas encore organization_id = nouvelle org.
--    Solution : super_admin peut toujours, et on autorise
--    l'INSERT si created_by = utilisateur courant (canal auto-créé)
-- ──────────────────────────────────────────────────────────

-- Remplacer la politique channels_write pour ajouter le cas created_by
DROP POLICY IF EXISTS channels_write ON public.channels;

CREATE POLICY "channels_write"
  ON public.channels
  FOR ALL
  TO authenticated
  USING (
    ((type IN ('general','building','company','custom') AND organization_id = auth_user_org())
     OR (type = 'custom' AND created_by = auth_user_name())
     OR (type IN ('group','dm') AND (created_by = auth_user_name()
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(channels.members) m(value) WHERE m.value = auth_user_name())))
     OR auth_user_role() = 'super_admin')
  )
  WITH CHECK (
    ((type IN ('general','building','company','custom') AND organization_id = auth_user_org())
     OR (type = 'custom' AND created_by = auth_user_name())
     OR (type IN ('group','dm') AND (created_by = auth_user_name()
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(channels.members) m(value) WHERE m.value = auth_user_name())))
     OR auth_user_role() = 'super_admin'
     OR created_by = auth_user_name())  -- ← AJOUT : canal créé par l'utilisateur lui-même
  );

-- ──────────────────────────────────────────────────────────
-- 3. Vérification : lister les politiques organizations après fix
-- ──────────────────────────────────────────────────────────
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
  AND tablename IN ('organizations', 'channels')
ORDER BY tablename, cmd, policyname;
