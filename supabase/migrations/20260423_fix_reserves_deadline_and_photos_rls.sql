-- ============================================================
-- FIX : deadline NOT NULL + politique RLS photos
-- Date : 2026-04-23
--
-- Bug 1 : "null value in column 'deadline' of relation 'reserves'
--          violates not-null constraint"
--   → La colonne deadline est marquée NOT NULL mais le champ est
--     optionnel dans l'UI. On la rend nullable.
--
-- Bug 2 : "new row violates row-level security policy for table 'photos'"
--   → La politique photos FOR ALL vérifie l'organization_id via la
--     table reserves (JOIN), mais la photo porte déjà directement
--     son organization_id. On ajoute cette vérification directe.
-- ============================================================

-- ── Fix 1 : colonnes NOT NULL mais optionnelles dans reserves ────────
-- Ces colonnes ont des défauts dans le schéma mais l'app peut envoyer
-- null pour les champs non remplis → on les rend toutes nullable.
ALTER TABLE public.reserves ALTER COLUMN deadline DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN description DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN building DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN zone DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN level DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN company DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN plan_x DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN plan_y DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN comments DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN history DROP NOT NULL;
ALTER TABLE public.reserves ALTER COLUMN created_at DROP NOT NULL;

-- Même chose pour tasks
ALTER TABLE public.tasks ALTER COLUMN deadline DROP NOT NULL;

-- ── Fix 2 : politique RLS photos — autoriser via organization_id direct
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;
CREATE POLICY "Photos visibles par organisation"
  ON public.photos FOR SELECT
  USING (
    organization_id = auth_user_org()
    OR auth_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.reserves r
      WHERE r.id = photos.reserve_id
        AND r.organization_id = auth_user_org()
    )
  );

DROP POLICY IF EXISTS "Photos modifiables par org" ON public.photos;
CREATE POLICY "Photos modifiables par org"
  ON public.photos FOR ALL
  USING (
    auth_user_role() = 'super_admin'
    OR (
      auth_user_role() IN ('admin', 'conducteur', 'chef_equipe', 'super_admin')
      AND (
        -- Vérification directe via organization_id de la photo (cas normal)
        organization_id = auth_user_org()
        -- Vérification via la réserve liée (cas où organization_id est absent)
        OR EXISTS (
          SELECT 1 FROM public.reserves r
          WHERE r.id = photos.reserve_id
            AND r.organization_id = auth_user_org()
        )
        OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
      )
    )
  );

NOTIFY pgrst, 'reload schema';
