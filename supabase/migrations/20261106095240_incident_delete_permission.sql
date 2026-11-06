-- Keep the existing tenant and role policies. Also enforce the permission
-- checked by both clients before removing a safety incident.
create policy incident_delete_requires_permission on public.incidents
  as restrictive for delete to authenticated
  using ((select public.auth_user_has_permission('canDelete')));
