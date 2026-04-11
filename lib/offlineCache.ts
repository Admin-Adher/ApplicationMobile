import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Offline-first cache utility for hooks using useQuery.
 *
 * Pattern:
 * 1. Read AsyncStorage cache → return immediately if no network
 * 2. If online, fetch from Supabase → update cache → return fresh data
 * 3. If fetch fails, fall back to cache
 */

export async function readCache<T>(key: string): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/**
 * Offline-first query function.
 *
 * - Always tries to read cache first for instant display.
 * - If `fetchFn` succeeds, updates cache and returns fresh data.
 * - If `fetchFn` fails (network error), returns cached data as fallback.
 * - If `fetchFn` is null (no Supabase), returns cache only.
 */
export async function offlineQuery<T>(
  cacheKey: string,
  fetchFn: (() => Promise<T[]>) | null,
): Promise<T[]> {
  // 1. Always read cache first
  const cached = await readCache<T>(cacheKey);

  // 2. No fetch function (mock mode) — return cache
  if (!fetchFn) {
    return cached ?? [];
  }

  // 3. Try online fetch
  try {
    const fresh = await fetchFn();
    // Update cache with fresh data
    await writeCache(cacheKey, fresh);
    return fresh;
  } catch (err) {
    // 4. Fetch failed — fall back to cache
    console.warn(`[offlineCache] fetch failed for ${cacheKey}, using cache:`, err);
    if (cached) return cached;
    return [];
  }
}

/**
 * Merge fresh data with cached data, keeping local-only items.
 * Useful when some items were created offline and don't yet exist on server.
 */
export function mergeWithCache<T extends { id: string }>(
  fresh: T[],
  cached: T[] | null,
): T[] {
  if (!cached) return fresh;
  const freshIds = new Set(fresh.map(item => item.id));
  // Keep cached items that don't exist in fresh (created offline)
  const localOnly = cached.filter(item => !freshIds.has(item.id));
  return [...fresh, ...localOnly];
}
