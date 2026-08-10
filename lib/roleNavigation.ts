import type { UserRole } from '@/constants/types';

export const WAREHOUSE_HOME_ROUTE = '/inventory' as const;

export function isWarehouseRole(role?: UserRole | string | null): boolean {
  return role === 'magasinier';
}

/**
 * A warehouse-only account must never inherit the last operational tab from a
 * previous user on the same device. Only inventory and personal settings are
 * reachable once the organization membership is active.
 */
export function canWarehouseRoleAccessRootSegment(segment?: string): boolean {
  return segment === 'inventory' || segment === 'settings';
}
