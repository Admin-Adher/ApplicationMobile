\set ON_ERROR_STOP on

create schema if not exists test;

create or replace function test.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_message;
  end if;
end;
$$;

create or replace function test.expect_error(p_sql text, p_message text)
returns void
language plpgsql
security invoker
as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'EXPECTED ERROR: %', p_message;
end;
$$;

grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- User A × objects A/B.
set role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);

select test.assert_true(
  (select array_agg(id order by id) from public.reserves) = array['reserve-a'],
  'user A must see only tenant A reserves'
);
select test.assert_true(
  public.auth_user_org() = 'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'tenant must be derived from the active membership'
);
select test.assert_true(
  (select count(*) from public.organization_memberships where organization_id = 'bbbbbbbb-0000-4000-8000-000000000002') = 0,
  'user A must not enumerate tenant B memberships'
);
select test.assert_true(
  not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'organization_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.profiles', 'permissions_override', 'UPDATE'),
  'authority columns must not be client-writable'
);
select test.expect_error(
  $$update public.profiles set role = 'super_admin' where id = '10000000-0000-4000-8000-000000000001'$$,
  'self role escalation must fail'
);
select test.assert_true(
  not has_table_privilege('authenticated', 'public.invitations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invitations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.invitations', 'DELETE'),
  'invitation grants must be server-managed'
);
select test.expect_error(
  $$insert into public.organizations(name, slug) values ('Unauthorized', 'unauthorized')$$,
  'organization creation must be server-managed'
);
select test.expect_error(
  $$insert into public.subscriptions(organization_id, status) values ('aaaaaaaa-0000-4000-8000-000000000001', 'active')$$,
  'subscription creation must be server-managed'
);

-- Supplied tenant B is ignored: the actor tenant is written instead.
insert into public.reserves(id, organization_id, chantier_id)
values (
  'payload-tenant-is-ignored',
  'bbbbbbbb-0000-4000-8000-000000000002',
  'chantier-a'
);
select test.assert_true(
  (select organization_id from public.reserves where id = 'payload-tenant-is-ignored')
    = 'aaaaaaaa-0000-4000-8000-000000000001'::uuid,
  'organization_id from a client payload must never be trusted'
);
select test.expect_error(
  $$insert into public.reserves(id, organization_id, chantier_id) values ('cross-parent', 'aaaaaaaa-0000-4000-8000-000000000001', 'chantier-b')$$,
  'composite foreign keys must reject a tenant B parent under tenant A'
);
reset role;

-- Anonymous access stays fail-closed even if a legacy PUBLIC policy and table
-- grant are reintroduced by an older migration.
set role anon;
select set_config('request.jwt.claim.role', 'anon', false);
select set_config('request.jwt.claim.sub', '', false);
select test.assert_true(
  (select count(*) from public.reserves) = 0,
  'anonymous users must not read tenant objects'
);
select test.expect_error(
  $$insert into public.reserves(id, organization_id, chantier_id) values ('anon-write', 'aaaaaaaa-0000-4000-8000-000000000001', 'chantier-a')$$,
  'anonymous users must not write tenant objects'
);
reset role;

-- User B × objects A/B.
set role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', false);
select test.assert_true(
  (select array_agg(id order by id) from public.reserves) = array['reserve-b'],
  'user B must see only tenant B reserves'
);
reset role;

-- Authenticated user without an active membership is fail-closed.
set role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000003', false);
select test.assert_true(
  (select count(*) from public.reserves) = 0,
  'a user without membership must see no tenant object'
);
select test.expect_error(
  $$insert into public.reserves(id, organization_id, chantier_id) values ('no-membership-write', 'aaaaaaaa-0000-4000-8000-000000000001', 'chantier-a')$$,
  'a user without membership must not write tenant data'
);
reset role;

-- Registry metadata and privileged resolvers are not exposed to clients.
select test.assert_true(
  not has_table_privilege('authenticated', 'public.tenant_media_objects', 'SELECT')
  and not has_table_privilege('authenticated', 'public.tenant_media_links', 'SELECT'),
  'media object keys must be server-only'
);
select test.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.server_get_media_candidates(uuid,text[])',
    'EXECUTE'
  ),
  'media candidate lookup must be service-only'
);
select test.assert_true(
  not has_function_privilege(
    'authenticated',
    'public.get_authorization_context_for_user(uuid)',
    'EXECUTE'
  ),
  'server authorization context must not be callable by clients'
);

-- The registry starts in dual-read mode; the cutover is explicit and atomic.
select test.assert_true(
  public.private_media_storage_enforced() is false
  and (select bool_and(public) from storage.buckets where id in ('photos', 'documents')),
  'registry deployment must not break older clients before the rollout gate'
);

set role service_role;
select public.server_finalize_private_media_storage('1.2.4', true);
reset role;

select test.assert_true(
  public.private_media_storage_enforced() is true
  and (select bool_and(not public) from storage.buckets where id in ('photos', 'documents')),
  'privacy cutover must close both media buckets'
);

-- After cutover only an exact server-minted, same-tenant pending key can be
-- uploaded directly by its owner.
insert into public.tenant_media_objects(
  id, organization_id, owner_user_id, provider, bucket, object_key,
  original_filename, content_type, expected_size, status
) values
  (
    '40000000-0000-4000-8000-000000000004',
    'aaaaaaaa-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'supabase', 'photos',
    'aaaaaaaa-0000-4000-8000-000000000001/photo/40000000-0000-4000-8000-000000000004/ok.jpg',
    'ok.jpg', 'image/jpeg', 10, 'pending'
  ),
  (
    '50000000-0000-4000-8000-000000000005',
    'aaaaaaaa-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'supabase', 'photos',
    'aaaaaaaa-0000-4000-8000-000000000001/photo/50000000-0000-4000-8000-000000000005/a-only.jpg',
    'a-only.jpg', 'image/jpeg', 10, 'pending'
  );

set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
select test.expect_error(
  $$update public.reserves set photo_uri = 'btmedia://40000000-0000-4000-8000-000000000004' where id = 'reserve-a'$$,
  'a pending upload must not be attachable to a business resource'
);
insert into storage.objects(bucket_id, name, owner_id) values (
  'photos',
  'aaaaaaaa-0000-4000-8000-000000000001/photo/40000000-0000-4000-8000-000000000004/ok.jpg',
  '10000000-0000-4000-8000-000000000001'
);
select test.expect_error(
  $$insert into storage.objects(bucket_id, name) values ('photos', 'unregistered/public-bypass.jpg')$$,
  'an unregistered media key must be denied after cutover'
);
reset role;

set role anon;
select set_config('request.jwt.claim.role', 'anon', false);
select set_config('request.jwt.claim.sub', '', false);
select test.expect_error(
  $$insert into storage.objects(bucket_id, name) values ('photos', 'anonymous-bypass.jpg')$$,
  'anonymous media access must be denied after cutover'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', false);
select test.expect_error(
  $$insert into storage.objects(bucket_id, name) values ('photos', 'aaaaaaaa-0000-4000-8000-000000000001/photo/50000000-0000-4000-8000-000000000005/a-only.jpg')$$,
  'tenant B must not upload into a tenant A reservation'
);
reset role;

select 'tenant isolation matrix: PASS' as result;
