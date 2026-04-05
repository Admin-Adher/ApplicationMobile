-- Migration : ajout des champs heure et deadline de levée sur les visites
ALTER TABLE visites
  ADD COLUMN IF NOT EXISTS start_time text,
  ADD COLUMN IF NOT EXISTS end_time text,
  ADD COLUMN IF NOT EXISTS reserve_deadline_date text;
