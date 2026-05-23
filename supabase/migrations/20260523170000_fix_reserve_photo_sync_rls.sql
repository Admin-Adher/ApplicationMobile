-- Fix reserve/photo offline sync RLS failures.
--
-- Symptoms:
--   [42501] new row violates row-level security policy for table "reserves"
--   [42501] new row violates row-level security policy for table "photos"
--
-- Root causes handled here:
--   1. Old queued payloads can miss organization_id.
--   2. photos may not have an organization_id column on older databases.
--   3. INSERT policies should have explicit WITH CHECK clauses.

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_photos_org_taken_at_desc
  ON public.photos (organization_id, taken_at DESC);

UPDATE public.reserves r
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE r.chantier_id = c.id
  AND r.organization_id IS NULL
  AND c.organization_id IS NOT NULL;

UPDATE public.photos p
SET organization_id = COALESCE(r.organization_id, c.organization_id)
FROM public.reserves r
LEFT JOIN public.chantiers c ON c.id = r.chantier_id
WHERE p.reserve_id = r.id
  AND p.organization_id IS NULL
  AND COALESCE(r.organization_id, c.organization_id) IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_reserve_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NEW.organization_id IS NULL THEN
    IF NEW.chantier_id IS NOT NULL THEN
      SELECT c.organization_id
      INTO v_org_id
      FROM public.chantiers c
      WHERE c.id = NEW.chantier_id
      LIMIT 1;
    END IF;

    NEW.organization_id := COALESCE(v_org_id, public.auth_user_org());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_reserve_organization_id ON public.reserves;
CREATE TRIGGER trg_set_reserve_organization_id
BEFORE INSERT OR UPDATE OF chantier_id, organization_id
ON public.reserves
FOR EACH ROW
EXECUTE FUNCTION public.set_reserve_organization_id();

CREATE OR REPLACE FUNCTION public.set_photo_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NEW.organization_id IS NULL THEN
    IF NEW.reserve_id IS NOT NULL THEN
      SELECT COALESCE(r.organization_id, c.organization_id)
      INTO v_org_id
      FROM public.reserves r
      LEFT JOIN public.chantiers c ON c.id = r.chantier_id
      WHERE r.id = NEW.reserve_id
      LIMIT 1;
    END IF;

    NEW.organization_id := COALESCE(v_org_id, public.auth_user_org());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_photo_organization_id ON public.photos;
CREATE TRIGGER trg_set_photo_organization_id
BEFORE INSERT OR UPDATE OF reserve_id, organization_id
ON public.photos
FOR EACH ROW
EXECUTE FUNCTION public.set_photo_organization_id();

DROP POLICY IF EXISTS "Reserves modifiables (create/edit)" ON public.reserves;
DROP POLICY IF EXISTS "Reserves modifiables par org" ON public.reserves;
DROP POLICY IF EXISTS "Réserves modifiables" ON public.reserves;
DROP POLICY IF EXISTS "Réserves modifiables par org" ON public.reserves;
DROP POLICY IF EXISTS "reserves_write" ON public.reserves;

CREATE POLICY "reserves_write"
  ON public.reserves
  FOR ALL
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
      AND (
        organization_id = public.auth_user_org()
        OR EXISTS (
          SELECT 1
          FROM public.chantiers c
          WHERE c.id = reserves.chantier_id
            AND c.organization_id = public.auth_user_org()
        )
      )
    )
  )
  WITH CHECK (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
      AND (
        organization_id = public.auth_user_org()
        OR EXISTS (
          SELECT 1
          FROM public.chantiers c
          WHERE c.id = reserves.chantier_id
            AND c.organization_id = public.auth_user_org()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Photos modifiables" ON public.photos;
DROP POLICY IF EXISTS "Photos modifiables par org" ON public.photos;
DROP POLICY IF EXISTS "photos_write" ON public.photos;

CREATE POLICY "photos_write"
  ON public.photos
  FOR ALL
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
      AND (
        (reserve_id IS NULL AND organization_id = public.auth_user_org())
        OR EXISTS (
          SELECT 1
          FROM public.reserves r
          LEFT JOIN public.chantiers c ON c.id = r.chantier_id
          WHERE r.id = photos.reserve_id
            AND COALESCE(r.organization_id, c.organization_id) = public.auth_user_org()
        )
      )
    )
  )
  WITH CHECK (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
      AND (
        (reserve_id IS NULL AND organization_id = public.auth_user_org())
        OR EXISTS (
          SELECT 1
          FROM public.reserves r
          LEFT JOIN public.chantiers c ON c.id = r.chantier_id
          WHERE r.id = photos.reserve_id
            AND COALESCE(r.organization_id, c.organization_id) = public.auth_user_org()
        )
      )
    )
  );

DROP POLICY IF EXISTS "Photos lisibles par tous" ON public.photos;
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;
DROP POLICY IF EXISTS "photos_select" ON public.photos;

CREATE POLICY "photos_select"
  ON public.photos
  FOR SELECT
  USING (
    public.auth_user_role() = 'super_admin'
    OR organization_id = public.auth_user_org()
    OR EXISTS (
      SELECT 1
      FROM public.reserves r
      LEFT JOIN public.chantiers c ON c.id = r.chantier_id
      WHERE r.id = photos.reserve_id
        AND COALESCE(r.organization_id, c.organization_id) = public.auth_user_org()
    )
  );

NOTIFY pgrst, 'reload schema';
