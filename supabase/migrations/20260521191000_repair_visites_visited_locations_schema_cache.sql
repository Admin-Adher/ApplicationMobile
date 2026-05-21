-- Repare les projets Supabase ou la colonne visited_locations manque encore
-- ou existe cote Postgres mais n'est pas visible dans le cache PostgREST.
--
-- Symptome cote app :
-- [PGRST204] Could not find the 'visited_locations' column of 'visites'
-- in the schema cache.

alter table public.visites
  add column if not exists visited_locations jsonb default '[]'::jsonb;

update public.visites
set visited_locations = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object(
    'buildingName', building,
    'defaultPlanId', default_plan_id
  ))
)
where (visited_locations is null or visited_locations = '[]'::jsonb)
  and building is not null
  and building <> '';

notify pgrst, 'reload schema';
