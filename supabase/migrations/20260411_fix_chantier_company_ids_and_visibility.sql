-- ============================================================
-- Migration : Correction complète visibilité chantiers + canaux
-- Date      : 2026-04-11
--
-- Problèmes corrigés :
--
--  1. company_ids est stocké en TEXT au lieu de JSONB
--     → Les données arrivent comme "[\"co1\"]" (chaîne) au lieu
--       de ["co1"] (tableau). Le mapper frontend ne reconnaît
--       pas un tableau et met companyIds = undefined.
--
--  2. La politique RLS des chantiers ne vérifie PAS company_ids
--     → La migration 20260406 avait créé chantier_visible_to_current_user()
--       mais la migration 20260407 l'a écrasée avec une politique
--       qui ne vérifie que organization_id.
--     → Un utilisateur dont l'entreprise est dans company_ids
--       mais qui n'est pas admin/conducteur ne voit PAS le chantier.
--
--  3. Les tables liées (reserves, tasks, visites, lots, oprs,
--     site_plans) ont aussi perdu la visibilité par entreprise.
--
--  4. Les canaux "building" associés aux chantiers ne sont visibles
--     que si organization_id correspond, mais ne vérifient pas
--     si l'utilisateur fait partie d'une entreprise associée.
--
-- Solution :
--   a) Convertir company_ids TEXT → JSONB + backfill
--   b) Restaurer chantier_visible_to_current_user()
--   c) Mettre à jour les politiques RLS de toutes les tables
--   d) Ajouter la vérification company_ids aux canaux building
--
-- Idempotent : oui (DROP IF EXISTS avant chaque CREATE, OR REPLACE).
-- Coller et exécuter dans Supabase → SQL Editor → Run.
-- ============================================================

-- ── 0. Fonctions d'aide (idempotentes) ────────────────────────

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ── 0b. Fonction : company_id de l'utilisateur courant ────────

-- Supprimer l'ancienne version si elle existe (idempotent)
DROP FUNCTION IF EXISTS public.auth_user_company_id();

CREATE OR REPLACE FUNCTION public.auth_user_company_id()
RETURNS TEXT LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

-- ── 0c. Fonction : l'utilisateur est-il privilégié ? ─────────
-- Privileged = super_admin | admin | conducteur → voit tous les chantiers de l'org

-- Supprimer l'ancienne version si elle existe (idempotent)
DROP FUNCTION IF EXISTS public.auth_user_is_privileged();

CREATE OR REPLACE FUNCTION public.auth_user_is_privileged()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT role IN ('super_admin', 'admin', 'conducteur')
  FROM public.profiles WHERE id = auth.uid()
$$;

-- ── 0d. Fonction centrale : visibilité d'un chantier ──────────
-- Un chantier est visible par l'utilisateur courant si :
--   1. Super_admin → voit tout
--   2. Même organisation ET rôle privilégié → voit tout dans l'org
--   3. Même organisation ET chantier sans restriction d'entreprise → visible
--   4. Même organisation ET company_id de l'utilisateur dans company_ids → visible

