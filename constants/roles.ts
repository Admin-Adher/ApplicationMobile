import { UserRole } from './types';

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Administrator',
  admin: 'Administrator',
  conducteur: 'Construction manager',
  chef_equipe: 'Team lead',
  magasinier: 'Storekeeper',
  observateur: 'Observer',
  sous_traitant: 'Subcontractor',
};
