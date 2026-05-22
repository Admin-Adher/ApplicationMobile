import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured, SUPABASE_URL, SUPABASE_KEY } from './supabase';

// Maximum time we wait for getSession() before trying the AsyncStorage fallback.
// The Supabase auth lock is capped at 5 000 ms (LOCK_MAX_MS in lib/supabase.ts).
// We wait slightly longer (6 s) so the lock has time to release and getSession()
// can complete without hitting the fallback unnecessarily.
// If it still times out after 6 s the fallback reads the JWT directly from
// AsyncStorage — this handles devices where the Supabase auth-server network
// call hangs (e.g. slow DNS, restrictive firewall) even when local WiFi is fine.
const SESSION_CHECK_TIMEOUT_MS = 6_000;
const SESSION_VALIDATION_CACHE_MS = 4_000;

let sessionValidationPromise: Promise<boolean> | null = null;
let sessionValidationCachedValue: boolean | null = null;
let sessionValidationCachedUntil = 0;

/**
 * Derive the AsyncStorage key supabase-js v2 uses for the persisted session.
 * Format: sb-<projectRef>-auth-token
 * Example: sb-abcxyzabcxyz-auth-token
 */
function supabaseStorageKey(): string | null {
  try {
    if (!SUPABASE_URL) return null;
    const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
}

/**
 * Read the supabase-js session directly from AsyncStorage, bypassing the
 * auth lock entirely. Returns null when nothing is stored or the data is
 * malformed. Useful as a fallback when getSession() hangs due to a slow
 * JWT-refresh network call.
 */
export async function getSessionFromStorage(): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  expires_in?: number;
  token_type?: string;
  user: { id: string };
} | null> {
  try {
    const key = supabaseStorageKey();
    if (!key) return null;
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Force-refresh the JWT by making a raw HTTP POST to the Supabase auth
 * endpoint, completely bypassing the supabase-js auth lock.
 *
 * Use this when getSession() hangs (the JWT-refresh network call inside
 * supabase-js hangs, often on certain devices or networks).  This function
 * makes the same network call but with its own 10-second abort signal so it
 * can never block forever.
 *
 * On success the new session is written back to AsyncStorage so supabase-js
 * will pick it up on the next read.
 *
 * @returns new access_token string, or null if the refresh failed.
 */
export async function forceRefreshSession(): Promise<string | null> {
  const REFRESH_TIMEOUT_MS = 10_000;
  const tag = '[forceRefresh]';
  try {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.warn(`${tag} Supabase non configuré`);
      return null;
    }
    const cached = await getSessionFromStorage();
    if (!cached?.refresh_token) {
      console.warn(`${tag} pas de refresh_token dans AsyncStorage`);
      return null;
    }

    console.warn(`${tag} tentative refresh direct (bypass lock)…`);
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ refresh_token: cached.refresh_token }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn(`${tag} HTTP ${resp.status} — ${body.slice(0, 200)}`);
      return null;
    }

    const newSession = await resp.json();
    if (!newSession?.access_token) {
      console.warn(`${tag} réponse sans access_token`);
      return null;
    }

    // Write the refreshed session back into AsyncStorage so supabase-js
    // picks it up on the next read (after the stuck lock eventually releases).
    const key = supabaseStorageKey();
    if (key) {
      const toStore = {
        ...cached,
        access_token: newSession.access_token,
        refresh_token: newSession.refresh_token ?? cached.refresh_token,
        expires_at:
          newSession.expires_at ??
          Math.floor(Date.now() / 1000) + (newSession.expires_in ?? 3600),
        expires_in: newSession.expires_in ?? 3600,
        token_type: newSession.token_type ?? 'bearer',
        user: newSession.user ?? cached.user,
      };
      await AsyncStorage.setItem(key, JSON.stringify(toStore));
      console.warn(
        `${tag} JWT renouvelé ✓ — expire ${new Date(toStore.expires_at * 1000).toISOString()}`,
      );
    }
    return newSession.access_token as string;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      console.warn(`${tag} timeout après ${REFRESH_TIMEOUT_MS / 1000}s — serveur auth injoignable`);
    } else {
      console.warn(`${tag} erreur —`, e?.message ?? e);
    }
    return null;
  }
}

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
 * Safety:
 * 1. We first race getSession() against SESSION_CHECK_TIMEOUT_MS (6 s).
 *    The auth lock is capped at 5 s so getSession() should finish in time.
 * 2. If it still times out (e.g. the Supabase JWT-refresh HTTP call hangs),
 *    we fall back to reading the persisted session from AsyncStorage directly.
 *    If the stored JWT is still valid we return true so queries can proceed
 *    — the app remains functional even if the auth server is unreachable.
 */