-- Supprimer l'ancienne version (TEXT, JSONB) de la migration 20260406
-- pour éviter l'erreur "function name is not unique"
DROP FUNCTION IF EXISTS public.chantier_visible_to_current_user(TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.chantier_visible_to_current_user(
  p_org_id UUID,
  p_company_ids JSONB
)
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER STABLE AS $$
  SELECT
    CASE
      WHEN auth_user_role() = 'super_admin' THEN true
      WHEN p_org_id IS DISTINCT FROM auth_user_org() THEN false
      WHEN auth_user_is_privileged() THEN true
      WHEN p_company_ids IS NULL OR jsonb_array_length(p_company_ids) = 0 THEN true
      WHEN auth_user_company_id() IS NOT NULL
        AND p_company_ids @> to_jsonb(auth_user_company_id()) THEN true
      ELSE false
    END;
$$;

GRANT EXECUTE ON FUNCTION auth_user_org() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_user_name() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_user_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_user_is_privileged() TO authenticated;
GRANT EXECUTE ON FUNCTION chantier_visible_to_current_user TO authenticated;

-- ============================================================
-- PARTIE 1 : Convertir company_ids TEXT → JSONB
-- ============================================================

-- Étape 1a : Backfill les données text existantes vers du JSON valide
-- Si company_ids est déjà JSONB, cette UPDATE est un no-op sécurisé.
-- Si c'est du TEXT contenant du JSON valide, on le parse.
UPDATE public.chantiers
SET company_ids = company_ids::text::jsonb
WHERE company_ids IS NOT NULL
  AND pg_typeof(company_ids) IN ('text'::regtype, 'varchar'::regtype);

-- Étape 1b : Convertir le type de la colonne
-- Attention : cette commande échoue si la colonne contient du texte
-- qui n'est pas du JSON valide. L'étape 1a ci-dessus garantit que
-- les données sont converties avant le ALTER.
-- Si la colonne est déjà jsonb, c'est un no-op.
DO $$
BEGIN
  -- Vérifier le type actuel de la colonne
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chantiers'
      AND column_name = 'company_ids'
      AND data_type != 'jsonb'
      AND udt_name != 'jsonb'
  ) THEN
    -- La colonne existe mais n'est pas jsonb → convertir
    ALTER TABLE public.chantiers
      ALTER COLUMN company_ids TYPE JSONB
      USING company_ids::text::jsonb;
    RAISE NOTICE 'Colonne company_ids convertie TEXT → JSONB';
  ELSE
    RAISE NOTICE 'Colonne company_ids est déjà JSONB ou n''existe pas';
  END IF;
END;
$$;

-- Étape 1c : S'assurer que la colonne existe (si elle n'existait pas du tout)
ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS company_ids JSONB;

-- ============================================================
-- PARTIE 2 : CHANTIERS — politique SELECT avec company_ids
-- ============================================================

DROP POLICY IF EXISTS "Chantiers lisibles par tous les authentifiés" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers visibles par organisation" ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_select" ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_select_v2" ON public.chantiers;

CREATE POLICY "chantiers_select_v3" ON public.chantiers
  FOR SELECT TO authenticated
  USING (
    public.chantier_visible_to_current_user(organization_id, company_ids)
  );

-- ── CHANTIERS — politique WRITE ───────────────────────────────

DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur" ON public.chantiers;
DROP POLICY IF EXISTS "Chantiers modifiables par admin/conducteur de la même org" ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_write" ON public.chantiers;

CREATE POLICY "chantiers_write_v3" ON public.chantiers
  FOR ALL TO authenticated
  USING (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  )
  WITH CHECK (
    (organization_id = auth_user_org()
     AND auth_user_role() IN ('super_admin', 'admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 3 : RESERVES — visibilité par entreprise du chantier
-- ============================================================

DROP POLICY IF EXISTS "Reserves lisibles par tous" ON public.reserves;
DROP POLICY IF EXISTS "Reserves visibles par organisation" ON public.reserves;
DROP POLICY IF EXISTS "reserves_select" ON public.reserves;
DROP POLICY IF EXISTS "reserves_select_v2" ON public.reserves;

CREATE POLICY "reserves_select_v3" ON public.reserves
  FOR SELECT TO authenticated
  USING (
    -- Super admin voit tout
    auth_user_role() = 'super_admin'
    OR (
      -- Réserve dans la même organisation
      (
        organization_id = auth_user_org()
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = reserves.chantier_id
            AND c.organization_id = auth_user_org()
        )
      )
      AND (
        -- Pas de chantier associé → visible dans l'org
        reserves.chantier_id IS NULL
        OR
        -- Chantier visible via la fonction centralisée
        EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = reserves.chantier_id
            AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
        )
      )
    )
    -- Sous-traitant : voit les réserves de son entreprise
    OR (
      auth_user_role() = 'sous_traitant'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
          AND (
            reserves.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
            OR (reserves.companies IS NOT NULL AND reserves.companies::jsonb ? p.company_id)
          )
      )
    )
  );

