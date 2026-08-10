import { UserRole } from '@/constants/types';

export const ROLES: { value: UserRole; label: string; color: string; bg: string; description: string }[] = [
  { value: 'admin',         label: 'Administrator',        color: '#EF4444', bg: '#FEF2F2', description: 'Full management - users, companies, subscription' },
  { value: 'conducteur',    label: 'Construction manager', color: '#3B82F6', bg: '#EFF6FF', description: 'Site steering - reserves, plans, handover, reports' },
  { value: 'chef_equipe',   label: 'Team lead',            color: '#F59E0B', bg: '#FFFBEB', description: 'Field - reserves, time tracking, incidents (no deletion)' },
  { value: 'magasinier',    label: 'Storekeeper',          color: '#0F766E', bg: '#F0FDFA', description: 'Inventory only - stock, entries, exits and movement history' },
  { value: 'observateur',   label: 'Observer',             color: '#6B7280', bg: '#F3F4F6', description: 'Read-only - view and export data (free)' },
  { value: 'sous_traitant', label: 'Subcontractor',        color: '#10B981', bg: '#ECFDF5', description: 'Company portal - view and process own reserves (free)' },
];

export const ROLE_INFO: Record<string, { label: string; color: string; bg: string }> = {
  admin:        { color: '#EF4444', bg: '#FEF2F2', label: 'Administrator' },
  conducteur:   { color: '#3B82F6', bg: '#EFF6FF', label: 'Construction manager' },
  chef_equipe:  { color: '#F59E0B', bg: '#FFFBEB', label: 'Team lead' },
  magasinier:   { color: '#0F766E', bg: '#F0FDFA', label: 'Storekeeper' },
  observateur:  { color: '#6B7280', bg: '#F3F4F6', label: 'Observer' },
  sous_traitant:{ color: '#10B981', bg: '#ECFDF5', label: 'Subcontractor' },
  super_admin:  { color: '#7C3AED', bg: '#F5F3FF', label: 'Super Admin' },
};

export const PLAN_COLORS: Record<string, string> = {
  Solo:    '#10B981',
  Team:    '#3B82F6',
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
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
