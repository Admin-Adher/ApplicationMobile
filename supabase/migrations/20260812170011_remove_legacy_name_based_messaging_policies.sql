-- Cleanup for catalogues where accented legacy policy identifiers were stored
-- with a different Unicode encoding. UUID restrictive policies are already in
-- force; this removes the now-dead permissive rules themselves.
do $cleanup$
declare
  v_policy record;
begin
  for v_policy in
    select p.tablename, p.policyname
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('channels', 'messages')
      and (
        coalesce(p.qual, '') ilike '%auth_user_name%'
        or coalesce(p.with_check, '') ilike '%auth_user_name%'
        or coalesce(p.qual, '') ilike '%jsonb_array_elements_text%members%'
        or coalesce(p.with_check, '') ilike '%jsonb_array_elements_text%members%'
      )
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      v_policy.policyname,
      v_policy.tablename
    );
  end loop;
end
$cleanup$;
