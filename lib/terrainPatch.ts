export type TerrainTable = 'visites' | 'oprs';
export type TerrainChange = { target: string; key?: string; before: any; after: any };
const collections: Record<TerrainTable, Set<string>> = {
  visites: new Set(['checklist_items', 'participants']),
  oprs: new Set(['items', 'visit_participants', 'signatories']),
};
const ignored = new Set(['id', 'organization_id', 'created_at', 'opr_revision']);
const normalized = (value: any): any => value === undefined ? null : Array.isArray(value)
  ? value.map(normalized) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
export const sameTerrainValue = (left: any, right: any) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));

/** Compare with the editor's own original snapshot, never a newer query cache. */
export function buildTerrainChanges(table: TerrainTable, before: Record<string, any>, after: Record<string, any>): TerrainChange[] {
  const changes: TerrainChange[] = [];
  for (const field of Object.keys(after)) {
    if (ignored.has(field) || sameTerrainValue(before[field], after[field])) continue;
    if (!collections[table].has(field)) {
      changes.push({ target: field, before: normalized(before[field]), after: normalized(after[field]) });
      continue;
    }
    const old: any[] = before[field] ?? [], next: any[] = after[field] ?? [];
    if (!Array.isArray(old) || !Array.isArray(next)) throw new Error('Liste de contrôle invalide.');
    for (const rows of [old, next]) if (rows.some(row => !row?.id) || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Identifiants de contrôle invalides.');
    const oldById = new Map(old.map(row => [row.id, row])), nextById = new Map(next.map(row => [row.id, row]));
    for (const row of old) if (!nextById.has(row.id)) changes.push({ target: field, key: row.id, before: normalized(row), after: null });
    for (const row of next) {
      const previous = oldById.get(row.id);
      if (!previous) { changes.push({ target: field, key: row.id, before: null, after: normalized(row) }); continue; }
      const patch: Record<string, any> = {}, expected: Record<string, any> = {};
      for (const property of new Set([...Object.keys(previous), ...Object.keys(row)])) {
        if (property !== 'id' && !sameTerrainValue(previous[property], row[property])) {
          patch[property] = normalized(row[property]); expected[property] = normalized(previous[property]);
        }
      }
      if (Object.keys(patch).length) changes.push({ target: field, key: row.id, before: expected, after: patch });
    }
  }
  return changes;
}

export function projectTerrainChanges(row: Record<string, any>, changes: TerrainChange[]): Record<string, any> {
  const next = { ...row };
  for (const change of changes) {
    if (!change.key) { next[change.target] = change.after; continue; }
    const rows: any[] = Array.isArray(next[change.target]) ? [...next[change.target]] : [];
    const index = rows.findIndex(item => item.id === change.key);
    if (change.after === null) { if (index !== -1) rows.splice(index, 1); }
    else if (index !== -1) rows[index] = { ...rows[index], ...change.after };
    else if (change.before === null) rows.push(change.after);
    next[change.target] = rows;
  }
  return next;
}

export function projectQueuedTerrainRows<T extends { id: string }>(rows: T[], table: TerrainTable, queue: readonly any[], from: (row: T) => Record<string, any>, to: (row: any) => T): T[] {
  return rows.map(row => {
    const changes = queue.filter(op => op.op === 'rpc' && op.rpc?.fn === 'apply_terrain_patch'
      && op.rpc.args?.p_table === table && op.rpc.args?.p_id === row.id)
      .flatMap(op => op.rpc.args.p_changes ?? []);
    return changes.length ? to(projectTerrainChanges(from(row), changes)) : row;
  });
}
