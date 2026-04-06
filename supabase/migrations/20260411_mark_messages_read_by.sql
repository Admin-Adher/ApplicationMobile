-- ============================================================
-- Migration : RPC mark_messages_read_by
-- Date      : 2026-04-11
--
-- Permet de marquer un ensemble de messages comme lus par un
-- utilisateur en une seule requête, sans exposer d'informations
-- supplémentaires (SECURITY DEFINER limité aux messages accessibles).
--
-- Utilisé par setChannelRead() dans AppContext pour persister
-- le champ read_by de chaque message quand un canal est ouvert.
-- ============================================================
CREATE OR REPLACE FUNCTION mark_messages_read_by(
  p_message_ids text[],
  p_user_name   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.messages
  SET read_by = read_by || to_jsonb(p_user_name)
  WHERE id = ANY(p_message_ids)
    AND sender != p_user_name
    AND NOT (read_by @> to_jsonb(p_user_name));
END;
$$;

-- Seuls les utilisateurs authentifiés peuvent appeler cette fonction
REVOKE ALL ON FUNCTION mark_messages_read_by(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_messages_read_by(text[], text) TO authenticated;
