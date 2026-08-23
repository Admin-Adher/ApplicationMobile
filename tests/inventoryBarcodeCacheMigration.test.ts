import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL(
  '../supabase/migrations/20260810094152_add_inventory_barcode_catalog.sql',
  import.meta.url,
).href);
const migration = readFileSync(migrationPath, 'utf8').toLowerCase();

describe('inventory barcode cache migration security contract', () => {
  it('keeps the catalogue private and exposes RPCs only to service_role', () => {
    expect(migration).toContain('create table if not exists private.inventory_barcode_catalog');
    expect(migration).toContain('alter table private.inventory_barcode_catalog enable row level security');
    expect(migration).toContain('revoke all on table private.inventory_barcode_catalog from public, anon, authenticated');
    expect(migration).toContain('grant execute on function public.inventory_barcode_cache_claim');
    expect(migration).toContain('to service_role');
  });

  it('keeps successful results indefinitely and bounds negative caching to seven days', () => {
    expect(migration).toContain("status = 'found'");
    expect(migration).toContain('expires_at = null');
    expect(migration).toContain('604800');
    expect(migration).toContain("status = 'not_found'");
  });

  it('uses a lease to prevent simultaneous first-lookups', () => {
    expect(migration).toContain('lease_token uuid');
    expect(migration).toContain('lease_until timestamptz');
    expect(migration).toContain("'state', 'pending'");
    expect(migration).toContain("'state', 'claimed'");
  });
});
