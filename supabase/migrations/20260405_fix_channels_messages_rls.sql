-- ============================================================
-- Migration : Sécurisation RLS des canaux et des messages
-- Problème : Les politiques actuelles ("lisibles par tous les
--            authentifiés") exposent tous les canaux et tous
--            les messages à n'importe quel utilisateur connecté,
--            quelle que soit son organisation ou son appartenance
--            au canal.
--
-- Solution :
--   1. Fonctions d'aide SECURITY DEFINER pour éviter la
--      récursion RLS sur public.profiles.
--   2. Canaux organisationnels (general, building, company,
--      custom) : visibles uniquement par les membres de la
--      même organisation.
--   3. Canaux groupe et DM : visibles uniquement si le nom de
--      l'utilisateur figure dans le tableau JSONB "members".
--   4. Messages : visibles uniquement si l'utilisateur a accès
--      au canal correspondant.
--   5. Messages DM locaux (non persistés dans "channels") :
--      accessibles via le format de l'identifiant du canal.
-- ============================================================

-- ---- 0. Fonctions d'aide ----

-- Renvoie l'organization_id du compte connecté
CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT organization_id
  FROM public.profiles
  WHERE id = auth.uid()
$$;

-- Renvoie le nom d'affichage du compte connecté
CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT name
  FROM public.profiles
  WHERE id = auth.uid()
$$;

-- ---- 1. Politiques RLS — table channels ----

-- Lecture
DROP POLICY IF EXISTS "Channels lisibles par tous" ON public.channels;
DROP POLICY IF EXISTS "Channels visibles par membres habilités" ON public.channels;
CREATE POLICY "Channels visibles par membres habilités"
  ON public.channels FOR SELECT
  USING (
    -- Canaux d'organisation : même org que l'utilisateur
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    -- Canaux privés (groupe, DM) : nom de l'utilisateur présent
    -- dans le tableau JSONB members
    (
      type IN ('group', 'dm')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )
  );

-- Écriture (création / modification / suppression)
DROP POLICY IF EXISTS "Channels modifiables" ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;
CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL
  USING (
    -- Seuls les membres de la même org peuvent agir sur les
    -- canaux organisationnels
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    -- Pour les canaux privés, le créateur ou un membre peut agir
    (
      type IN ('group', 'dm')
      AND (
        created_by = auth_user_name()
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(members) AS m
          WHERE m = auth_user_name()
        )
      )
    )
  );

-- ---- 2. Politiques RLS — table messages ----

-- Helper interne : l'utilisateur a-t-il accès au canal ?
-- (Utilisé dans deux politiques, factorisé ici en commentaire
--  pour clarté — répété dans chaque politique.)

-- Lecture
DROP POLICY IF EXISTS "Messages lisibles par tous" ON public.messages;
DROP POLICY IF EXISTS "Messages visibles par membres habilités" ON public.messages;
CREATE POLICY "Messages visibles par membres habilités"
  ON public.messages FOR SELECT
  USING (
    -- Cas 1 : canal présent dans la table channels
    EXISTS (
      SELECT 1
      FROM public.channels c
      WHERE c.id = messages.channel_id
        AND (
          -- Canal organisationnel → même org
          (
            c.type IN ('general', 'building', 'company', 'custom')
            AND c.organization_id = auth_user_org()
          )
          OR
          -- Canal privé → nom de l'utilisateur dans members
          (
            c.type IN ('group', 'dm')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(c.members) AS m
              WHERE m = auth_user_name()
            )
          )
        )
    )
    OR
    -- Cas 2 : canal DM local (non persisté dans channels)
    -- Format ID : "dm-NomA__NomB" (noms triés alphabétiquement)
    (
      messages.channel_id LIKE 'dm-%'
      AND NOT EXISTS (
        SELECT 1 FROM public.channels WHERE id = messages.channel_id
      )
      AND (
        -- Nom de l'utilisateur en première position (après "dm-")
        messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
        OR
        -- Nom de l'utilisateur en seconde position (après "__")
        messages.channel_id LIKE 'dm-%__' || auth_user_name()
      )
    )
  );

-- Insertion : l'expéditeur doit être l'utilisateur connecté
--             et avoir accès au canal
DROP POLICY IF EXISTS "Messages insertables par authentifiés" ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;
CREATE POLICY "Messages insertables par membres habilités"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender = auth_user_name()
    AND (
      -- Canal présent dans la table channels
      EXISTS (
        SELECT 1
        FROM public.channels c
        WHERE c.id = messages.channel_id
          AND (
            (
              c.type IN ('general', 'building', 'company', 'custom')
              AND c.organization_id = auth_user_org()
            )
            OR
            (
              c.type IN ('group', 'dm')
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements_text(c.members) AS m
                WHERE m = auth_user_name()
              )
            )
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

-- Modification / suppression : uniquement ses propres messages
DROP POLICY IF EXISTS "Messages modifiables" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables par expéditeur" ON public.messages;
CREATE POLICY "Messages modifiables par expéditeur"
  ON public.messages FOR ALL
  USING (sender = auth_user_name());
