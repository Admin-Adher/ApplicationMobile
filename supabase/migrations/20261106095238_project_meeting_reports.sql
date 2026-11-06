create table public.project_meeting_reports (
  organization_id uuid not null,
  chantier_id text not null,
  id text not null check (char_length(id) between 1 and 100),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  report jsonb not null check (
    jsonb_typeof(report) = 'object'
    and jsonb_typeof(report->'id') is not distinct from 'string'
    and report->>'id' = id
    and jsonb_typeof(report->'subject') is not distinct from 'string'
    and length(trim(report->>'subject')) > 0
    and jsonb_typeof(report->'actions') is not distinct from 'array'
    and jsonb_typeof(report->'decisions') is not distinct from 'array'
    and report ?& array['date', 'location', 'participants', 'agenda', 'notes', 'nextMeeting', 'redactedBy', 'createdAt']
    and not jsonb_path_exists(report, '$.keyvalue() ? (@.key != "actions" && @.key != "decisions" && @.value.type() != "string")')
    and not jsonb_path_exists(report, '$.decisions[*] ? (@.type() != "string")')
    and not jsonb_path_exists(report, '$.actions[*] ? (@.type() != "object")')
    and not jsonb_path_exists(report, '$.actions[*].keyvalue() ? (@.value.type() != "string")')
  ),
  primary key (organization_id, chantier_id, id),
  foreign key (organization_id, chantier_id) references public.chantiers(organization_id, id)
);

create index project_meeting_reports_created_by_idx on public.project_meeting_reports(created_by);

alter table public.project_meeting_reports enable row level security;
revoke all on public.project_meeting_reports from public, anon, authenticated;
grant select, delete on public.project_meeting_reports to authenticated;
grant insert (organization_id, chantier_id, id, report) on public.project_meeting_reports to authenticated;
grant update (report, version) on public.project_meeting_reports to authenticated;

create policy meeting_project_scope on public.project_meeting_reports
  as restrictive for all to authenticated
  using (
    organization_id = (select public.auth_user_org())
    and (select public.auth_user_role()) in ('super_admin', 'admin', 'conducteur', 'chef_equipe', 'observateur')
    and exists (
      select 1 from public.chantiers as chantier
      where chantier.id = project_meeting_reports.chantier_id
        and chantier.organization_id = project_meeting_reports.organization_id
        and chantier.deleted_at is null
    )
  );

create policy meeting_read on public.project_meeting_reports for select to authenticated using (true);
create policy meeting_create on public.project_meeting_reports for insert to authenticated
  with check (created_by = (select auth.uid()) and (select public.auth_user_has_permission('canCreate')));
create policy meeting_edit on public.project_meeting_reports for update to authenticated
  using ((select public.auth_user_has_permission('canEdit')))
  with check ((select public.auth_user_has_permission('canEdit')));
create policy meeting_delete on public.project_meeting_reports for delete to authenticated
  using ((select public.auth_user_has_permission('canDelete')));
