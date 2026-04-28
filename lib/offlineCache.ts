import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';

/**
 * Returns true only when Supabase has a usable session (non-expired JWT).
 *
 * This MUST be called before issuing a SELECT against an RLS-protected table
 * on cold start, after a token-refresh window, or when the app comes back from
 * background. Without it, Supabase silently returns `data: [], error: null`
 * when the JWT is missing or expired (because RLS denies anonymous reads),
 * and that empty array would otherwise overwrite the local cache — making it
 * look like all of the user's data was deleted server-side.
 *
 * We also subtract a 10-second safety margin from `expires_at` to avoid the
 * race where the token is technically valid but supabase-js is mid-refresh.
 */
export async function isSupabaseSessionValid(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return false;
    if (typeof session.expires_at === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      if (session.expires_at - 10 < nowSec) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Offline-first cache utility for hooks using useQuery.
 *
 * Pattern:
 * 1. Read AsyncStorage cache → return immediately if no network
 * 2. If online, fetch from Supabase → update cache → return fresh data
 * 3. If fetch fails, fall back to cache
 */

function namespacedKey(key: string, userId?: string): string {
  return userId ? `${key}_${userId}` : key;
}

export async function readCache<T>(key: string, userId?: string): Promise<T[] | null> {
  try {
    const raw = await AsyncStorage.getItem(namespacedKey(key, userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T[], userId?: string): Promise<void> {
  try {
    await AsyncStorage.setItem(namespacedKey(key, userId), JSON.stringify(data));
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
 * - Cache keys are namespaced by userId to prevent cross-account contamination.
 */
export async function offlineQuery<T>(
  cacheKey: string,
  fetchFn: (() => Promise<T[]>) | null,
  userId?: string,
): Promise<T[]> {
  const nsKey = namespacedKey(cacheKey, userId);

  // 1. Always read cache first
  const cached = await readCache<T>(cacheKey, userId);

  // 2. No fetch function (mock mode) — return cache
  if (!fetchFn) {
    return cached ?? [];
  }

  // 3. Try online fetch
  try {
    const fresh = await fetchFn();
    // Update cache with fresh data
    await writeCache(cacheKey, fresh, userId);
    return fresh;
  } catch (err) {
    // 4. Fetch failed — fall back to cache
    console.warn(`[offlineCache] fetch failed for ${nsKey}, using cache:`, err);
    if (cached) return cached;
    return [];
  }
}

/**
 * Compute the set of row IDs that have a pending offline mutation
 * (insert or update) for the given table.
 *
 * Used by `mergeWithCache` to distinguish:
 *   - rows that are missing from the server response because they were
 *     created/updated offline and not yet synced  → KEEP from cache
 *   - rows that are missing from the server response because they were
 *     deleted server-side (or by another device)  → DROP, do not resurrect
 */
export function pendingIdsForTable(
  queue: Array<{
    table: string;
    op: 'insert' | 'update' | 'delete';
    data?: any;
    filter?: { column: string; value: string };
  }>,
  table: string,
): Set<string> {
  const ids = new Set<string>();
  for (const op of queue) {
    if (op.table !== table) continue;
    if (op.op === 'insert' && op.data?.id) {
      ids.add(String(op.data.id));
    } else if (op.op === 'update' && op.filter?.column === 'id' && op.filter.value) {
      ids.add(String(op.filter.value));
    }
  }
  return ids;
}

/**
 * Merge fresh server data with cached data, keeping ONLY the local-only items
 * that have a pending offline mutation. Without `pendingIds`, no cached item
 * is preserved — server is the source of truth.
 *
 * Why: previously this helper kept any cached item missing from the server
 * response, treating them all as "offline-created". That caused server-side
 * deletions to never propagate (the deleted row stayed in cache forever and
 * was re-added on every fetch as a ghost).
 *
 * Safety net: when `options.queueLoaded === false`, the offline queue has not
 * yet been hydrated from AsyncStorage, so we cannot trust `pendingIds` to be
 * complete. In that case we fall back to a permissive merge that keeps every
 * cached row not present in `fresh` — this avoids the catastrophic data-loss
 * scenario where a cold-start fetch returns [] (RLS, network blip) and the
 * empty result wipes the entire local cache before the queue is restored.
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
  if (!pendingIds || pendingIds.size === 0) return fresh;
  const freshIds = new Set(fresh.map(item => item.id));
  const localOnly = cached.filter(
    item => !freshIds.has(item.id) && pendingIds.has(item.id),
  );
  return [...fresh, ...localOnly];
}

/**
 * Verify a local file URI still points to an existing file. Used by the sync
 * queue to detect photos whose underlying file was wiped by the OS (low-storage
 * cleanup, app data clear) so the operation can be either dropped or surfaced
 * to the user instead of failing forever.
 *
 * Returns true on web, on remote URLs, or when the file genuinely exists.
 */
export async function localFileExists(uri: string): Promise<boolean> {
  if (!uri) return false;
  if (!uri.startsWith('file://')) return true;
  try {
    const FileSystem = require('expo-file-system');
    const info = await FileSystem.getInfoAsync(uri);
    return !!info?.exists;
  } catch {
    return true;
  }
}
