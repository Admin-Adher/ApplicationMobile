import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearSupabaseStoredAuthCache,
  isSupabaseConfigured,
  resetAuthLock,
  supabase,
  SUPABASE_KEY,
  SUPABASE_URL,
} from './supabase';
import { notifySessionExpired, notifySessionRecovered } from './sessionExpiry';
export { pendingIdsForTable } from './offlineQueuePendingIds';
export { mergeWithCache } from './offlineCacheMerge';

// Maximum time we wait for getSession() before trying the AsyncStorage fallback.
// The Supabase auth lock is capped at 5 000 ms (LOCK_MAX_MS in lib/supabase.ts).
// We wait slightly longer (6 s) so the lock has time to release and getSession()
// can complete without hitting the fallback unnecessarily.
// If it still times out after 6 s the fallback reads the JWT directly from
// AsyncStorage — this handles devices where the Supabase auth-server network
// call hangs (e.g. slow DNS, restrictive firewall) even when local WiFi is fine.
const SESSION_CHECK_TIMEOUT_MS = 6_000;
const SESSION_INITIALIZATION_GRACE_MS = 2_500;
const SESSION_VALIDATION_CACHE_MS = 4_000;

let sessionValidationPromise: Promise<boolean> | null = null;
let sessionValidationCachedValue: boolean | null = null;
let sessionValidationCachedUntil = 0;
let forceRefreshPromise: Promise<string | null> | null = null;

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
async function runForceRefreshSession(): Promise<string | null> {
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
      // ── Terminal vs transient failure ──────────────────────────────────────
      // A 400/401 from the refresh endpoint means the refresh token itself is
      // rejected ("Refresh token is not valid", "invalid_grant", token revoked
      // server-side). Retrying or degrading to the anon key is futile — the only
      // cure is a fresh login. Signal the React layer so it can prompt a clean
      // re-authentication instead of leaving the user with an unsyncable queue.
      // 5xx / 429 are transient (server hiccup) and must NOT trigger logout.
      if (resp.status === 400 || resp.status === 401) {
        notifySessionExpired(`refresh_rejected_${resp.status}`);
      }
      return null;
    }

    const newSession = await resp.json();
    if (!newSession?.access_token) {
      console.warn(`${tag} réponse sans access_token`);
      return null;
    }
    // Refresh succeeded — clear any prior terminal-expiry latch.
    notifySessionRecovered();

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
      clearSupabaseStoredAuthCache();
      // The raw fallback has just made a newer session durable. New auth work
      // must not queue behind the stale lease that forced this fallback.
      resetAuthLock('raw session refresh persisted');
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

