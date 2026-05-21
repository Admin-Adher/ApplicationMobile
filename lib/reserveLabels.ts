import { C } from '@/constants/colors';
import type { ReservePriority, ReserveStatus } from '@/constants/types';

export const RESERVE_STATUS_LABELS: Record<ReserveStatus, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturé',
};

export const RESERVE_STATUS_LABELS_FEMININE: Record<ReserveStatus, string> = {
  open: 'Ouverte',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturée',
};

export const RESERVE_STATUS_COLORS: Record<ReserveStatus, string> = {
  open: C.open,
  in_progress: C.inProgress,
  waiting: C.waiting,
  verification: C.verification,
  closed: C.closed,
};

export const RESERVE_PRIORITY_LABELS: Record<ReservePriority, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

export const RESERVE_PRIORITY_COLORS: Record<ReservePriority, string> = {
  critical: C.critical,
  high: C.high,
  medium: C.medium,
  low: C.low,
};

export const RESERVE_STATUS_CONFIG: Record<ReserveStatus, { label: string; color: string; bg: string }> = {
  open: { label: RESERVE_STATUS_LABELS.open, color: C.open, bg: C.openBg },
  in_progress: { label: RESERVE_STATUS_LABELS.in_progress, color: C.inProgress, bg: C.inProgressBg },
  waiting: { label: RESERVE_STATUS_LABELS.waiting, color: C.waiting, bg: C.waitingBg },
  verification: { label: RESERVE_STATUS_LABELS.verification, color: C.verification, bg: C.verificationBg },
  closed: { label: RESERVE_STATUS_LABELS.closed, color: C.closed, bg: C.closedBg },
};

export const RESERVE_PRIORITY_CONFIG: Record<ReservePriority, { label: string; color: string; bg: string; icon: string }> = {
  critical: { label: RESERVE_PRIORITY_LABELS.critical, color: C.critical, bg: C.criticalBg, icon: '▲' },
  high: { label: RESERVE_PRIORITY_LABELS.high, color: C.high, bg: C.highBg, icon: '▲' },
  medium: { label: RESERVE_PRIORITY_LABELS.medium, color: C.medium, bg: C.mediumBg, icon: '●' },
  low: { label: RESERVE_PRIORITY_LABELS.low, color: C.low, bg: C.lowBg, icon: '▼' },
};

export function getReserveStatusLabel(status?: string | null, feminine = false): string {
  if (!status) return '—';
  const labels = feminine ? RESERVE_STATUS_LABELS_FEMININE : RESERVE_STATUS_LABELS;
  return labels[status as ReserveStatus] ?? status;
}

export function getReservePriorityLabel(priority?: string | null): string {
  if (!priority) return '—';
  return RESERVE_PRIORITY_LABELS[priority as ReservePriority] ?? priority;
}

export function getReserveStatusColor(status?: string | null): string {
  if (!status) return C.textMuted;
  return RESERVE_STATUS_COLORS[status as ReserveStatus] ?? C.textMuted;
}

export function getReservePriorityColor(priority?: string | null): string {
  if (!priority) return C.textMuted;
  return RESERVE_PRIORITY_COLORS[priority as ReservePriority] ?? C.textMuted;
}
