-- ============================================================
-- Migration : Super Admin Hub — accès cross-orgs + annonces
-- Date : 2026-04-17
--
-- Objectif : permettre au super_admin de voir et interagir avec
--   tous les canaux de toutes les organisations via le Hub.
--
-- Changements :
--   1. Nouvelle politique SELECT sur channels → super_admin voit tout
--   2. Nouvelle politique SELECT sur messages → super_admin voit tout
--   3. RPC send_announcement_message (SECURITY DEFINER) pour que
--      le super_admin puisse poster dans n'importe quel canal
--      organisationnel sans modifier les politiques INSERT générales.
--
-- Idempotent : oui (CREATE OR REPLACE / DROP IF EXISTS).
-- ============================================================

-- ── Fonction helper pour récupérer le rôle de l'utilisateur courant ──

CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- ============================================================
-- TABLE : channels — politique lecture super_admin
-- ============================================================

DROP POLICY IF EXISTS "Super admin lit tous les canaux" ON public.channels;

CREATE POLICY "Super admin lit tous les canaux"
  ON public.channels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ============================================================
-- TABLE : messages — politique lecture super_admin
-- ============================================================

DROP POLICY IF EXISTS "Super admin lit tous les messages" ON public.messages;

CREATE POLICY "Super admin lit tous les messages"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- ============================================================
-- RPC : send_announcement_message
-- Permet au super_admin de poster dans n'importe quel canal.
-- Vérifie que l'appelant est bien super_admin avant d'insérer.
-- ============================================================

CREATE OR REPLACE FUNCTION send_announcement_message(
  p_channel_id  text,
  p_content     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sender text;
BEGIN
  -- Vérification : réservé au super_admin
  SELECT name INTO v_sender
  FROM public.profiles
  WHERE id = auth.uid() AND role = 'super_admin';

  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'Accès refusé — réservé au super administrateur';
  END IF;

  -- Vérification : le canal doit exister
  IF NOT EXISTS (SELECT 1 FROM public.channels WHERE id = p_channel_id) THEN
    RAISE EXCEPTION 'Canal introuvable : %', p_channel_id;
  END IF;

  INSERT INTO public.messages (
    id, channel_id, sender, content, created_at, type, reactions, is_pinned, read_by
  ) VALUES (
    gen_random_uuid()::text,
    p_channel_id,
    v_sender,
    p_content,
    now(),
    'notification',
    '{}'::jsonb,
    false,
    ARRAY[v_sender]
  );
END;
$$;

-- Accorder l'exécution à tous les utilisateurs authentifiés
-- (la fonction vérifie elle-même que c'est bien un super_admin)
GRANT EXECUTE ON FUNCTION send_announcement_message(text, text) TO authenticated;

-- ============================================================
-- Recharger le cache PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';
