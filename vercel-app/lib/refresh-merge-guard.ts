/** Keeps local commits newer than a refresh from being replaced by its older read. */
export function createRefreshMergeGuard<T extends { id: string } & Record<string, unknown>>() {
  let revision = 0;
  const committed = new Map<string, Map<string, { revision: number; value: unknown }>>();
  return {
    checkpoint: () => revision,
    remember(row: T, fields: string[]) {
      const current = committed.get(row.id) ?? new Map();
      const savedAt = ++revision;
      fields.forEach(field => current.set(field, { revision: savedAt, value: row[field] }));
      committed.set(row.id, current);
    },
    clear() { committed.clear(); revision += 1; },
    merge(rows: T[], startedAt: number) {
      return rows.map(row => {
        const fields = committed.get(row.id);
        if (!fields) return row;
        const patch: Record<string, unknown> = {};
        fields.forEach((saved, field) => { if (saved.revision > startedAt) patch[field] = saved.value; });
        return Object.keys(patch).length ? { ...row, ...patch } : row;
      });
    },
  };
}
