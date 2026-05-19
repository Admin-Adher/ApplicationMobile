-- Ajoute les champs de visite envoyes par l'application mobile mais absents
-- de certains projets Supabase existants.
--
-- Sans ces colonnes, PostgREST refuse la synchronisation offline avec :
-- [PGRST204] Could not find the 'checklist_items' column of 'visites'
-- in the schema cache.

alter table public.visites
  add column if not exists tags jsonb default '[]'::jsonb,
  add column if not exists cover_photo_uri text,
  add column if not exists default_plan_id text,
  add column if not exists checklist_items jsonb default '[]'::jsonb;

notify pgrst, 'reload schema';
