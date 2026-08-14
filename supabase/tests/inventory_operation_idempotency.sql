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

grant usage on schema test to anon, authenticated, service_role;
grant execute on function test.assert_true(boolean, text)
  to anon, authenticated, service_role;

-- Structural and ACL contracts.
select test.assert_true(
  not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.inventory_movements'::pg_catalog.regclass
      and c.conname = 'inventory_movements_operation_id_key'
  ),
  'the legacy global operation_id constraint must be removed'
);

select test.assert_true(
  exists (
    select 1
    from pg_catalog.pg_indexes i
    where i.schemaname = 'public'
      and i.tablename = 'inventory_movements'
      and i.indexname = 'inventory_movements_org_operation_uidx'
      and i.indexdef like '%UNIQUE INDEX%'
      and i.indexdef like '%(organization_id, operation_id)%'
  ),
  'movement operation uniqueness must be tenant scoped'
);

select test.assert_true(
  not pg_catalog.has_table_privilege(
    'authenticated', 'private.inventory_operation_registry', 'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon', 'private.inventory_operation_registry', 'SELECT'
  ),
  'the private outcome registry must not be client readable'
);

select test.assert_true(
  exists (
    select 1
    from pg_catalog.pg_indexes i
    where i.schemaname = 'private'
      and i.tablename = 'inventory_operation_registry'
      and i.indexname = 'inventory_operation_registry_created_by_idx'
  ),
  'the registry created_by foreign key must have a covering index'
);

select test.assert_true(
  exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'private'
      and p.tablename = 'inventory_operation_registry'
      and p.policyname = 'inventory_operation_registry_deny_clients'
      and p.permissive = 'RESTRICTIVE'
  ),
  'the private registry must keep an explicit restrictive client deny policy'
);

select test.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.record_inventory_movement(text,jsonb,jsonb,boolean)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.record_inventory_movement(text,jsonb,jsonb,boolean)',
    'EXECUTE'
  ),
  'only authenticated callers may execute the inventory movement RPC; anon also detects PUBLIC grants'
);

select test.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.update_inventory_product(text,jsonb)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'public.update_inventory_product(text,jsonb)',
    'EXECUTE'
  ),
  'only authenticated callers may execute the inventory product update RPC; anon also detects PUBLIC grants'
);

-- The logical request hash ignores transient photo storage URLs, while still
-- binding business fields. JSONB also canonicalizes object key order.
select test.assert_true(
  private.inventory_operation_request_hash(
    '{"id":"mov-hash","chantier_id":"chantier-a","product_id":"prod-hash","movement_type":"IN","quantity":1,"comment":" same "}'::jsonb,
    '{"id":"prod-hash","reference":" REF-01 ","designation":"Hash product","photo_url":"https://objects.test/first.jpg","min_stock":0}'::jsonb,
    false
  ) = private.inventory_operation_request_hash(
    '{"comment":"same","quantity":1.0,"movement_type":"in","product_id":"prod-hash","chantier_id":"chantier-a","id":"mov-hash"}'::jsonb,
    '{"min_stock":0.0,"photo_url":"https://objects.test/retry.jpg","designation":"Hash product","reference":"REF01","id":"prod-hash"}'::jsonb,
    false
  ),
  'equivalent business commands must hash identically despite key order or photo URL'
);

select test.assert_true(
  private.inventory_operation_request_hash(
    '{"id":"mov-hash","chantier_id":"chantier-a","product_id":"prod-hash","movement_type":"in","quantity":1}'::jsonb,
    '{"id":"prod-hash","reference":"REF-01","designation":"Hash product","min_stock":0}'::jsonb,
    false
  ) <> private.inventory_operation_request_hash(
    '{"id":"mov-hash","chantier_id":"chantier-a","product_id":"prod-hash","movement_type":"in","quantity":2}'::jsonb,
    '{"id":"prod-hash","reference":"REF-01","designation":"Hash product","min_stock":0}'::jsonb,
    false
  ),
  'a changed business quantity must change the request hash'
);

