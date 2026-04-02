import { UserRole } from './types';

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Administrateur',
  admin: 'Administrateur',
  conducteur: 'Conducteur de travaux',
  chef_equipe: "Chef d'équipe",
  observateur: 'Observateur',
  sous_traitant: 'Sous-traitant',
};
