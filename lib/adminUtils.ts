import { UserRole } from '@/constants/types';

export const ROLES: { value: UserRole; label: string; color: string; bg: string; description: string }[] = [
  { value: 'admin',         label: 'Administrateur',        color: '#EF4444', bg: '#FEF2F2', description: 'Gestion complète — utilisateurs, entreprises, abonnement' },
  { value: 'conducteur',    label: 'Conducteur de travaux',  color: '#3B82F6', bg: '#EFF6FF', description: 'Pilotage chantier — réserves, plans, OPR, rapports' },
  { value: 'chef_equipe',   label: "Chef d'équipe",          color: '#F59E0B', bg: '#FFFBEB', description: "Terrain — réserves, pointage, incidents (pas de suppression)" },
  { value: 'observateur',   label: 'Observateur',            color: '#6B7280', bg: '#F3F4F6', description: 'Lecture seule — consultation et export des données (gratuit)' },
  { value: 'sous_traitant', label: 'Sous-traitant',          color: '#10B981', bg: '#ECFDF5', description: 'Portail entreprise — voir et traiter ses propres réserves (gratuit)' },
];

export const ROLE_INFO: Record<string, { label: string; color: string; bg: string }> = {
  admin:        { color: '#EF4444', bg: '#FEF2F2', label: 'Administrateur' },
  conducteur:   { color: '#3B82F6', bg: '#EFF6FF', label: 'Conducteur de travaux' },
  chef_equipe:  { color: '#F59E0B', bg: '#FFFBEB', label: "Chef d'équipe" },
  observateur:  { color: '#6B7280', bg: '#F3F4F6', label: 'Observateur' },
  sous_traitant:{ color: '#10B981', bg: '#ECFDF5', label: 'Sous-traitant' },
  super_admin:  { color: '#7C3AED', bg: '#F5F3FF', label: 'Super Admin' },
};

export const PLAN_COLORS: Record<string, string> = {
  Solo:    '#10B981',
  'Équipe': '#3B82F6',
  Groupe:  '#8B5CF6',
};

export const FREE_ROLES: UserRole[] = ['observateur', 'sous_traitant'];

export const AVATAR_COLORS = ['#3B82F6','#10B981','#F59E0B','#8B5CF6','#EF4444','#06B6D4','#EC4899'];

export function hashColor(id: string, palette: string[] = AVATAR_COLORS): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff;
  return palette[h % palette.length];
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
