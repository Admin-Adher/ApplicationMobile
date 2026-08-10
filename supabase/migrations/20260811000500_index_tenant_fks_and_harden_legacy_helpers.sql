-- Follow-up hardening for the tenant authority rollout.
--
-- Composite foreign keys prevent cross-tenant references. Matching indexes
-- keep parent updates/deletes and tenant-scoped joins predictable as customer
-- data grows. The legacy helper grants below also remove RPC exposure that is
-- unnecessary for anonymous callers; trigger functions remain usable by their
-- owning triggers without client EXECUTE privileges.

create index if not exists channel_members_org_user_idx
  on public.channel_members(organization_id, user_id);
create index if not exists channel_members_added_by_idx
  on public.channel_members(added_by);
create index if not exists checklists_org_chantier_idx
  on public.checklists(organization_id, chantier_id);
create index if not exists documents_org_chantier_idx
  on public.documents(organization_id, chantier_id);
create index if not exists incidents_org_chantier_idx
  on public.incidents(organization_id, chantier_id);
create index if not exists inventory_movements_org_company_idx
  on public.inventory_movements(organization_id, company_id);
create index if not exists inventory_movements_org_product_idx
  on public.inventory_movements(organization_id, product_id);
create index if not exists journal_entries_org_chantier_idx
  on public.journal_entries(organization_id, chantier_id);
create index if not exists lots_org_chantier_idx
  on public.lots(organization_id, chantier_id);
create index if not exists lots_org_company_idx
  on public.lots(organization_id, company_id);
create index if not exists notification_preferences_admin_updater_idx
  on public.notification_preferences(email_admin_updated_by);
create index if not exists notification_preferences_org_user_idx
  on public.notification_preferences(organization_id, user_id);
create index if not exists oprs_org_chantier_idx
  on public.oprs(organization_id, chantier_id);
create index if not exists organization_memberships_org_company_idx
  on public.organization_memberships(organization_id, company_id);
create index if not exists organization_memberships_created_by_idx
  on public.organization_memberships(created_by);
create index if not exists photos_org_reserve_idx
  on public.photos(organization_id, reserve_id);
create index if not exists push_tokens_org_user_idx
  on public.push_tokens(organization_id, user_id);
create index if not exists reserve_status_events_org_reserve_idx
  on public.reserve_status_events(organization_id, reserve_id);
create index if not exists reserves_org_lot_idx
  on public.reserves(organization_id, lot_id);
create index if not exists reserves_org_plan_idx
  on public.reserves(organization_id, plan_id);
create index if not exists reserves_org_task_idx
  on public.reserves(organization_id, linked_task_id);
create index if not exists reserves_org_visite_idx
  on public.reserves(organization_id, visite_id);
create index if not exists site_plans_org_chantier_idx
  on public.site_plans(organization_id, chantier_id);
create index if not exists site_plans_org_parent_idx
  on public.site_plans(organization_id, parent_plan_id);
create index if not exists site_plans_org_replacement_idx
  on public.site_plans(organization_id, replaced_by_plan_id);
create index if not exists tasks_org_reserve_idx
  on public.tasks(organization_id, reserve_id);
create index if not exists tenant_media_links_org_asset_idx
  on public.tenant_media_links(organization_id, asset_id);
create index if not exists tenant_media_links_created_by_idx
  on public.tenant_media_links(created_by);
create index if not exists time_entries_org_company_idx
  on public.time_entries(organization_id, company_id);
create index if not exists time_entries_org_task_idx
  on public.time_entries(organization_id, task_id);
create index if not exists visites_org_chantier_idx
  on public.visites(organization_id, chantier_id);
create index if not exists visites_org_default_plan_idx
  on public.visites(organization_id, default_plan_id);
create index if not exists platform_admins_created_by_idx
  on private.platform_admins(created_by);
create index if not exists runtime_security_flags_updated_by_idx
  on private.runtime_security_flags(updated_by);

do $$
begin
  if to_regprocedure('public.generate_invitation_token()') is not null then
    execute 'alter function public.generate_invitation_token() set search_path = pg_catalog, extensions';
    execute 'revoke all on function public.generate_invitation_token() from public, anon, authenticated';
  end if;

  if to_regprocedure('public.demo_profiles_seeded()') is not null then
    execute 'alter function public.demo_profiles_seeded() set search_path = ''''';
  end if;

  if to_regprocedure('public.auth_user_email()') is not null then
    execute 'revoke all on function public.auth_user_email() from public, anon';
    execute 'grant execute on function public.auth_user_email() to authenticated';
  end if;

  if to_regprocedure('public.auth_user_name()') is not null then
    execute 'revoke all on function public.auth_user_name() from public, anon';
    execute 'grant execute on function public.auth_user_name() to authenticated';
  end if;

  if to_regprocedure('public.chantier_visible_to_current_user(uuid,jsonb)') is not null then
    execute 'revoke all on function public.chantier_visible_to_current_user(uuid,jsonb) from public, anon';
    execute 'grant execute on function public.chantier_visible_to_current_user(uuid,jsonb) to authenticated';
  end if;

  if to_regprocedure('public.reserve_matches_current_user_company(text,jsonb)') is not null then
    execute 'revoke all on function public.reserve_matches_current_user_company(text,jsonb) from public, anon';
    execute 'grant execute on function public.reserve_matches_current_user_company(text,jsonb) to authenticated';
  end if;

  if to_regprocedure('public.set_photo_organization_id()') is not null then
    execute 'revoke all on function public.set_photo_organization_id() from public, anon, authenticated';
  end if;

  if to_regprocedure('public.set_reserve_organization_id()') is not null then
    execute 'revoke all on function public.set_reserve_organization_id() from public, anon, authenticated';
  end if;
end
$$;

notify pgrst, 'reload schema';
