-- The chantier visibility helper is intentionally callable by authenticated
-- RLS policies. Pin its SECURITY DEFINER lookup path so caller-controlled
-- session settings cannot influence helper resolution. Untrusted API roles do
-- not have CREATE on either schema in this path.

do $$
begin
  if to_regprocedure('public.chantier_visible_to_current_user(uuid,jsonb)') is not null then
    execute 'alter function public.chantier_visible_to_current_user(uuid,jsonb) set search_path = pg_catalog, public';
  end if;
end
$$;

notify pgrst, 'reload schema';
