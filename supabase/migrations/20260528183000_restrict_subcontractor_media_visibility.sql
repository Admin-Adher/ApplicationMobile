-- Restrict media visibility for subcontractors.
-- Photos remain visible when they are attached to one of the subcontractor's
-- reserves. Generic documents are hidden because they have no company/reserve
-- ownership column yet.

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DO $block$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'photos'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.photos', v_policy.policyname);
  END LOOP;

  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'documents'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.documents', v_policy.policyname);
  END LOOP;
END;
$block$;

CREATE POLICY photos_select
  ON public.photos
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'sous_traitant'
      AND photos.reserve_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.reserves r
        WHERE r.id = photos.reserve_id
          AND public.reserve_matches_current_user_company(r.company, r.companies)
      )
    )
    OR (
      public.auth_user_role() IS NOT NULL
      AND public.auth_user_role() <> 'sous_traitant'
      AND (
        photos.organization_id = public.auth_user_org()
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

CREATE POLICY photos_write
  ON public.photos
  FOR ALL
  TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() = 'sous_traitant'
      AND photos.reserve_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.reserves r
        WHERE r.id = photos.reserve_id
          AND public.reserve_matches_current_user_company(r.company, r.companies)
      )
    )
    OR (
      public.auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
      AND (
        (photos.reserve_id IS NULL AND photos.organization_id = public.auth_user_org())
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
      public.auth_user_role() = 'sous_traitant'
      AND photos.reserve_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.reserves r
        WHERE r.id = photos.reserve_id
          AND public.reserve_matches_current_user_company(r.company, r.companies)
      )
    )
    OR (
      public.auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
      AND (
        (photos.reserve_id IS NULL AND photos.organization_id = public.auth_user_org())
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

CREATE POLICY documents_select
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() IS NOT NULL
      AND public.auth_user_role() <> 'sous_traitant'
      AND (
        documents.organization_id = public.auth_user_org()
        OR EXISTS (
          SELECT 1
          FROM public.chantiers c
          WHERE c.id = documents.chantier_id
            AND c.organization_id = public.auth_user_org()
        )
      )
    )
  );

CREATE POLICY documents_write
  ON public.documents
  FOR ALL
  TO authenticated
  USING (
    public.auth_user_role() = 'super_admin'
    OR (
      public.auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
      AND (
        documents.organization_id = public.auth_user_org()
        OR EXISTS (
          SELECT 1
          FROM public.chantiers c
          WHERE c.id = documents.chantier_id
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
        documents.organization_id = public.auth_user_org()
        OR EXISTS (
          SELECT 1
          FROM public.chantiers c
          WHERE c.id = documents.chantier_id
            AND c.organization_id = public.auth_user_org()
        )
      )
    )
  );

DO $block$
DECLARE
  v_photo_select_count integer;
  v_document_select_count integer;
BEGIN
  SELECT count(*)
  INTO v_photo_select_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'photos'
    AND cmd = 'SELECT';

  IF v_photo_select_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 SELECT policy on public.photos, found %', v_photo_select_count;
  END IF;

  SELECT count(*)
  INTO v_document_select_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'documents'
    AND cmd = 'SELECT';

  IF v_document_select_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 SELECT policy on public.documents, found %', v_document_select_count;
  END IF;
END;
$block$;

NOTIFY pgrst, 'reload schema';
