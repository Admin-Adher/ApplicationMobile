/**
 * Merges fresh server rows with the user-scoped local cache while keeping
 * only rows whose pending mutations still make the cache authoritative.
 */
export function mergeWithCache<T extends { id: string }>(
  fresh: T[],
  cached: T[] | null,
  pendingIds?: Set<string>,
  options?: { queueLoaded?: boolean },
): T[] {
  if (!cached || cached.length === 0) return fresh;
  if (options && options.queueLoaded === false) {
    const freshIds = new Set(fresh.map(item => item.id));
    const localOnly = cached.filter(item => !freshIds.has(item.id));
    return [...fresh, ...localOnly];
  }
  const freshIds = new Set(fresh.map(item => item.id));

  if (!pendingIds || pendingIds.size === 0) {
    const safetyWindowMs = 5 * 60 * 1000;
    const cutoff = Date.now() - safetyWindowMs;
    const veryRecent = cached.filter(item => {
      if (freshIds.has(item.id)) return false;
      const row = item as any;
      if (!row.createdAt) return false;
      try { return new Date(row.createdAt).getTime() > cutoff; } catch { return false; }
    });
    return veryRecent.length > 0 ? [...fresh, ...veryRecent] : fresh;
  }

  const localOnly = cached.filter(
    item => !freshIds.has(item.id) && pendingIds.has(item.id),
  );
  const cachedById = new Map(cached.map(item => [item.id, item]));
  const mergedFresh = fresh.map(item => (
    pendingIds.has(item.id) && cachedById.has(item.id)
      ? cachedById.get(item.id)!
      : item
  ));
  return [...mergedFresh, ...localOnly];
}
