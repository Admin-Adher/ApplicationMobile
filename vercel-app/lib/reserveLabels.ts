export type ReserveStatus = 'open' | 'in_progress' | 'waiting' | 'verification' | 'closed';
export type ReservePriority = 'low' | 'medium' | 'high' | 'critical';

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
  open: '#DC2626',
  in_progress: '#2563EB',
  waiting: '#D97706',
  verification: '#7C3AED',
  closed: '#059669',
};

export const RESERVE_PRIORITY_LABELS: Record<ReservePriority, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
};

export const RESERVE_PRIORITY_COLORS: Record<ReservePriority, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#6B7280',
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
  if (!status) return '#6B7280';
  return RESERVE_STATUS_COLORS[status as ReserveStatus] ?? '#6B7280';
}

export function getReservePriorityColor(priority?: string | null): string {
  if (!priority) return '#6B7280';
  return RESERVE_PRIORITY_COLORS[priority as ReservePriority] ?? '#6B7280';
}