-- Tenant A: first success and exact replay. The replay deliberately changes
-- only JSON key order and photo_url.
set role authenticated;
select pg_catalog.set_config('request.jwt.claim.role', 'authenticated', false);
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-entry',
      '{"id":"mov-a-entry","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":10,"reference":"MAT-001","barcode":"BAR-A","supplier":"Supplier A","location":"Rack A","building_id":"building-a","building_name":"Building A","zone_id":"zone-a","zone_name":"Zone A","company_id":"company-a","company_name":"Company A","person_name":"Receiver A","comment":"Initial delivery","created_at":"2026-08-14T08:00:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","barcode":"BAR-A","photo_url":"https://objects.test/first.jpg","min_stock":2,"location":"Rack A","supplier":"Supplier A"}'::jsonb,
      false
    )
  ) = 'ok',
  'the initial tenant A entry must succeed'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-entry',
      '{"created_at":"2026-08-14T08:00:00Z","comment":"Initial delivery","person_name":"Receiver A","company_name":"Company A","company_id":"company-a","zone_name":"Zone A","zone_id":"zone-a","building_name":"Building A","building_id":"building-a","location":"Rack A","supplier":"Supplier A","barcode":"BAR-A","reference":"MAT001","quantity":10.0,"movement_type":"IN","product_id":"prod-a","chantier_id":"chantier-a","id":"mov-a-entry"}'::jsonb,
      '{"supplier":"Supplier A","location":"Rack A","min_stock":2.0,"photo_url":"https://objects.test/retry.jpg","barcode":"BAR-A","designation":"Material A","reference":"MAT001","id":"prod-a"}'::jsonb,
      false
    )
  ) = 'ok',
  'an equivalent replay must return the stored success'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-entry',
      '{"id":"mov-a-entry","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":9,"reference":"MAT-001","barcode":"BAR-A","supplier":"Supplier A","location":"Rack A","building_id":"building-a","building_name":"Building A","zone_id":"zone-a","zone_name":"Zone A","company_id":"company-a","company_name":"Company A","person_name":"Receiver A","comment":"Initial delivery","created_at":"2026-08-14T08:00:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","barcode":"BAR-A","min_stock":2,"location":"Rack A","supplier":"Supplier A"}'::jsonb,
      false
    )
  ) = 'duplicate_operation_mismatch',
  'reusing an operation ID for a changed quantity must fail closed'
);

reset role;

select test.assert_true(
  (select current_stock from public.inventory_products where id = 'prod-a') = 10
  and (select count(*) from public.inventory_movements where operation_id = 'op-a-entry') = 1,
  'success replay and mismatch must not double-apply stock'
);

select test.assert_true(
  (
    select replay_count = 1 and pg_catalog.length(request_hash) = 64
    from private.inventory_operation_registry
    where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and operation_id = 'op-a-entry'
  ),
  'the stored success must have one exact replay and a SHA-256 hash'
);

-- Tenant A: deterministic insufficient-stock rejection, followed by a stock
-- change. Replaying the rejected command must still return its stored outcome.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-insufficient',
      '{"id":"mov-a-insufficient","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"out","quantity":11,"reference":"MAT-001","barcode":"BAR-A","comment":"Too much","created_at":"2026-08-14T08:10:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","barcode":"BAR-A","min_stock":2,"location":"Rack A","supplier":"Supplier A"}'::jsonb,
      false
    )
  ) = 'insufficient_stock',
  'an overdrawn exit must be rejected deterministically'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-replenish',
      '{"id":"mov-a-replenish","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":5,"reference":"MAT-001","barcode":"BAR-A","comment":"Replenish","created_at":"2026-08-14T08:20:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","barcode":"BAR-A","min_stock":2,"location":"Rack A","supplier":"Supplier A"}'::jsonb,
      false
    )
  ) = 'ok',
  'a distinct replenishment operation must succeed'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-insufficient',
      '{"id":"mov-a-insufficient","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"out","quantity":11,"reference":"MAT001","barcode":"BAR-A","comment":"Too much","created_at":"2026-08-14T08:10:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT001","designation":"Material A","barcode":"BAR-A","photo_url":"https://objects.test/another-retry.jpg","min_stock":2,"location":"Rack A","supplier":"Supplier A"}'::jsonb,
      false
    )
  ) = 'insufficient_stock',
  'a previously rejected command must return its stored rejection after stock changes'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-invalid-type',
      '{"id":"mov-a-invalid","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"transfer","quantity":1,"created_at":"2026-08-14T08:30:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'invalid_payload',
  'an invalid movement type must be a deterministic stored rejection'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-missing-type',
      '{"id":"mov-a-missing-type","chantier_id":"chantier-a","product_id":"prod-a","quantity":1,"created_at":"2026-08-14T08:31:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'invalid_payload',
  'a missing movement type must be a durable invalid payload instead of a SQL error'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-nan-quantity',
      '{"id":"mov-a-nan-quantity","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":"NaN","created_at":"2026-08-14T08:32:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'invalid_payload',
  'NaN movement quantity must be rejected before it can contaminate stock'
);

select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'op-a-nan-min-stock',
      '{"id":"mov-a-nan-min-stock","chantier_id":"chantier-a","product_id":"prod-a-nan","movement_type":"in","quantity":1,"reference":"NAN-001","created_at":"2026-08-14T08:33:00Z"}'::jsonb,
      '{"id":"prod-a-nan","reference":"NAN-001","designation":"Invalid NaN product","min_stock":"NaN"}'::jsonb,
      false
    )
  ) = 'invalid_payload',
  'NaN minimum stock must be rejected before product creation'
);

