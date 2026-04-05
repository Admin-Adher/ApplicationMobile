-- Migration : ajout des champs tags, photo, plan et checklist sur les visites
ALTER TABLE visites
  ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS cover_photo_uri text,
  ADD COLUMN IF NOT EXISTS default_plan_id text,
  ADD COLUMN IF NOT EXISTS checklist_items jsonb DEFAULT '[]';
