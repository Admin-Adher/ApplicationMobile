-- Migration : RPC atomique pour toggle réaction sur un message
-- Évite la race condition quand deux utilisateurs réagissent simultanément

CREATE OR REPLACE FUNCTION public.toggle_message_reaction(
  p_message_id text,
  p_emoji      text,
  p_user_name  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_users jsonb;
  v_new_users     jsonb;
BEGIN
  SELECT COALESCE(reactions->p_emoji, '[]'::jsonb)
  INTO   v_current_users
  FROM   messages
  WHERE  id = p_message_id;

  IF NOT FOUND THEN RETURN; END IF;

  IF v_current_users @> jsonb_build_array(p_user_name) THEN
    -- Retirer l'utilisateur
    SELECT jsonb_agg(u)
    INTO   v_new_users
    FROM   jsonb_array_elements_text(v_current_users) AS u
    WHERE  u <> p_user_name;

    IF v_new_users IS NULL THEN
      UPDATE messages
      SET    reactions = reactions - p_emoji
      WHERE  id = p_message_id;
    ELSE
      UPDATE messages
      SET    reactions = jsonb_set(reactions, ARRAY[p_emoji], v_new_users)
      WHERE  id = p_message_id;
    END IF;
  ELSE
    -- Ajouter l'utilisateur
    v_new_users := v_current_users || jsonb_build_array(p_user_name);
    UPDATE messages
    SET    reactions = jsonb_set(reactions, ARRAY[p_emoji], v_new_users)
    WHERE  id = p_message_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_message_reaction(text, text, text) TO authenticated;
