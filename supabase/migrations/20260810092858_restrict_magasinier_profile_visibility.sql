-- A magasinier needs their own profile for authentication and account
-- settings, but must not use the generic organization profile policy to list
-- the rest of the team.
drop policy if exists magasinier_own_profile_only on public.profiles;
create policy magasinier_own_profile_only
on public.profiles
as restrictive
for select
to authenticated
using (
  (select public.auth_user_role()) <> 'magasinier'
  or id = (select auth.uid())
);
