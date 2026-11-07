/** Current chantier reports use active reserves, including those already closed. */
export function activeReportReserves<T extends { archived_at?: unknown; archivedAt?: unknown }>(reserves: T[]): T[] {
  return reserves.filter(reserve => !reserve.archived_at && !reserve.archivedAt);
}

export function reportReserveStats(reserves: { status?: string }[]) {
  const count = (status: string) => reserves.filter(reserve => reserve.status === status).length;
  const closed = count('closed');
  return {
    total: reserves.length, closed, open: count('open'), inProgress: count('in_progress'),
    waiting: count('waiting'), verification: count('verification'),
    progress: reserves.length ? Math.round(100 * closed / reserves.length) : 0,
  };
}
