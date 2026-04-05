-- Migration: Correctif confidentialité — messages et canaux
-- Date: 2026-04-05
-- Problème: La migration rebuild_messages_table.sql a écrasé les policies
--           restrictives (fix_channels_messages_rls.sql) par des policies
--           permissives "auth.role() = 'authenticated'", permettant au
--           super_admin de lire TOUS les messages de TOUTES les organisations.
-- Solution: Restaurer des policies strictement isolées par organisation,
--           avec exclusion explicite du rôle super_admin.
-- Idempotent: oui (DROP IF EXISTS avant chaque CREATE).

-- ============================================================
-- Fonctions d'aide SECURITY DEFINER (idempotentes)
-- ============================================================

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

-- ============================================================
-- TABLE : channels — policies définitives
-- ============================================================

-- Supprimer toutes les policies existantes (permissives ou obsolètes)
DROP POLICY IF EXISTS "Channels lisibles par tous"              ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables"                    ON public.channels;
DROP POLICY IF EXISTS "Channels visibles par membres habilités" ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;

-- Lecture : membres de la même org (canaux orga) ou participants (DM/groupe)
-- Le super_admin est exclu : organization_id IS NULL pour lui, aucun canal ne matche.
CREATE POLICY "Channels visibles par membres habilités"
  ON public.channels FOR SELECT
  USING (
    -- Exclure explicitement le super_admin
    NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    AND (
      -- Canaux d'organisation : même org que l'utilisateur
      (
        type IN ('general', 'building', 'company', 'custom')
        AND organization_id = auth_user_org()
      )
      OR
      -- Canaux privés (groupe, DM) : le nom de l'utilisateur est dans members
      (
        type IN ('group', 'dm')
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(members) AS m
          WHERE m = auth_user_name()
        )
      )
    )
  );

-- Écriture (création / modification / suppression)
CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    AND (
      (
        type IN ('general', 'building', 'company', 'custom')
        AND organization_id = auth_user_org()
      )
      OR
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
    )
  );

-- ============================================================
-- TABLE : messages — policies définitives
-- ============================================================

-- Supprimer toutes les policies existantes (permissives ou obsolètes)
DROP POLICY IF EXISTS "Messages lisibles par tous"                 ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables"                       ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par authentifiés"      ON public.messages;
DROP POLICY IF EXISTS "Messages visibles par membres habilités"    ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables par expéditeur"        ON public.messages;

-- Lecture : uniquement si l'utilisateur a accès au canal correspondant
CREATE POLICY "Messages visibles par membres habilités"
  ON public.messages FOR SELECT
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    AND (
      -- Cas 1 : canal présent dans la table channels → vérifier l'accès au canal
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
      -- Cas 2 : DM local (canal non persisté) — format dm-<NomA>__<NomB>
      (
        messages.channel_id LIKE 'dm-%'
        AND (
          messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
          OR messages.channel_id LIKE 'dm-%__' || auth_user_name()
        )
      )
    )
  );

-- Insertion : l'expéditeur doit être l'utilisateur connecté et avoir accès au canal
CREATE POLICY "Messages insertables par membres habilités"
  ON public.messages FOR INSERT
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    AND sender = auth_user_name()
    AND (
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
      (
        messages.channel_id LIKE 'dm-%'
        AND (
          messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
          OR messages.channel_id LIKE 'dm-%__' || auth_user_name()
        )
      )
    )
  );

-- Modification / suppression : uniquement ses propres messages, jamais super_admin
CREATE POLICY "Messages modifiables par expéditeur"
  ON public.messages FOR ALL
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
    AND sender = auth_user_name()
  );

-- ============================================================
-- Recharger le cache PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';
