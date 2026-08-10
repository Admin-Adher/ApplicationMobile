import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, resolvePermissions } from '../lib/permissions';

const migrationPath = fileURLToPath(new URL(
  '../supabase/migrations/20260810121326_expand_magasinier_inventory_permissions.sql',
  import.meta.url,
));
const migration = readFileSync(migrationPath, 'utf8').toLowerCase();

describe('inventory role permissions', () => {
  it('makes a magasinier autonomous inside inventory without granting other modules', () => {
    const permissions = ROLE_PERMISSIONS.magasinier;

    expect(permissions.canViewInventory).toBe(true);
    expect(permissions.canRecordInventory).toBe(true);
    expect(permissions.canManageInventoryProducts).toBe(true);
    expect(permissions.canExportInventory).toBe(true);
    expect(permissions.canAdjustInventory).toBe(false);
    expect(permissions.canCreate).toBe(false);
    expect(permissions.canViewTeams).toBe(false);
    expect(permissions.canEditChantier).toBe(false);
  });

  it('allows an administrator to revoke or grant each inventory capability per user', () => {
    const permissions = resolvePermissions('magasinier', {
      canRecordInventory: false,
      canManageInventoryProducts: false,
      canExportInventory: false,
      canAdjustInventory: true,
    });

    expect(permissions.canViewInventory).toBe(true);
    expect(permissions.canRecordInventory).toBe(false);
    expect(permissions.canManageInventoryProducts).toBe(false);
    expect(permissions.canExportInventory).toBe(false);
    expect(permissions.canAdjustInventory).toBe(true);
  });

  it('keeps super-admin permissions immutable', () => {
    const permissions = resolvePermissions('super_admin', {
      canViewInventory: false,
      canManageInventoryProducts: false,
    });

    expect(permissions.canViewInventory).toBe(true);
    expect(permissions.canManageInventoryProducts).toBe(true);
  });
});

describe('inventory permission migration contract', () => {
  it('separates product management from exceptional negative stock', () => {
    expect(migration).toContain("when 'manage' then v_role in ('admin', 'conducteur', 'magasinier')");
    expect(migration).toContain("when 'adjust' then v_role in ('admin', 'conducteur')");
    expect(migration).toContain("when 'manage' then 'canmanageinventoryproducts'");
    expect(migration).toContain("private.inventory_can('manage')");
  });

  it('grants magasinier exports and preserves existing explicit overrides', () => {
    expect(migration).toContain("when 'export' then v_role in ('admin', 'conducteur', 'magasinier', 'observateur')");
    expect(migration).toContain("jsonb_build_object('canmanageinventoryproducts', permissions_override -> 'canadjustinventory')");
  });

  it('keeps authorization server-side and authenticated-only', () => {
    expect(migration).toContain('security definer');
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain('revoke all on function private.inventory_can(text) from public, anon');
    expect(migration).toContain('grant execute on function public.update_inventory_product(text, jsonb) to authenticated');
  });
});
