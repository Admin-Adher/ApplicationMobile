import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relative: string) {
  return readFileSync(
    fileURLToPath(new URL(`../${relative}`, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n').toLowerCase();
}

const migrationPath = 'supabase/migrations/20260814102326_harden_inventory_operation_idempotency.sql';
const migration = source(migrationPath);
const sqlMatrix = source('supabase/tests/inventory_operation_idempotency.sql');
const workflow = source('.github/workflows/security-gates.yml');
const networkContext = source('context/NetworkContext.tsx');
const inventoryHook = source('hooks/queries/useInventory.ts');

function between(input: string, start: string, end: string) {
  const startIndex = input.indexOf(start);
  const endIndex = input.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return input.slice(startIndex, endIndex);
}

describe('inventory movement durable idempotency contract', () => {
  it('uses a tenant-scoped private outcome registry and movement uniqueness', () => {
    expect(migration).toContain('create table if not exists private.inventory_operation_registry');
    expect(migration).toContain('primary key (organization_id, operation_id)');
    expect(migration).toContain('drop constraint if exists inventory_movements_operation_id_key');
    expect(migration).toContain('create unique index if not exists inventory_movements_org_operation_uidx');
    expect(migration).toContain('on public.inventory_movements (organization_id, operation_id)');
    expect(migration).toContain('inventory_operation_registry_created_by_idx');
    expect(migration).toContain('alter table private.inventory_operation_registry enable row level security');
    expect(migration).toContain('create policy inventory_operation_registry_deny_clients');
    expect(migration).toContain('as restrictive');
    expect(migration).toContain('using (false)');
    expect(migration).toContain(
      'revoke all on table private.inventory_operation_registry from public, anon, authenticated',
    );
  });

  it('hashes canonical business fields server-side but excludes transient photo URLs', () => {
    const hashFunction = between(
      migration,
      'create or replace function private.inventory_operation_request_hash',
      'create or replace function private.inventory_store_operation_result',
    );

    expect(hashFunction).toContain('extensions.digest');
    expect(hashFunction).toContain("'sha256'");
    expect(hashFunction).toContain('pg_catalog.jsonb_build_object');
    expect(hashFunction).toContain("'movement_type'");
    expect(hashFunction).toContain("'quantity'");
    expect(hashFunction).toContain("'created_at'");
    expect(hashFunction).toContain("'designation'");
    expect(hashFunction).toContain("'min_stock'");
    expect(hashFunction).toContain("'allow_negative'");
    expect(hashFunction).not.toContain("p_product ->> 'photo_url'");
  });

  it('serializes one tenant operation, remembers all deterministic outcomes, and rejects mismatches', () => {
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).toContain("'duplicate_operation_mismatch'");
    expect(migration).toContain("'insufficient_stock'");
    expect(migration).toContain('replay_count = r.replay_count + 1');
    expect(migration).toContain('from private.inventory_operation_registry r');
    expect(migration).toContain('from public.inventory_movements m');
    expect(migration).toContain('v_historical_matches :=');
    expect(migration).toContain("v_type is null or v_type not in ('in', 'out')");
    expect(migration).toContain("v_quantity = 'nan'::numeric");
    expect(migration).toContain("v_min_stock = 'nan'::numeric");
    expect(migration).toContain("v_min = 'nan'::numeric");
  });

  it('reconciles durable inventory snapshots before terminal outcomes can be acknowledged', () => {
    expect(networkContext).toContain('async function reconcileterminalinventoryoperationcache');
    expect(networkContext).toContain('readcachestrict<inventoryproduct>');
    expect(networkContext).toContain('commitcachepairwithjournalstrict');
    expect(networkContext).toContain('reconciliationjournalkey');
    expect(networkContext).not.toContain('readcache<inventoryproduct>');
    expect(networkContext).not.toContain('promise.all([\n      writecache');
    expect(networkContext).toContain('await reconcileterminalinventoryoperationcache(retryrpcop');

    const dismissal = between(
      networkContext,
      'const dismissrejectedoperations',
      'const registerreloadhandler',
    );
    expect(dismissal).toContain('await reconcileterminalinventoryoperationcache');
    expect(dismissal.indexOf('await reconcileterminalinventoryoperationcache')).toBeLessThan(
      dismissal.indexOf("await backupqueue(rejected, 'dismiss-rejected')"),
    );
    expect(dismissal).toContain('throw error');
  });

  it('keeps new movements behind pending operations for the same product', () => {
    expect(inventoryHook).toContain('mustqueuebehindpendingproduct');
    expect(inventoryHook).toContain('if (!isonline || mustqueuebehindpendingproduct)');
  });

  it('uses membership authority and a validated trusted tenant context', () => {
    expect(migration).toContain('public.auth_is_platform_admin()');
    expect(migration).toContain('public.auth_has_active_membership(v_org_id)');
    expect(migration).toContain('from public.organization_memberships om');
    expect(migration).toContain(
      "pg_catalog.set_config('app.trusted_tenant_org', v_org_id::text, true)",
    );
    expect(migration).not.toContain('v_profile.role');
    expect(migration).not.toContain("p.role = 'super_admin'");
  });

  it('keeps the public write adapter security-definer and authenticated-only', () => {
    const rpc = between(
      migration,
      'create or replace function public.record_inventory_movement',
      'revoke all on function public.record_inventory_movement',
    );

    expect(rpc).toContain('security definer');
    expect(rpc).toContain("set search_path = ''");
    expect(migration).toContain(
      'revoke all on function public.record_inventory_movement(text, jsonb, jsonb, boolean)',
    );
    expect(migration).toContain(
      'grant execute on function public.record_inventory_movement(text, jsonb, jsonb, boolean)',
    );
    expect(migration).toContain('to authenticated');
  });

  it('authorizes product-card updates through tenant membership and platform authority', () => {
    const rpc = between(
      migration,
      'create or replace function public.update_inventory_product',
      'revoke all on function public.record_inventory_movement',
    );

    expect(rpc).toContain('security definer');
    expect(rpc).toContain("set search_path = ''");
    expect(rpc).toContain('public.auth_is_platform_admin()');
    expect(rpc).toContain('from public.organization_memberships om');
    expect(rpc).toContain("('admin', 'conducteur', 'magasinier')");
    expect(rpc).toContain("v_permissions_override -> 'canmanageinventoryproducts'");
    expect(rpc).toContain(
      "'app.trusted_tenant_org',\n    v_product_org_id::text,\n    true",
    );
    expect(rpc).not.toContain('from public.profiles');
    expect(migration).toContain(
      'revoke all on function public.update_inventory_product(text, jsonb)',
    );
    expect(migration).toContain(
      'grant execute on function public.update_inventory_product(text, jsonb)',
    );
  });
});

describe('inventory idempotency executable gates', () => {
  it('runs the production stock schema before the hardening migration and SQL matrix', () => {
    const stockMigration = 'supabase/migrations/20260809140643_add_inventory_module.sql';
    const hardeningMigration = migrationPath.toLowerCase();
    const matrix = 'supabase/tests/inventory_operation_idempotency.sql';

    expect(workflow).toContain(stockMigration);
    expect(workflow).toContain(hardeningMigration);
    expect(workflow).toContain(matrix);
    expect(workflow.indexOf(stockMigration)).toBeLessThan(workflow.indexOf(hardeningMigration));
    expect(workflow.indexOf(hardeningMigration)).toBeLessThan(workflow.indexOf(matrix));
  });

  it('covers success replay, mismatch, durable rejection, historical replay, and platform scope', () => {
    expect(sqlMatrix).toContain("'op-a-entry'");
    expect(sqlMatrix).toContain("'duplicate_operation_mismatch'");
    expect(sqlMatrix).toContain("'op-a-insufficient'");
    expect(sqlMatrix).toContain("'historical-match'");
    expect(sqlMatrix).toContain("'historical-mismatch'");
    expect(sqlMatrix).toContain("'shared-operation'");
    expect(sqlMatrix).toContain("'platform-cross-tenant'");
    expect(sqlMatrix).toContain('insert into private.platform_admins');
    expect(sqlMatrix).toContain('"unauthorized change"');
    expect(sqlMatrix).toContain('"material b platform"');
    expect(sqlMatrix).toContain("set role = 'magasinier'");
    expect(sqlMatrix).toContain("'op-a-missing-type'");
    expect(sqlMatrix).toContain("'op-a-nan-quantity'");
    expect(sqlMatrix).toContain("'op-a-nan-min-stock'");
  });
});