async function runSupabaseSessionValidation(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const hasValidCachedSession = async () => {
    const cached = await getSessionFromStorage();
    if (cached?.access_token && typeof cached.expires_at === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      if (cached.expires_at - 10 > nowSec) {
        console.warn('[offlineCache] AsyncStorage fallback: JWT still valid, proceeding');
        return true;
      }
      console.warn('[offlineCache] AsyncStorage fallback: JWT expired — forceRefreshSession()');
      const newToken = await forceRefreshSession();
      if (newToken) {
        console.warn('[offlineCache] forceRefresh succeeded — session renouvelée');
        return true;
      }
      console.warn('[offlineCache] forceRefresh échoué — retour au cache local');
    }
    return false;
  };

  try {
    const timeoutPromise = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('session-check-timeout')), SESSION_CHECK_TIMEOUT_MS)
    );
    const sessionPromise = supabase.auth.getSession().then(r => r.data.session);
    const session = await Promise.race([sessionPromise, timeoutPromise]);
    if (!session?.user?.id) return hasValidCachedSession();
    if (typeof session.expires_at === 'number') {
      const nowSec = Math.floor(Date.now() / 1000);
      // 10-second margin: avoid the race where the token is technically valid
      // but supabase-js is mid-refresh and about to swap it out.
      if (session.expires_at - 10 < nowSec) {
        const newToken = await forceRefreshSession();
        return !!newToken;
      }
    }
    return true;
  } catch {
    // getSession() timed out (auth lock stuck or JWT-refresh network call hanging).
    // Fallback: read the persisted JWT from AsyncStorage without waiting for the
    // network. If it hasn't expired the app can still make authenticated requests.
    console.warn('[offlineCache] getSession() timeout — trying AsyncStorage fallback');
    try {
      return await hasValidCachedSession();
    } catch {
      // AsyncStorage read failed — truly offline/locked
    }
    return false;
  }
}

export async function isSupabaseSessionValid(): Promise<boolean> {
  const now = Date.now();
  if (sessionValidationCachedValue !== null && now < sessionValidationCachedUntil) {
    return sessionValidationCachedValue;
  }

  if (sessionValidationPromise) {
    return sessionValidationPromise;
  }

  sessionValidationPromise = runSupabaseSessionValidation()
    .then(result => {
      sessionValidationCachedValue = result;
      sessionValidationCachedUntil = Date.now() + SESSION_VALIDATION_CACHE_MS;
      return result;
    })
    .finally(() => {
      sessionValidationPromise = null;
    });

  return sessionValidationPromise;
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
    op: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
    data?: any;
    rpc?: { fn: string; args?: Record<string, any> };
    filter?: { column: string; value: string };
  }>,
  table: string,
): Set<string> {
  const ids = new Set<string>();
  for (const op of queue) {
    if (op.op === 'rpc' && op.rpc?.fn === 'link_reserves_to_visite') {
      if (table === 'visites') {
        if (op.data?.visite_id) ids.add(String(op.data.visite_id));
        if (Array.isArray(op.data?.previous_visite_ids)) {
          op.data.previous_visite_ids.forEach((id: any) => {
            if (id) ids.add(String(id));
          });
        }
      }
      if (table === 'reserves' && Array.isArray(op.data?.reserve_ids)) {
        op.data.reserve_ids.forEach((id: any) => {
          if (id) ids.add(String(id));
        });
      }
      continue;
    }
    if (op.table !== table) continue;
    if ((op.op === 'insert' || op.op === 'upsert') && op.data?.id) {
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
  const freshIds = new Set(fresh.map(item => item.id));

  if (!pendingIds || pendingIds.size === 0) {
    // Server is source of truth — but keep a 5-minute safety window for items
    // that were just created/synced and might not appear yet in the server
    // response (RLS propagation delay, token-swap race, transient network blip).
    // After the window they are genuinely dropped so server deletions propagate.
    const SAFETY_WINDOW_MS = 5 * 60 * 1000;
    const cutoff = Date.now() - SAFETY_WINDOW_MS;
    const veryRecent = cached.filter(item => {
      if (freshIds.has(item.id)) return false;
      const r = item as any;
      if (!r.createdAt) return false;
      try { return new Date(r.createdAt).getTime() > cutoff; } catch { return false; }
    });
    return veryRecent.length > 0 ? [...fresh, ...veryRecent] : fresh;
  }

  const localOnly = cached.filter(
    item => !freshIds.has(item.id) && pendingIds.has(item.id),
  );
  const cachedById = new Map(cached.map(item => [item.id, item]));
  const mergedFresh = fresh.map(item =>
    pendingIds.has(item.id) && cachedById.has(item.id)
      ? cachedById.get(item.id)!
      : item
  );
  return [...mergedFresh, ...localOnly];
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
