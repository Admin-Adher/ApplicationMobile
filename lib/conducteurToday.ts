import { isOverdue } from '@/lib/reserveUtils';

type QueueReserve = {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  deadline?: string;
  building?: string;
  archivedAt?: string | null;
};

type QueueVisit = {
  id: string;
  title: string;
  date: string;
  chantierId?: string;
  status?: string;
};

function parseLooseDate(value?: string): Date | null {
  if (!value) return null;
  const parts = value.split(/[/-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isSameCalendarDay(value?: string, now = new Date()): boolean {
  const date = parseLooseDate(value);
  if (!date) return false;
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export function buildConducteurTodayQueue<TReserve extends QueueReserve, TVisit extends QueueVisit>(
  reserves: TReserve[],
  visits: TVisit[],
  chantierId?: string | null,
) {
  const active = reserves.filter(reserve => !reserve.archivedAt && reserve.status !== 'closed');
  const verification = active.filter(reserve => reserve.status === 'verification');
  const critical = active.filter(reserve => reserve.priority === 'critical' && reserve.status !== 'verification');
  const overdue = active.filter(reserve =>
    reserve.priority !== 'critical'
    && reserve.status !== 'verification'
    && isOverdue(reserve.deadline, reserve.status),
  );
  const todayVisits = visits.filter(visit => {
    if (chantierId && visit.chantierId && visit.chantierId !== chantierId) return false;
    if (visit.status === 'cancelled' || visit.status === 'done' || visit.status === 'closed') return false;
    return isSameCalendarDay(visit.date);
  });
  return { verification, critical, overdue, todayVisits };
}

export const TODAY_NOW_LIMIT = 5;
export const TODAY_LIFT_LIMIT = 3;

export function pickTodayNowItems<TReserve extends QueueReserve, TVisit extends QueueVisit>(queue: {
  verification: TReserve[];
  critical: TReserve[];
  overdue: TReserve[];
  todayVisits: TVisit[];
}) {
  const lifts = queue.verification.slice(0, TODAY_LIFT_LIMIT);
  const remaining = TODAY_NOW_LIMIT - lifts.length;
  const critical = queue.critical.slice(0, Math.max(0, remaining));
  const leftover = TODAY_NOW_LIMIT - lifts.length - critical.length;
  const visits = leftover > 0 ? queue.todayVisits.slice(0, leftover) : [];
  return { lifts, critical, visits };
}
