import type { PermissionsOverride, UserPermissions, UserRole } from '@/constants/types';

export const ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  super_admin:    { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true,  canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: true,  canAdjustInventory: true,  canExportInventory: true  },
  admin:          { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: true,  canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true,  canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: true,  canAdjustInventory: true,  canExportInventory: true  },
  conducteur:     { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: true,  canManageTeams: true,  canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: true,  canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: true  },
  chef_equipe:    { canCreate: true,  canEdit: true,  canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: true,  canUpdateAttendance: true,  canMovePins: true,  canEditChantier: false, canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: false },
  magasinier:     { canCreate: false, canEdit: false, canEditOwn: false, canDelete: false, canExport: false, canManageTeams: false, canViewTeams: false, canUpdateAttendance: false, canMovePins: false, canEditChantier: false, canViewInventory: true,  canRecordInventory: true,  canManageInventoryProducts: true,  canAdjustInventory: false, canExportInventory: true  },
  observateur:    { canCreate: false, canEdit: false, canEditOwn: false, canDelete: false, canExport: true,  canManageTeams: false, canViewTeams: true,  canUpdateAttendance: false, canMovePins: false, canEditChantier: false, canViewInventory: true,  canRecordInventory: false, canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: true  },
  sous_traitant:  { canCreate: false, canEdit: false, canEditOwn: true,  canDelete: false, canExport: false, canManageTeams: false, canViewTeams: false, canUpdateAttendance: false, canMovePins: false, canEditChantier: false, canViewInventory: false, canRecordInventory: false, canManageInventoryProducts: false, canAdjustInventory: false, canExportInventory: false },
};

export function resolvePermissions(role: UserRole, override?: PermissionsOverride): UserPermissions {
  const base: UserPermissions = ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.observateur;
  const canMovePinsDefault = role === 'super_admin' || role === 'admin' || role === 'conducteur' || role === 'chef_equipe';
  const merged: UserPermissions = {
    canCreate: base.canCreate ?? false,
    canEdit: base.canEdit ?? false,
    canEditOwn: base.canEditOwn ?? false,
    canDelete: base.canDelete ?? false,
    canExport: base.canExport ?? false,
    canManageTeams: base.canManageTeams ?? false,
    canViewTeams: base.canViewTeams ?? false,
    canUpdateAttendance: base.canUpdateAttendance ?? false,
    canMovePins: base.canMovePins ?? canMovePinsDefault,
    canEditChantier: base.canEditChantier ?? false,
    canViewInventory: base.canViewInventory ?? false,
    canRecordInventory: base.canRecordInventory ?? false,
    canManageInventoryProducts: base.canManageInventoryProducts ?? false,
    canAdjustInventory: base.canAdjustInventory ?? false,
    canExportInventory: base.canExportInventory ?? false,
  };
  if (role === 'super_admin') return merged;
  if (override) {
    for (const key of Object.keys(override) as (keyof PermissionsOverride)[]) {
      if (override[key] !== undefined) (merged as any)[key] = override[key];
    }
  }
  return merged;
}
