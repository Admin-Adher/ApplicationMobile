import { describe, expect, it } from 'vitest';
import { canWarehouseRoleAccessRootSegment, isWarehouseRole, WAREHOUSE_HOME_ROUTE } from '../lib/roleNavigation';

describe('warehouse role navigation', () => {
  it('recognizes only the magasinier role', () => {
    expect(isWarehouseRole('magasinier')).toBe(true);
    expect(isWarehouseRole('admin')).toBe(false);
    expect(isWarehouseRole(null)).toBe(false);
  });

  it('limits a magasinier to inventory and personal settings', () => {
    expect(WAREHOUSE_HOME_ROUTE).toBe('/inventory');
    expect(canWarehouseRoleAccessRootSegment('inventory')).toBe(true);
    expect(canWarehouseRoleAccessRootSegment('settings')).toBe(true);
    expect(canWarehouseRoleAccessRootSegment('(tabs)')).toBe(false);
    expect(canWarehouseRoleAccessRootSegment('admin')).toBe(false);
  });
});