/** One refresh request per process, even when reads and queue replay wake together. */
export function forceRefreshSession(): Promise<string | null> {
  if (forceRefreshPromise) return forceRefreshPromise;
  forceRefreshPromise = runForceRefreshSession().finally(() => {
    forceRefreshPromise = null;
  });
  return forceRefreshPromise;
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
function sessionIsFresh(session: { expires_at?: number } | null | undefined): boolean {
  return typeof session?.expires_at === 'number'
    && session.expires_at - 10 > Math.floor(Date.now() / 1000);
}

function getClientSessionWithin(timeoutMs: number): Promise<any | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('session-check-timeout')), timeoutMs);
    supabase.auth.getSession().then(
      result => {
        clearTimeout(timer);
        resolve(result.data.session);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function runSupabaseSessionValidation(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  const stored = await getSessionFromStorage();
  if (stored?.access_token && sessionIsFresh(stored)) {
    console.log('[offlineCache] AsyncStorage session valid, proceeding');
    return true;
  }

  // When the persisted JWT is expired, supabase-js is already recovering it
  // during client initialization. Give that single owner a short bounded head
  // start instead of immediately racing the same one-time refresh token with
  // our raw fallback. The physical-device regression showed that race holding
  // the auth initialization lock for several extra seconds.
  const initializationTimeout = stored?.refresh_token
    ? SESSION_INITIALIZATION_GRACE_MS
    : SESSION_CHECK_TIMEOUT_MS;
  try {
    const session = await getClientSessionWithin(initializationTimeout);
    if (session?.user?.id && sessionIsFresh(session)) return true;
  } catch {
    console.warn(
      `[offlineCache] initialisation Supabase > ${initializationTimeout}ms — secours AsyncStorage`,
    );
  }

  if (!stored?.refresh_token) return false;

  console.warn('[offlineCache] JWT expiré — forceRefreshSession() après délai de grâce');
  const newToken = await forceRefreshSession();
  if (newToken) {
    console.warn('[offlineCache] forceRefresh succeeded — session renouvelée');
    return true;
  }
  console.warn('[offlineCache] forceRefresh échoué — retour au cache local');
  return false;
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
    return await readCacheStrict<T>(key, userId);
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, data: T[], userId?: string): Promise<void> {
  try {
    await writeCacheStrict(key, data, userId);
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/**
 * Cache variants for correctness-critical writes. Unlike the offline-first
 * helpers above, these deliberately propagate parse and storage errors so a
 * caller cannot acknowledge an operation before its durable snapshot is safe.
 */
export async function readCacheStrict<T>(key: string, userId?: string): Promise<T[] | null> {
  const raw = await AsyncStorage.getItem(namespacedKey(key, userId));
  return raw ? JSON.parse(raw) : null;
}

export async function writeCacheStrict<T>(
  key: string,
  data: T[],
  userId?: string,
): Promise<void> {
  await AsyncStorage.setItem(namespacedKey(key, userId), JSON.stringify(data));
}

export async function removeCacheStrict(key: string, userId?: string): Promise<void> {
  await AsyncStorage.removeItem(namespacedKey(key, userId));
}

interface CachePairJournal<TFirst, TSecond> {
  version: 1;
  firstKey: string;
  secondKey: string;
  firstData: TFirst[];
  secondData: TSecond[];
}

/**
 * Durably commits two cache snapshots through a write-ahead journal.
 *
 * AsyncStorage cannot atomically update two independent keys. The journal is
 * therefore persisted first and retained until both writes succeed. A retry
 * always replays the original targets from that journal, even when only one of
 * the cache writes completed, so a relative reconciliation cannot run twice.
 */
export async function commitCachePairWithJournalStrict<TFirst, TSecond>(input: {
  journalKey: string;
  firstKey: string;
  firstData: TFirst[];
  secondKey: string;
  secondData: TSecond[];
  userId?: string;
}): Promise<{ firstData: TFirst[]; secondData: TSecond[]; resumed: boolean }> {
  const existingEntries = await readCacheStrict<CachePairJournal<TFirst, TSecond>>(
    input.journalKey,
    input.userId,
  );
  const existing = existingEntries?.[0];
  if (
    existing
    && (
      existing.version !== 1
      || existing.firstKey !== input.firstKey
      || existing.secondKey !== input.secondKey
      || !Array.isArray(existing.firstData)
      || !Array.isArray(existing.secondData)
    )
  ) {
    throw new Error('Invalid cache reconciliation journal.');
  }

  const journal: CachePairJournal<TFirst, TSecond> = existing ?? {
    version: 1,
    firstKey: input.firstKey,
    secondKey: input.secondKey,
    firstData: input.firstData,
    secondData: input.secondData,
  };

  if (!existing) {
    await writeCacheStrict(input.journalKey, [journal], input.userId);
  }

  // Keep these sequential. The journal makes either partial-write boundary
  // recoverable and is only removed after both snapshots are durable.
  await writeCacheStrict(journal.firstKey, journal.firstData, input.userId);
  await writeCacheStrict(journal.secondKey, journal.secondData, input.userId);
  await removeCacheStrict(input.journalKey, input.userId);

  return {
    firstData: journal.firstData,
    secondData: journal.secondData,
    resumed: Boolean(existing),
  };
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
    const FileSystem = require('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(uri);
    return !!info?.exists;
  } catch {
    return true;
  }
}
