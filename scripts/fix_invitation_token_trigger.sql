-- ============================================================
-- Fix : Auto-générer le token d'invitation + expires_at
-- À exécuter dans le SQL Editor du dashboard Supabase
-- ============================================================

-- 1. Vérifier la structure de la table invitations
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invitations'
ORDER BY ordinal_position;

-- 2. Ajouter une valeur par défaut pour 'token' si elle n'existe pas
ALTER TABLE public.invitations
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(32), 'hex');

-- 3. Ajouter une valeur par défaut pour 'expires_at' si elle n'existe pas (7 jours)
ALTER TABLE public.invitations
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

-- 4. Créer la fonction de trigger pour garantir token + expires_at même si omis dans l'INSERT
CREATE OR REPLACE FUNCTION public.generate_invitation_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.token IS NULL THEN
    NEW.token := encode(gen_random_bytes(32), 'hex');
  END IF;
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + interval '7 days';
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Créer le trigger (DROP IF EXISTS pour éviter les doublons)
DROP TRIGGER IF EXISTS trg_generate_invitation_token ON public.invitations;

CREATE TRIGGER trg_generate_invitation_token
  BEFORE INSERT ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_invitation_token();

-- 6. Vérifier que le trigger est bien créé
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation AS event,
  action_timing AS timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table = 'invitations'
ORDER BY trigger_name;
