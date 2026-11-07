export type ReserveListFilters = { level: string; zone: string; kind: string; lot: string };
export type ReserveListSort = 'date_desc' | 'date_asc' | 'priority' | 'deadline' | 'status';
export const DEFAULT_RESERVE_LIST_FILTERS: ReserveListFilters = { level: 'all', zone: 'all', kind: 'all', lot: 'all' };

type Row = Record<string, any>;

export function reserveLotLabel(lot: Row) {
  return [lot.code || lot.number, lot.name].filter(value => value != null && value !== '').join(' · ');
}

export function reserveLotSearchText(reserve: Row, lotsById: ReadonlyMap<string, Row>) {
  const lot = lotsById.get(String(reserve.lot_id ?? reserve.lotId ?? ''));
  return lot ? [lot.name, lot.code, lot.number, lot.code && `lot ${lot.code}`, lot.number != null && `lot ${lot.number}`].filter(Boolean).join(' ') : '';
}

export function matchesReserveListFilters(reserve: Row, filters: ReserveListFilters) {
  return (filters.level === 'all' || reserve.level === filters.level)
    && (filters.zone === 'all' || reserve.zone === filters.zone)
    && (filters.kind === 'all' || (reserve.kind || 'reserve') === filters.kind)
    && (filters.lot === 'all' || String(reserve.lot_id ?? reserve.lotId ?? '') === filters.lot);
}

function timestamp(value: unknown) {
  if (!value || typeof value !== 'string') return null;
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  const date = fr ? new Date(+fr[3], +fr[2] - 1, +fr[1], +(fr[4] ?? 0), +(fr[5] ?? 0), +(fr[6] ?? 0))
    : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime()) || (fr && (date.getDate() !== +fr[1] || date.getMonth() !== +fr[2] - 1))) return null;
  return date.getTime();
}

const PRIORITIES: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUSES: Record<string, number> = { open: 0, in_progress: 1, waiting: 2, verification: 3, closed: 4 };

export function sortReserveList<T extends Row>(rows: T[], order: ReserveListSort) {
  return [...rows].sort((a, b) => {
    let result = 0;
    if (order === 'priority') result = (PRIORITIES[a.priority] ?? 4) - (PRIORITIES[b.priority] ?? 4);
    else if (order === 'status') result = (STATUSES[a.status] ?? 5) - (STATUSES[b.status] ?? 5);
    else {
      const left = timestamp(order === 'deadline' ? a.deadline : a.created_at ?? a.createdAt ?? a.created);
      const right = timestamp(order === 'deadline' ? b.deadline : b.created_at ?? b.createdAt ?? b.created);
      // Missing dates remain last in both directions; IDs break equal-date ties.
      result = left == null ? (right == null ? 0 : 1) : right == null ? -1 : (left - right) * (order === 'date_desc' ? -1 : 1);
    }
    return result || String(a.id).localeCompare(String(b.id), 'fr', { numeric: true });
  });
}