select test.assert_true(
  (
    select status
    from public.update_inventory_product(
      'prod-a',
      '{"min_stock":"NaN"}'::jsonb
    )
  ) = 'invalid_payload',
  'NaN minimum stock must be rejected by product updates'
);

reset role;

select test.assert_true(
  (select current_stock from public.inventory_products where id = 'prod-a') = 15
  and not exists (
    select 1
    from public.inventory_movements
    where operation_id in (
      'op-a-insufficient',
      'op-a-invalid-type',
      'op-a-missing-type',
      'op-a-nan-quantity',
      'op-a-nan-min-stock'
    )
  ),
  'rejections must not create movements or alter stock'
);

select test.assert_true(
  not exists (select 1 from public.inventory_products where id = 'prod-a-nan')
  and (select min_stock from public.inventory_products where id = 'prod-a') = 2,
  'non-finite minimum stock must never reach product rows'
);

select test.assert_true(
  (
    select status = 'insufficient_stock'
      and stock_before = 10
      and stock_after = -1
      and replay_count = 1
    from private.inventory_operation_registry
    where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and operation_id = 'op-a-insufficient'
  ),
  'the original insufficient-stock result must remain durable'
);

-- The same operation ID is valid once per tenant.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'shared-operation',
      '{"id":"mov-shared-a","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":1,"reference":"MAT-001","created_at":"2026-08-14T09:00:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'ok',
  'tenant A shared operation must succeed'
);

select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  false
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'shared-operation',
      '{"id":"mov-shared-b","chantier_id":"chantier-b","product_id":"prod-b","movement_type":"in","quantity":4,"reference":"MAT-B","created_at":"2026-08-14T09:01:00Z"}'::jsonb,
      '{"id":"prod-b","reference":"MAT-B","designation":"Material B","min_stock":0}'::jsonb,
      false
    )
  ) = 'ok',
  'tenant B may independently use the same operation ID'
);

reset role;

select test.assert_true(
  (select count(*) from public.inventory_movements where operation_id = 'shared-operation') = 2,
  'tenant-scoped uniqueness must retain both organizations movements'
);

-- Historical successes have no registry row. An identical replay backfills a
-- success; a changed replay is rejected without changing stock.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'historical-match',
      '{"id":"mov-historical-match","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":2,"reference":"MAT-001","supplier":null,"building_id":null,"building_name":null,"zone_id":null,"zone_name":null,"company_id":null,"company_name":null,"person_name":null,"comment":"Historical exact","created_at":"2026-08-14T09:10:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'ok',
  'historical-match fixture creation must succeed'
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'historical-mismatch',
      '{"id":"mov-historical-mismatch","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":2,"reference":"MAT-001","supplier":null,"building_id":null,"building_name":null,"zone_id":null,"zone_name":null,"company_id":null,"company_name":null,"person_name":null,"comment":"Historical changed","created_at":"2026-08-14T09:11:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'ok',
  'historical-mismatch fixture creation must succeed'
);

reset role;
delete from private.inventory_operation_registry
where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  and operation_id in ('historical-match', 'historical-mismatch');

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'historical-match',
      '{"id":"mov-historical-match","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":2,"reference":"MAT-001","supplier":null,"building_id":null,"building_name":null,"zone_id":null,"zone_name":null,"company_id":null,"company_name":null,"person_name":null,"comment":"Historical exact","created_at":"2026-08-14T09:10:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","photo_url":"https://objects.test/new-historical-photo.jpg","min_stock":2}'::jsonb,
      false
    )
  ) = 'ok',
  'an identical historical success must be returned and backfilled'
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'historical-mismatch',
      '{"id":"mov-historical-mismatch","chantier_id":"chantier-a","product_id":"prod-a","movement_type":"in","quantity":3,"reference":"MAT-001","supplier":null,"building_id":null,"building_name":null,"zone_id":null,"zone_name":null,"company_id":null,"company_name":null,"person_name":null,"comment":"Historical changed","created_at":"2026-08-14T09:11:00Z"}'::jsonb,
      '{"id":"prod-a","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'duplicate_operation_mismatch',
  'a changed historical replay must fail closed'
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'historical-mismatch',
      '{"id":"mov-historical-mismatch","chantier_id":"chantier-a","product_id":"prod-b","movement_type":"in","quantity":2,"reference":"MAT-001","supplier":null,"building_id":null,"building_name":null,"zone_id":null,"zone_name":null,"company_id":null,"company_name":null,"person_name":null,"comment":"Historical changed","created_at":"2026-08-14T09:11:00Z"}'::jsonb,
      '{"id":"prod-b","reference":"MAT-001","designation":"Material A","min_stock":2}'::jsonb,
      false
    )
  ) = 'duplicate_operation_mismatch',
  'a conflicting historical product ID must fail even when the reference matches'
);

