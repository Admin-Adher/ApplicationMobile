-- ============================================================
-- Migration : Accès messagerie pour le super_admin
-- Date : 2026-04-05
--
-- Problème : le super_admin était explicitement exclu de TOUTES
--   les policies channels et messages, l'empêchant de créer des
--   canaux, d'être ajouté à un groupe et d'envoyer des messages.
--
-- Solution :
--   1. Supprimer la clause NOT EXISTS (super_admin) des policies.
--   2. Le filtrage naturel par organization_id empêche déjà le
--      super_admin de lire les canaux organisationnels d'autres
--      entités (son org_id est NULL → aucun canal général/bâtiment/
--      entreprise ne correspond).
--   3. Ajouter des conditions spécifiques pour lui permettre de :
--      - voir les canaux de type group/dm dont il est membre,
--      - voir ses propres canaux custom (created_by),
--      - créer et gérer des canaux,
--      - envoyer et recevoir des messages dans ces canaux.
--
-- Idempotent : oui (DROP IF EXISTS avant chaque CREATE).
-- ============================================================

-- ── Fonctions d'aide (idempotentes) ──────────────────────────

CREATE OR REPLACE FUNCTION auth_user_org()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION auth_user_name()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT name FROM public.profiles WHERE id = auth.uid()
$$;

-- ============================================================
-- TABLE : channels
-- ============================================================

DROP POLICY IF EXISTS "Channels visibles par membres habilités"    ON public.channels;
DROP POLICY IF EXISTS "Channels modifiables par membres habilités" ON public.channels;

-- ── Lecture ──────────────────────────────────────────────────
-- Règle : chaque utilisateur (y compris super_admin) ne voit que :
--   • les canaux organisationnels (general/building/company/custom)
--     appartenant à son organisation (org_id NULL pour super_admin
--     → aucun canal d'organisation ne remonte),
--   • ses propres canaux custom sans organisation (created_by),
--   • les canaux group/dm dont son nom figure dans members.
CREATE POLICY "Channels visibles par membres habilités"
  ON public.channels FOR SELECT
  USING (
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    (
      type = 'custom'
      AND organization_id IS NULL
      AND created_by = auth_user_name()
    )
    OR
    (
      type IN ('group', 'dm')
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(members) AS m
        WHERE m = auth_user_name()
      )
    )
  );

-- ── Écriture (création / modification / suppression) ─────────
-- Règle :
--   • canaux organisationnels : même org que l'utilisateur
--   • canaux group/dm : créateur ou membre
--   • super_admin : peut créer et gérer n'importe quel canal
CREATE POLICY "Channels modifiables par membres habilités"
  ON public.channels FOR ALL
  USING (
    (
      type IN ('general', 'building', 'company', 'custom')
      AND organization_id = auth_user_org()
    )
    OR
    (
      type IN ('group', 'dm', 'custom')
      AND (
        created_by = auth_user_name()
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(members) AS m
          WHERE m = auth_user_name()
        )
      )
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ============================================================
-- TABLE : messages
-- ============================================================

DROP POLICY IF EXISTS "Messages visibles par membres habilités"    ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par membres habilités" ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables par expéditeur"        ON public.messages;
DROP POLICY IF EXISTS "Messages lisibles par tous"                 ON public.messages;
DROP POLICY IF EXISTS "Messages modifiables"                       ON public.messages;
DROP POLICY IF EXISTS "Messages insertables par authentifiés"      ON public.messages;

-- ── Lecture ──────────────────────────────────────────────────
-- Un utilisateur voit un message uniquement s'il a accès au canal.
-- Le super_admin ne voit que les messages de canaux où il est membre.
CREATE POLICY "Messages visibles par membres habilités"
  ON public.messages FOR SELECT
  USING (
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
            c.type = 'custom'
            AND c.organization_id IS NULL
            AND c.created_by = auth_user_name()
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
    -- DM local (canal non persisté dans channels)
    -- Format : dm-<NomA>__<NomB>
    (
      messages.channel_id LIKE 'dm-%'
      AND NOT EXISTS (
        SELECT 1 FROM public.channels WHERE id = messages.channel_id
      )
      AND (
        messages.channel_id LIKE 'dm-' || auth_user_name() || '__%'
        OR messages.channel_id LIKE 'dm-%__' || auth_user_name()
      )
    )
  );

-- ── Insertion ────────────────────────────────────────────────
-- L'expéditeur doit être l'utilisateur connecté
-- et avoir accès au canal de destination.
CREATE POLICY "Messages insertables par membres habilités"
  ON public.messages FOR INSERT
  WITH CHECK (
    sender = auth_user_name()
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
              c.type = 'custom'
              AND c.organization_id IS NULL
              AND c.created_by = auth_user_name()
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

-- ── Modification / suppression ───────────────────────────────
-- Uniquement ses propres messages (tous rôles confondus).
CREATE POLICY "Messages modifiables par expéditeur"
  ON public.messages FOR ALL
  USING (sender = auth_user_name());

-- ============================================================
-- Recharger le cache PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';
