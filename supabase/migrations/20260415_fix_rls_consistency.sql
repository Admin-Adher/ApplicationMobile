-- ─────────────────────────────────────────────────────────────────────────────
-- BUG 9: chantiers write policy was not updated alongside lots/oprs in
--        20260410 — chef_equipe could modify lots/oprs but not chantiers,
--        creating an inconsistent security model.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "chantiers_write" ON chantiers;

CREATE POLICY "chantiers_write" ON chantiers
  FOR ALL
  USING (
    organization_id = auth_user_org()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    )
  )
  WITH CHECK (
    organization_id = auth_user_org()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'admin', 'conducteur', 'chef_equipe')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- BUG 11: The SELECT policy for reserves had an overly permissive clause that
--         exposed orphan reserves (chantier_id IS NULL AND organization_id IS NULL)
--         to ALL authenticated users regardless of their organization.
--         These zombie records are readable by everyone but writable by no one.
--         Fix: restrict the orphan clause to super_admin only, so normal users
--         can no longer see other organizations' stale data.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "reserves_select" ON reserves;

CREATE POLICY "reserves_select" ON reserves
  FOR SELECT
  USING (
    -- Normal case: reserve belongs to user's organization
    organization_id = auth_user_org()
    -- Reserve is tied to a chantier in user's organization (legacy data without org_id)
    OR EXISTS (
      SELECT 1 FROM chantiers c
      WHERE c.id = reserves.chantier_id
        AND c.organization_id = auth_user_org()
    )
    -- Orphan records (both NULL) — visible only to super_admin for cleanup
    OR (
      reserves.chantier_id IS NULL
      AND reserves.organization_id IS NULL
      AND EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
          AND profiles.role = 'super_admin'
      )
    )
  );