reset role;
select test.assert_true(
  (select count(*) from public.inventory_movements where operation_id = 'historical-match') = 1
  and (select count(*) from public.inventory_movements where operation_id = 'historical-mismatch') = 1,
  'historical replay paths must not create another movement'
);
select test.assert_true(
  exists (
    select 1
    from private.inventory_operation_registry
    where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and operation_id = 'historical-match'
      and status = 'ok'
  )
  and not exists (
    select 1
    from private.inventory_operation_registry
    where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and operation_id = 'historical-mismatch'
  ),
  'only the compatible historical success must be backfilled'
);

-- A non-member cannot poison another tenant's operation key. Adding the actor
-- to private.platform_admins (without changing profiles.role) then proves both
-- the new authority source and the transaction-local trusted tenant context.
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'platform-cross-tenant',
      '{"id":"mov-platform-cross","chantier_id":"chantier-b","product_id":"prod-b","movement_type":"in","quantity":1,"reference":"MAT-B","created_at":"2026-08-14T09:20:00Z"}'::jsonb,
      '{"id":"prod-b","reference":"MAT-B","designation":"Material B","min_stock":0}'::jsonb,
      false
    )
  ) = 'forbidden',
  'a tenant A member must initially be forbidden from tenant B'
);

select test.assert_true(
  (
    select status
    from public.update_inventory_product(
      'prod-b',
      '{"designation":"Unauthorized change"}'::jsonb
    )
  ) = 'forbidden',
  'a tenant A member must not update a tenant B inventory product'
);

reset role;
select test.assert_true(
  not exists (
    select 1
    from private.inventory_operation_registry
    where organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
      and operation_id = 'platform-cross-tenant'
  ),
  'an unauthorized caller must not reserve another tenant operation key'
);
select test.assert_true(
  (select designation from public.inventory_products where id = 'prod-b') = 'Material B',
  'a forbidden cross-tenant product update must not mutate tenant B'
);

insert into private.platform_admins(user_id, status, created_by)
values (
  '10000000-0000-4000-8000-000000000001',
  'active',
  '10000000-0000-4000-8000-000000000001'
)
on conflict (user_id) do update set status = 'active', updated_at = now();

select test.assert_true(
  (select role from public.profiles where id = '10000000-0000-4000-8000-000000000001') = 'admin',
  'the platform authority test must not rely on profiles.role'
);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  false
);
select test.assert_true(
  (
    select status
    from public.record_inventory_movement(
      'platform-cross-tenant',
      '{"id":"mov-platform-cross","chantier_id":"chantier-b","product_id":"prod-b","movement_type":"in","quantity":1,"reference":"MAT-B","created_at":"2026-08-14T09:20:00Z"}'::jsonb,
      '{"id":"prod-b","reference":"MAT-B","designation":"Material B","photo_url":"https://objects.test/platform.jpg","min_stock":0}'::jsonb,
      false
    )
  ) = 'ok',
  'private platform authority must permit a cross-tenant inventory command'
);
select test.assert_true(
  (
    select status
    from public.update_inventory_product(
      'prod-b',
      '{"designation":"Material B platform","min_stock":1}'::jsonb
    )
  ) = 'ok',
  'private platform authority must permit a cross-tenant product update'
);

reset role;
select test.assert_true(
  exists (
    select 1
    from public.inventory_movements
    where organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
      and operation_id = 'platform-cross-tenant'
  ),
  'trusted tenant context must preserve tenant B on the platform-admin write'
);
select test.assert_true(
  (
    select designation = 'Material B platform' and min_stock = 1
    from public.inventory_products
    where id = 'prod-b'
      and organization_id = 'bbbbbbbb-0000-4000-8000-000000000002'
  ),
  'the platform-admin product update must remain scoped to tenant B'
);

-- Product-card management is intentionally broader than negative stock
-- adjustment: an active magasinier may edit metadata through this adapter.
update public.organization_memberships
set role = 'magasinier',
    permissions_override = '{}'::jsonb,
    updated_at = now()
where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  and user_id = '40000000-0000-4000-8000-000000000004';

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claim.sub',
  '40000000-0000-4000-8000-000000000004',
  false
);
select test.assert_true(
  (
    select status
    from public.update_inventory_product(
      'prod-a',
      '{"location":"Rack magasinier"}'::jsonb
    )
  ) = 'ok',
  'an active magasinier must be allowed to manage inventory product metadata'
);

reset role;
select test.assert_true(
  (select location from public.inventory_products where id = 'prod-a') = 'Rack magasinier',
  'the magasinier metadata update must be applied'
);

select 'inventory operation idempotency matrix passed' as result;
