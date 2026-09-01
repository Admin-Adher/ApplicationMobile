/**
 * Terminal session-expiry signal bus.
 *
 * Problem this solves
 * ───────────────────
 * Every write path in the app falls back to the Supabase **anon key** when it
 * cannot obtain a valid user token (see `getSupabaseRestAccessToken` in
 * lib/supabaseRest.ts and `resolveStorageAccessToken` in lib/storage.ts). When
 * the user's refresh token has been revoked/expired server-side, that fallback
 * is silent and fatal:
 *   • writes (reserve creation RPC, table mutations) are rejected by RLS with
 *     `42501 permission denied` → the offline queue never drains;
 *   • reads return `HTTP 200 []` with no error → screens look empty.
 * The app still reports "online" (the anon key reaches Supabase), so nothing
 * surfaces to the user — they just see sync silently not happening.
 *
 * Fix
 * ───
 * When `forceRefreshSession` (lib/offlineCache.ts) gets a definitive rejection
 * from the auth server (`HTTP 400/401 — Refresh token is not valid`), it is
 * pointless to keep retrying or to degrade to the anon key: the only cure is a
 * fresh login. It calls `notifySessionExpired()` here, which the React layer
 * (AuthContext) observes to prompt a clean re-authentication instead of leaving
 * the user stuck with an ever-growing, unsyncable queue.
 *
 * This module is intentionally dependency-free so it can be imported by both
 * low-level libs (offlineCache, supabaseRest, storage) and the React context
 * layer without creating an import cycle.
 */

type SessionExpiryListener = (reason: string) => void;
type SessionRecoveryListener = () => void;

const listeners = new Set<SessionExpiryListener>();
const recoveryListeners = new Set<SessionRecoveryListener>();

let expired = false;
let lastReason: string | null = null;

/**
 * Signal that the session is terminally expired (refresh token rejected by the
 * auth server). Fires listeners only on the rising edge so repeated failed
 * refresh attempts don't spam the UI. Idempotent while already expired.
 */
export function notifySessionExpired(reason: string): void {
  lastReason = reason;
  if (expired) return;
  expired = true;
  for (const listener of [...listeners]) {
    try {
      listener(reason);
    } catch {
      // a misbehaving listener must never break the signal fan-out
    }
  }
}

/**
 * Clear the expiry latch after a successful (re)authentication or token
 * refresh. The next terminal failure will fire listeners again.
 */
export function notifySessionRecovered(): void {
  expired = false;
  lastReason = null;
  for (const listener of [...recoveryListeners]) {
    try {
      listener();
    } catch {
      // a misbehaving listener must never break the signal fan-out
    }
  }
}

/** True once a terminal refresh failure has been observed and not yet recovered. */
export function isSessionExpired(): boolean {
  return expired;
}

/** Last terminal-expiry reason, or null. */
export function getSessionExpiryReason(): string | null {
  return lastReason;
}

/**
 * Subscribe to terminal session-expiry signals. Returns an unsubscribe fn.
 * Note: subscribing does NOT replay a signal already latched — callers that
 * need the current state should also read `isSessionExpired()` on mount.
 */
export function subscribeSessionExpiry(listener: SessionExpiryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to successful login/token-refresh signals. Media components use
 * this to retry immediately instead of waiting for a remount or app restart.
 */
export function subscribeSessionRecovery(listener: SessionRecoveryListener): () => void {
  recoveryListeners.add(listener);
  return () => {
    recoveryListeners.delete(listener);
  };
}