-- ── RESERVES WRITE ────────────────────────────────────────────

DROP POLICY IF EXISTS "Reserves modifiables (create/edit)" ON public.reserves;
DROP POLICY IF EXISTS "Reserves modifiables par org" ON public.reserves;

CREATE POLICY "reserves_write_v3" ON public.reserves
  FOR ALL TO authenticated
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = reserves.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- Sous-traitant : mise à jour des réserves de son entreprise
DROP POLICY IF EXISTS "Reserves: sous_traitant peut requêter la levée" ON public.reserves;
CREATE POLICY "Reserves: sous_traitant peut requêter la levée"
  ON public.reserves FOR UPDATE TO authenticated
  USING (
    auth_user_role() = 'sous_traitant'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      LEFT JOIN public.companies co ON co.id = p.company_id
      WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
        AND (
          public.reserves.company = co.name
          OR (public.reserves.companies IS NOT NULL
              AND public.reserves.companies::jsonb ? p.company_id)
        )
    )
  );

-- ============================================================
-- PARTIE 4 : TASKS — visibilité par entreprise du chantier
-- ============================================================

DROP POLICY IF EXISTS "Tasks lisibles par tous" ON public.tasks;
DROP POLICY IF EXISTS "Tasks visibles par organisation" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select_v2" ON public.tasks;

CREATE POLICY "tasks_select_v3" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    auth_user_role() = 'super_admin'
    OR (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND (
        tasks.chantier_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = tasks.chantier_id
            AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
        )
      )
    )
    OR (
      auth_user_role() = 'sous_traitant'
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.company_id IS NOT NULL
          AND tasks.company = (SELECT name FROM public.companies WHERE id = p.company_id LIMIT 1)
      )
    )
  );

DROP POLICY IF EXISTS "Tasks modifiables" ON public.tasks;
DROP POLICY IF EXISTS "Tasks modifiables par org" ON public.tasks;

CREATE POLICY "tasks_write_v3" ON public.tasks
  FOR ALL TO authenticated
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = tasks.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 5 : VISITES — visibilité par entreprise du chantier
-- ============================================================

DROP POLICY IF EXISTS "Visites lisibles par tous" ON public.visites;
DROP POLICY IF EXISTS "Visites visibles par organisation" ON public.visites;
DROP POLICY IF EXISTS "visites_select" ON public.visites;
DROP POLICY IF EXISTS "visites_select_v2" ON public.visites;

CREATE POLICY "visites_select_v3" ON public.visites
  FOR SELECT TO authenticated
  USING (
    auth_user_role() = 'super_admin'
    OR (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = visites.chantier_id
          AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
      )
    )
  );

DROP POLICY IF EXISTS "Visites modifiables" ON public.visites;
DROP POLICY IF EXISTS "Visites modifiables par org" ON public.visites;

CREATE POLICY "visites_write_v3" ON public.visites
  FOR ALL TO authenticated
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = visites.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 6 : LOTS — visibilité par entreprise du chantier
-- ============================================================

DROP POLICY IF EXISTS "Lots lisibles par tous" ON public.lots;
DROP POLICY IF EXISTS "Lots visibles par organisation" ON public.lots;
DROP POLICY IF EXISTS "lots_select" ON public.lots;
DROP POLICY IF EXISTS "lots_select_v2" ON public.lots;

CREATE POLICY "lots_select_v3" ON public.lots
  FOR SELECT TO authenticated
  USING (
    auth_user_role() = 'super_admin'
    OR (
      organization_id = auth_user_org()
      AND (
        lots.chantier_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = lots.chantier_id
            AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
        )
      )
    )
  );

DROP POLICY IF EXISTS "Lots modifiables" ON public.lots;
DROP POLICY IF EXISTS "Lots modifiables par org" ON public.lots;

