-- Ajoute le périmètre multi-bâtiments d'une visite.
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
