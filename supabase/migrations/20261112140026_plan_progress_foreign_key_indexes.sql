-- Cover the tenant/plan and actor foreign keys without changing RPC access.
create index site_plan_progress_tenant_plan_idx
  on public.site_plan_progress(organization_id,plan_id);
create index site_plan_progress_operations_user_idx
  on public.site_plan_progress_operations(user_id);