CREATE POLICY "lots_write_v3" ON public.lots
  FOR ALL TO authenticated
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = lots.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 7 : OPRS — visibilité par entreprise du chantier
-- ============================================================

DROP POLICY IF EXISTS "OPRs lisibles par tous" ON public.oprs;
DROP POLICY IF EXISTS "OPRs visibles par organisation" ON public.oprs;
DROP POLICY IF EXISTS "oprs_select" ON public.oprs;
DROP POLICY IF EXISTS "oprs_select_v2" ON public.oprs;

CREATE POLICY "oprs_select_v3" ON public.oprs
  FOR SELECT TO authenticated
  USING (
    auth_user_role() = 'super_admin'
    OR (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = oprs.chantier_id
          AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
      )
    )
  );

DROP POLICY IF EXISTS "OPRs modifiables" ON public.oprs;
DROP POLICY IF EXISTS "OPRs modifiables par org" ON public.oprs;

CREATE POLICY "oprs_write_v3" ON public.oprs
  FOR ALL TO authenticated
  USING (
    (
      (organization_id = auth_user_org()
       OR EXISTS (
         SELECT 1 FROM public.chantiers c
         WHERE c.id = oprs.chantier_id AND c.organization_id = auth_user_org()
       ))
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 8 : SITE_PLANS — visibilité par entreprise du chantier
-- ============================================================

DROP POLICY IF EXISTS "Site plans lisibles par tous" ON public.site_plans;
DROP POLICY IF EXISTS "Site plans visibles par organisation" ON public.site_plans;
DROP POLICY IF EXISTS "site_plans_select" ON public.site_plans;
DROP POLICY IF EXISTS "site_plans_select_v2" ON public.site_plans;

CREATE POLICY "site_plans_select_v3" ON public.site_plans
  FOR SELECT TO authenticated
  USING (
    auth_user_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.id = site_plans.chantier_id
        AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
    )
  );

DROP POLICY IF EXISTS "Site plans modifiables" ON public.site_plans;
DROP POLICY IF EXISTS "Site plans modifiables par org" ON public.site_plans;

CREATE POLICY "site_plans_write_v3" ON public.site_plans
  FOR ALL TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.chantiers c
        WHERE c.id = site_plans.chantier_id AND c.organization_id = auth_user_org()
      )
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 9 : CHANNELS — visibilité building par entreprise
-- ============================================================

DROP POLICY IF EXISTS "Channels lisibles par tous" ON public.channels;
DROP POLICY IF EXISTS "Channels visibles par membres habilités" ON public.channels;

CREATE POLICY "Channels visibles par membres habilités"
  ON public.channels FOR SELECT TO authenticated
  USING (
    -- Canaux d'organisation (general / building / company / custom avec org)
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
      -- Pour les canaux "building", vérifier aussi la visibilité du chantier
      AND (
        type != 'building'
        OR NOT EXISTS (
          SELECT 1 FROM public.chantiers c
          WHERE c.id = REPLACE(channels.id, 'building-', '')
            AND NOT public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
        )
      )
    )
    OR
    -- Canal custom créé par l'utilisateur (org_id peut être NULL : race condition login)
    (
      type = 'custom'
      AND created_by = auth_user_name()
    )
    OR
    -- Canaux privés (groupe, DM) : nom de l'utilisateur dans members
    (
      type IN ('group', 'dm')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )
    -- Super-admin voit tout
    OR auth_user_role() = 'super_admin'
  );

-- ── CHANNELS WRITE ────────────────────────────────────────────

DROP POLICY IF EXISTS "Channels modifiables" ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;

CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL TO authenticated
  USING (
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    (
      type = 'custom'
      AND created_by = auth_user_name()
    )
    OR
    (
      type IN ('group', 'dm')
      AND (
        created_by = auth_user_name()
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(members) AS m
          WHERE m = auth_user_name()
        )
      )
    )
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 10 : PHOTOS — via reserve → chantier
-- ============================================================

