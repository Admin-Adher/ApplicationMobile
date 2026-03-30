import { ReserveStatus, ReservePriority } from '@/constants/types';
import { C } from '@/constants/colors';

export const RESERVE_BUILDINGS = ['A', 'B', 'C'];
export const RESERVE_ZONES = ['Zone Nord', 'Zone Sud', 'Zone Est', 'Zone Ouest', 'Zone Centre'];
export const RESERVE_LEVELS = ['Sous-sol', 'RDC', 'R+1', 'R+2', 'R+3'];
export const RESERVE_PRIORITIES: { value: ReservePriority; label: string; color: string }[] = [
  { value: 'low', label: 'Basse', color: C.low },
  { value: 'medium', label: 'Moyenne', color: C.medium },
  { value: 'high', label: 'Haute', color: C.high },
  { value: 'critical', label: 'Critique', color: C.critical },
];

export function genReserveId(existingCount: number): string {
  return `RSV-${String(existingCount + 1).padStart(3, '0')}`;
}

export function isOverdue(deadline: string, status: ReserveStatus): boolean {
  if (status === 'closed' || deadline === '—' || !deadline) return false;
  const parsed = parseDeadline(deadline);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
}

export function parseDeadline(deadline: string): Date | null {
  if (!deadline || deadline === '—') return null;
  const parts = deadline.split('/');
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(deadline);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(raw: string): string {
  if (!raw || raw === '—') return '—';
  const parts = raw.split('/');
  if (parts.length === 3) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  return raw;
}

export function deadlineDaysLeft(deadline: string): number | null {
  const d = parseDeadline(deadline);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function validateDeadline(s: string): boolean {
  if (!s) return true;
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return false;
  const [d, m, y] = s.split('/').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getDate() === d && date.getMonth() === m - 1 && date.getFullYear() === y;
}
