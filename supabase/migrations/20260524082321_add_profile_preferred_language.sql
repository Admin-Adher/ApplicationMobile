alter table public.profiles
  add column if not exists preferred_language text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_preferred_language_check'
  ) then
    alter table public.profiles
      add constraint profiles_preferred_language_check
      check (
        preferred_language is null
        or preferred_language in ('fr', 'en', 'es')
      );
  end if;
end;
$$;

comment on column public.profiles.preferred_language
  is 'Optional user UI language override. Null means automatic device language.';

drop function if exists public.get_org_users();

create or replace function public.get_org_users()
returns table (
  id uuid,
  name text,
  role text,
  role_label text,
  email text,
  organization_id uuid,
  company_id text,
  permissions_override jsonb,
  preferred_language text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_id uuid;
  v_caller_role text;
  v_org_id uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then return; end if;

  select p.role, p.organization_id
  into v_caller_role, v_org_id
  from public.profiles p
  where p.id = v_caller_id;

  if v_caller_role = 'super_admin' then
    return query
      select p.id, p.name, p.role, p.role_label, p.email,
             p.organization_id, p.company_id, p.permissions_override,
             p.preferred_language
      from public.profiles p;
  elsif v_org_id is not null then
    return query
      select p.id, p.name, p.role, p.role_label, p.email,
             p.organization_id, p.company_id, p.permissions_override,
             p.preferred_language
      from public.profiles p
      where p.organization_id = v_org_id;
  end if;
end;
$$;

grant execute on function public.get_org_users() to authenticated;

notify pgrst, 'reload schema';