DROP POLICY IF EXISTS "Photos lisibles par tous" ON public.photos;
DROP POLICY IF EXISTS "Photos visibles par organisation" ON public.photos;

CREATE POLICY "Photos visibles par organisation"
  ON public.photos FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reserves r
      JOIN public.chantiers c ON c.id = r.chantier_id
      WHERE r.id = photos.reserve_id
        AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
    )
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL)
    OR auth_user_role() = 'super_admin'
  );

DROP POLICY IF EXISTS "Photos modifiables" ON public.photos;
DROP POLICY IF EXISTS "Photos modifiables par org" ON public.photos;

CREATE POLICY "Photos modifiables par org"
  ON public.photos FOR ALL TO authenticated
  USING (
    (
      EXISTS (
        SELECT 1 FROM public.reserves r
        JOIN public.chantiers c ON c.id = r.chantier_id
        WHERE r.id = photos.reserve_id
          AND public.chantier_visible_to_current_user(c.organization_id, c.company_ids)
      )
      AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe')
    )
    OR (photos.reserve_id IS NULL AND auth_user_org() IS NOT NULL
        AND auth_user_role() IN ('admin', 'conducteur', 'chef_equipe'))
    OR auth_user_role() = 'super_admin'
  );

-- ============================================================
-- PARTIE 11 : MESSAGES — canaux building par entreprise
-- ============================================================

DROP POLICY IF EXISTS "Messages lisibles par tous" ON public.messages;
DROP POLICY IF EXISTS "Messages visibles par membres habilités" ON public.messages;

CREATE POLICY "Messages visibles par membres habilités"
  ON public.messages FOR SELECT TO authenticated
  USING (
    -- 1. L'expéditeur voit toujours ses propres messages
    sender = auth_user_name()

    OR

    -- 2. Canaux généraux / bâtiment / company persistés
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type IN ('general', 'building', 'company')
        AND c.organization_id = auth_user_org()
        -- Pour building, vérifier aussi la visibilité du chantier
        AND (
          c.type != 'building'
          OR NOT EXISTS (
            SELECT 1 FROM public.chantiers ch
            WHERE ch.id = REPLACE(c.id, 'building-', '')
              AND NOT public.chantier_visible_to_current_user(ch.organization_id, ch.company_ids)
          )
        )
    )

    OR

    -- 3. Canaux custom : l'utilisateur est dans members
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'custom'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 4. Canaux groupe
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'group'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 5. Canaux entreprise virtuels (ID = 'company-{companies.id}')
    (
      messages.channel_id LIKE 'company-%'
      AND auth_user_org() IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.companies co
        WHERE co.id = SUBSTRING(messages.channel_id FROM 9)
          AND (co.organization_id = auth_user_org() OR co.organization_id IS NULL)
      )
    )

    OR

    -- 6. Canaux DM persistés
    EXISTS (
      SELECT 1 FROM public.channels c
      WHERE c.id = messages.channel_id
        AND c.type = 'dm'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
          WHERE m = auth_user_name()
        )
    )

    OR

    -- 7. Canaux DM locaux (non persistés)
    (
      messages.channel_id LIKE 'dm-%'
      AND NOT EXISTS (SELECT 1 FROM public.channels WHERE id = messages.channel_id)
      AND (
        messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
        OR messages.channel_id LIKE 'dm-%__' || auth_user_name()
      )
    )
  );

-- ── MESSAGES INSERT ───────────────────────────────────────────

DROP POLICY IF EXISTS "Messages insertables par authentifiés" ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;

