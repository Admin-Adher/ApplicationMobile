alter table public.tasks add column if not exists start_date text;

drop policy if exists time_entries_update on public.time_entries;
create policy time_entries_update on public.time_entries
  for update to authenticated
  using (
    (select public.auth_user_role()) = 'super_admin'
    or (organization_id = (select public.auth_user_org()) and (select public.auth_user_has_permission('canUpdateAttendance')))
  )
  with check (
    (select public.auth_user_role()) = 'super_admin'
    or (organization_id = (select public.auth_user_org()) and (select public.auth_user_has_permission('canUpdateAttendance')))
  );

create index if not exists documents_scope_name_version_idx
  on public.documents (organization_id, chantier_id, name, version desc);

create or replace function private.assign_document_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    pg_catalog.jsonb_build_array(new.organization_id, new.chantier_id, new.name)::text, 0
  ));

  select coalesce(max(document.version), 0) + 1
    into new.version
    from public.documents document
    where document.organization_id is not distinct from new.organization_id
      and document.chantier_id is not distinct from new.chantier_id
      and document.name is not distinct from new.name;
  return new;
end;
$$;

revoke all on function private.assign_document_version() from public, anon, authenticated;

drop trigger if exists trg_assign_document_version on public.documents;
create trigger trg_assign_document_version before insert on public.documents
  for each row execute function private.assign_document_version();

create or replace function public.delete_web_visit(p_visit_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.auth_user_has_permission('canDelete'), false) then
    raise exception 'Suppression de la visite non autorisée' using errcode = '42501';
  end if;

  perform 1 from public.visites where id = p_visit_id for update;
  if not found then return; end if;

  update public.reserves set visite_id = null where visite_id = p_visit_id;
  delete from public.visites where id = p_visit_id;
  if not found then
    raise exception 'Suppression de la visite refusée' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.delete_web_visit(text) from public, anon, authenticated;
grant execute on function public.delete_web_visit(text) to authenticated;

notify pgrst, 'reload schema';
