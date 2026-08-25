export interface DependencyQueuedOperation {
  table?: string;
  op?: string;
  data?: Record<string, unknown> | null;
  rpc?: { fn?: string; args?: Record<string, unknown> };
}

/**
 * Parents must be durable before children that carry their foreign keys.
 * Values intentionally leave gaps so new dependency levels can be inserted.
 */
export function queueReplayPriority(op: DependencyQueuedOperation): number {
  if (op.table === 'visites' && op.op === 'insert') return 5;
  if (op.op === 'rpc' && op.rpc?.fn === 'create_reserve_with_photos') return 10;
  if (op.table === 'reserves' && op.op === 'insert') return 10;
  if (op.op === 'rpc' && op.rpc?.fn === 'record_inventory_movement') return 12;
  if (op.op === 'rpc' && op.rpc?.fn === 'update_inventory_product') return 13;
  if (op.op === 'rpc' && op.rpc?.fn === 'create_site_plan_revision_with_reserve_migration') return 15;
  if (op.op === 'rpc' && op.rpc?.fn === 'link_reserves_to_visite') return 20;
  if (op.table === 'photos' && op.op === 'insert') return 20;
  return 30;
}

function normalizedComparableValue(key: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (key === 'created_at' && typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (Array.isArray(value)) return value.map(item => normalizedComparableValue('', item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([nestedKey, nestedValue]) => [nestedKey, normalizedComparableValue(nestedKey, nestedValue)]),
    );
  }
  return value;
}

/**
 * A 23505 is idempotent only when the row behind the queued primary key is the
 * same business row. A duplicate from another tenant or another local entity
 * must never be fabricated into a successful insert.
 */
export function queuedInsertMatchesPersistedRow(
  queued: Record<string, unknown> | null | undefined,
  persisted: Record<string, unknown> | null | undefined,
): boolean {
  if (!queued || !persisted || !queued.id || queued.id !== persisted.id) return false;

  return Object.entries(queued).every(([key, expected]) => (
    JSON.stringify(normalizedComparableValue(key, expected))
      === JSON.stringify(normalizedComparableValue(key, persisted[key]))
  ));
}
