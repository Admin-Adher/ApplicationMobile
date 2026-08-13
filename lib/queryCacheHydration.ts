/**
 * Reconciles a persisted, user-scoped cache with an already hydrated React
 * Query value. A present persisted cache is authoritative for account scope:
 * it seeds an empty query and removes rows that do not belong to that cache.
 */
export function reconcileUserScopedCache<T extends { id: string }>(
  persisted: readonly T[] | null,
  current: readonly T[] | undefined,
): T[] | undefined {
  if (persisted === null) return current ? [...current] : undefined;
  if (!current?.length) return [...persisted];

  const persistedIds = new Set(persisted.map(item => item.id));
  return current.filter(item => persistedIds.has(item.id));
}
