-- Migration : Ajout colonne last_read_by_channel dans profiles
-- Permet de synchroniser les badges de non-lus sur plusieurs appareils

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_read_by_channel jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.last_read_by_channel IS
  'Map channelId → ISO timestamp du dernier message lu par cet utilisateur. Synchronisé sur tous les appareils.';