CREATE POLICY "Messages insertables par membres habilités"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender = auth_user_name()
    AND (
      -- Canal général / bâtiment / company
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type IN ('general', 'building', 'company')
          AND c.organization_id = auth_user_org()
          AND (
            c.type != 'building'
            OR NOT EXISTS (
              SELECT 1 FROM public.chantiers ch
              WHERE ch.id = REPLACE(c.id, 'building-', '')
                AND NOT public.chantier_visible_to_current_user(ch.organization_id, ch.company_ids)
            )
          )
      )
      OR
      -- Canal custom : membre
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'custom'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )
      OR
      -- Canal groupe : membre
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'group'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )
      OR
      -- Canal entreprise virtuel
      (
        messages.channel_id LIKE 'company-%'
        AND auth_user_org() IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.companies co
          WHERE co.id = SUBSTRING(messages.channel_id FROM 9)
            AND (co.organization_id = auth_user_org() OR co.organization_id IS NULL)
        )
      )
      OR
      -- Canal DM persisté
      EXISTS (
        SELECT 1 FROM public.channels c
        WHERE c.id = messages.channel_id
          AND c.type = 'dm'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(c.members) AS m
            WHERE m = auth_user_name()
          )
      )
      OR
      -- Canal DM local
      (
        messages.channel_id LIKE 'dm-%'
        AND (
          messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
          OR messages.channel_id LIKE 'dm-%__' || auth_user_name()
        )
      )
    )
  );

-- ── MESSAGES UPDATE / DELETE ──────────────────────────────────

DROP POLICY IF EXISTS "Messages modifiables" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables par expéditeur" ON public.messages;

CREATE POLICY "Messages modifiables par expéditeur"
  ON public.messages FOR ALL TO authenticated
  USING (sender = auth_user_name());

-- ============================================================
-- PARTIE 12 : COMPANIES — ajouter company_id aux profils
-- ============================================================
-- S'assurer que la colonne company_id existe dans profiles

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id TEXT REFERENCES public.companies(id);

-- ============================================================
-- PARTIE 13 : Index pour performance ─────────────────────────
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_chantiers_org ON public.chantiers(organization_id);
CREATE INDEX IF NOT EXISTS idx_chantiers_company_ids ON public.chantiers USING gin(company_ids);
CREATE INDEX IF NOT EXISTS idx_profiles_company_id ON public.profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_reserves_chantier ON public.reserves(chantier_id);
CREATE INDEX IF NOT EXISTS idx_reserves_org ON public.reserves(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_chantier ON public.tasks(chantier_id);
CREATE INDEX IF NOT EXISTS idx_tasks_org ON public.tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_visites_chantier ON public.visites(chantier_id);
CREATE INDEX IF NOT EXISTS idx_visites_org ON public.visites(organization_id);
CREATE INDEX IF NOT EXISTS idx_lots_chantier ON public.lots(chantier_id);
CREATE INDEX IF NOT EXISTS idx_lots_org ON public.lots(organization_id);
CREATE INDEX IF NOT EXISTS idx_oprs_chantier ON public.oprs(chantier_id);
CREATE INDEX IF NOT EXISTS idx_oprs_org ON public.oprs(organization_id);
CREATE INDEX IF NOT EXISTS idx_site_plans_chantier ON public.site_plans(chantier_id);
CREATE INDEX IF NOT EXISTS idx_site_plans_org ON public.site_plans(organization_id);
CREATE INDEX IF NOT EXISTS idx_photos_reserve ON public.photos(reserve_id);
CREATE INDEX IF NOT EXISTS idx_companies_org ON public.companies(organization_id);
CREATE INDEX IF NOT EXISTS idx_documents_org ON public.documents(organization_id);
CREATE INDEX IF NOT EXISTS idx_incidents_org ON public.incidents(organization_id);
CREATE INDEX IF NOT EXISTS idx_channels_org ON public.channels(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_created_at ON public.messages(channel_id, created_at desc);

-- ============================================================
-- Recharger le cache PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Vérification (exécuter manuellement pour confirmer)
-- ============================================================
-- SELECT tablename, policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('chantiers','reserves','tasks','visites',
--                     'lots','oprs','site_plans','channels',
--                     'messages','photos')
-- ORDER BY tablename, cmd;
