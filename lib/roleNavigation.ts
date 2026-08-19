import type { UserRole } from '@/constants/types';

export const WAREHOUSE_HOME_ROUTE = '/inventory' as const;

export function isWarehouseRole(role?: UserRole | string | null): boolean {
  return role === 'magasinier';
}

export function isConducteurRole(role?: UserRole | string | null): boolean {
  return role === 'conducteur';
}

export function isOrgAdminRole(role?: UserRole | string | null): boolean {
  return role === 'admin';
}

export const ADMIN_HOME_ROUTE = '/(tabs)/admin' as const;

export function canAdminRestoreTab(tab?: string | null): boolean {
  if (!tab) return false;
  return tab === '/(tabs)/admin'
    || tab === '/(tabs)'
    || tab === '/(tabs)/index'
    || tab === '/(tabs)/plans'
    || tab === '/(tabs)/reserves';
}

export const CONDUCTEUR_PRIMARY_TABS = ['index', 'plans', 'reserves', 'more'] as const;

export function canConducteurRestoreTab(tab?: string | null): boolean {
  if (!tab) return false;
  return tab === '/(tabs)' || tab === '/(tabs)/index' || tab === '/(tabs)/plans' || tab === '/(tabs)/reserves';
}

/**
 * A warehouse-only account must never inherit the last operational tab from a
 * previous user on the same device. Only inventory and personal settings are
 * reachable once the organization membership is active.
 */
export function canWarehouseRoleAccessRootSegment(segment?: string): boolean {
  return segment === 'inventory' || segment === 'settings';
}
