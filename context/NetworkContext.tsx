import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback,
} from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isLocalUri, uploadLocalPhotosInPayload, purgeOrphanedPhotoFiles } from '@/lib/storage';
import { useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/queryClient';

const OFFLINE_QUEUE_PREFIX = 'buildtrack_offline_queue_v3_';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusConflict {
  id: string;
  reserveId: string;
  reserveTitle: string;
  serverStatus: string;
  localStatus: string;
  author: string;
  history: any[];
  closedAt?: string;
  closedBy?: string;
}

/**
 * A single queued offline mutation.
 *
 * Generic operations: table + op + filter + data → replayed verbatim against Supabase.
 * Status-change operations also carry a conflictCheck so we can detect concurrent edits.
 */
export interface QueuedOperation {
  id: string;
  queuedAt: string;
  table: string;
  op: 'insert' | 'update' | 'delete';
  filter?: { column: string; value: string };
  data?: Record<string, any>;
  /** Present only for reserve-status mutations. */
  conflictCheck?: {
    entityId: string;
    previousStatus: string;
    newStatus: string;
    author: string;
    history: any[];
    closedAt?: string;
    closedBy?: string;
  };
  /** Last server error captured during a failed sync attempt (set by processSyncQueue). */
  lastError?: string;
  /** Number of failed sync attempts. */
  attemptCount?: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'done' | 'error';

interface NetworkContextValue {
  isOnline: boolean;
  queue: QueuedOperation[];
  queueCount: number;
  /**
   * `true` once the offline queue has been hydrated from AsyncStorage for the
   * current user. Read-side hooks (useReserves, usePhotos, …) MUST gate any
   * cache-overwriting fetch on this — fetching before the queue is loaded can
   * miss pending mutations and let an empty server response wipe the cache.
   */
  queueLoaded: boolean;
  syncStatus: SyncStatus;
  /**
   * Live progress while `syncStatus === 'syncing'`. `total` is the number of
   * operations the current pass started with, `done` is how many have been
   * processed (success or failure) so far. Both are 0 outside an active sync.
   */
  syncProgress: { done: number; total: number };
  conflicts: StatusConflict[];
  enqueueOperation: (op: Omit<QueuedOperation, 'id' | 'queuedAt'>) => void;
  resolveConflict: (conflictId: string, chosenStatus: string) => Promise<void>;
  dismissConflicts: () => void;
  registerReloadHandler: (fn: () => void) => void;
  clearQueue: () => Promise<void>;
  retrySync: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  queue: [],
  queueCount: 0,
  queueLoaded: true,
  syncStatus: 'idle',
  syncProgress: { done: 0, total: 0 },
  conflicts: [],
  enqueueOperation: () => {},
  resolveConflict: async () => {},
  dismissConflicts: () => {},
  registerReloadHandler: () => {},
  clearQueue: async () => {},
  retrySync: async () => {},
});

export function useNetwork() {
  return useContext(NetworkContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function genQueueId() {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturé',
};

// Ping URLs for native connectivity detection
const PING_URLS = [
  'https://clients3.google.com/generate_204',
  'https://connectivitycheck.gstatic.com/generate_204',
];

// Reusable promise timeout helper (does not need a label in this context)
function withTimeoutMs<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const offlineQueueKey = OFFLINE_QUEUE_PREFIX + (userId ?? 'anon');
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [conflicts, setConflicts] = useState<StatusConflict[]>([]);

  const prevOnlineRef = useRef(true);
  const syncingRef = useRef(false);
  const reloadHandlerRef = useRef<(() => void) | null>(null);
  const lastLoadedKeyRef = useRef<string | null>(null);

  // ── Stable refs so any closure (including stale ones in AppState) can always
  // access the CURRENT queue and the CURRENT processSyncQueue implementation.
  // This is the fix for the "stale closure" bug where AppState and ping
  // handlers captured the initial empty queue and never saw later updates.
  const queueRef = useRef<QueuedOperation[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  const isOnlineRef = useRef(true);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  // processSyncQueueRef is always updated to point to the latest version of
  // processSyncQueue on every render, so stale closures can safely call
  // processSyncQueueRef.current() and get the correct behaviour.
  const processSyncQueueRef = useRef<() => Promise<void>>(async () => {});

  // Throttle: track when the last sync attempt started so ping-driven retries
  // don't hammer the server (max one attempt per 20 seconds).
  const lastSyncAttemptRef = useRef<number>(0);

  // ── Queue persistence ──────────────────────────────────────────────────────

  const saveQueue = useCallback(async (q: QueuedOperation[]) => {
    try {
      await AsyncStorage.setItem(offlineQueueKey, JSON.stringify(q));
    } catch {}
  }, [offlineQueueKey]);

  // Load the queue for the *current* user. We defer hydration until we know
  // user.id to avoid the catastrophic race where the queue is initially loaded
  // under the `..._anon` key (empty) and then never re-merged once user.id
  // arrives — losing every offline mutation made before login finished
  // restoring. We also migrate any orphan `..._anon` queue (mutations enqueued
  // before authentication completed) into the per-user key so they can sync.
  const loadQueue = useCallback(async () => {
    setQueueLoaded(false);
    const userKey = userId ? OFFLINE_QUEUE_PREFIX + userId : null;
    const anonKey = OFFLINE_QUEUE_PREFIX + 'anon';
    try {
      let merged: QueuedOperation[] = [];
      const seen = new Set<string>();

      // Read user-scoped queue if available
      if (userKey) {
        try {
          const rawUser = await AsyncStorage.getItem(userKey);
          if (rawUser) {
            const parsed = JSON.parse(rawUser);
            if (Array.isArray(parsed)) {
              for (const op of parsed) {
                if (op?.id && !seen.has(op.id)) { seen.add(op.id); merged.push(op); }
              }
            }
          }
        } catch {}

        // Migrate any orphan anonymous queue (mutations made before login finished)
        try {
          const rawAnon = await AsyncStorage.getItem(anonKey);
          if (rawAnon) {
            const parsedAnon = JSON.parse(rawAnon);
            if (Array.isArray(parsedAnon) && parsedAnon.length > 0) {
              for (const op of parsedAnon) {
                if (op?.id && !seen.has(op.id)) { seen.add(op.id); merged.push(op); }
              }
              await AsyncStorage.setItem(userKey, JSON.stringify(merged));
              await AsyncStorage.removeItem(anonKey);
              console.warn(`[NetworkContext] migrated ${parsedAnon.length} anon queue items to ${userKey}`);
            }
          }
        } catch {}
      } else {
        // No user yet — read anon-only queue (rare; usually we just wait for user.id)
        try {
          const rawAnon = await AsyncStorage.getItem(anonKey);
          if (rawAnon) {
            const parsed = JSON.parse(rawAnon);
            if (Array.isArray(parsed)) merged = parsed;
          }
        } catch {}
      }

      setQueue(merged);
      lastLoadedKeyRef.current = userKey ?? anonKey;
    } catch {
      setQueue([]);
    } finally {
      setQueueLoaded(true);
    }
  }, [userId]);

  // ── Hydrate queue when user.id changes (cold start, login, switch) ─────────
  useEffect(() => {
    const targetKey = userId ? OFFLINE_QUEUE_PREFIX + userId : OFFLINE_QUEUE_PREFIX + 'anon';
    if (lastLoadedKeyRef.current === targetKey) return;
    setQueueLoaded(false);
    setQueue([]);
    loadQueue();
  }, [userId, loadQueue]);

  // Once the queue finishes loading, force every gated query to re-evaluate
  // its queryFn so they can finally fetch from the server safely.
  useEffect(() => {
    if (queueLoaded) {
      try { queryClient.invalidateQueries(); } catch {}
    }
  }, [queueLoaded]);

  // ── Network detection ──────────────────────────────────────────────────────
  //
  // Native: active pinging every 10 s. After each ping we also check whether
  // there are pending ops that need syncing — this handles the case where
  // isOnline was ALREADY true when the app woke up (no state change → the
  // isOnline-change effect below wouldn't fire).

  useEffect(() => {
    if (Platform.OS === 'web') {
      const current = typeof navigator !== 'undefined' ? navigator.onLine : true;
      setIsOnline(current);
      const up = () => setIsOnline(true);
      const dn = () => setIsOnline(false);
      window.addEventListener('online', up);
      window.addEventListener('offline', dn);
      return () => {
        window.removeEventListener('online', up);
        window.removeEventListener('offline', dn);
      };
    }

    const check = async () => {
      let online = false;
      for (const url of PING_URLS) {
        try {
          const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
          if (res.ok || res.status === 204) { online = true; break; }
        } catch {}
      }
      setIsOnline(online);

      // Safety-net: if we are online with pending ops and not already syncing,
      // trigger a sync attempt — but no more than once every 20 seconds.
      // This covers the case where the app woke up with isOnline already true
      // (no state transition) so the isOnline-change effect below never fired.
      if (
        online &&
        isSupabaseConfigured &&
        queueRef.current.length > 0 &&
        !syncingRef.current &&
        Date.now() - lastSyncAttemptRef.current > 20_000
      ) {
        processSyncQueueRef.current();
      }
    };

    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, []);

  // ── Trigger sync + refetch when coming back online ─────────────────────────

  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      if (isSupabaseConfigured) {
        if (queueRef.current.length > 0) processSyncQueueRef.current();
        queryClient.invalidateQueries();
      }
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  // ── Cold-start sync trigger ────────────────────────────────────────────────
  //
  // Once the offline queue has been hydrated AND we are online AND the user
  // is authenticated, immediately attempt to flush any pending mutations.

  useEffect(() => {
    if (!queueLoaded) return;
    if (!isOnline) return;
    if (!isSupabaseConfigured) return;
    if (!userId) return;
    if (queue.length === 0) return;
    if (syncingRef.current) return;
    const t = setTimeout(() => {
      processSyncQueueRef.current();
    }, 800);
    return () => clearTimeout(t);
  }, [queueLoaded, isOnline, userId, queue.length]);

  // ── Foreground wake-up: session heal + sync (native only) ──────────────────
  //
  // This is the fix for the long-standing "sync doesn't happen after a long
  // background sleep" bug. Root causes addressed here:
  //
  //   1. Stale closure: AppState listener was created once at mount, capturing
  //      processSyncQueue with queue=[] (initial state). Now we call via ref.
  //
  //   2. Frozen Supabase client: after a long sleep the auth lock can be stuck
  //      (a refresh was in-flight when JS was frozen). We use refreshSession()
  //      with a strict timeout to break the lock and get a fresh token.
  //
  //   3. isOnline already true: if the device had connectivity before and after
  //      the sleep, isOnline never changes state, so the isOnline effect above
  //      never fires. We explicitly re-ping here and trigger sync if online.
  //
  //   4. Realtime WebSocket zombie: the WS connection can become a ghost after
  //      a long sleep. We force-reconnect here.

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isSupabaseConfigured) return;

    // Track when the app last went to background so we know if a long sleep occurred.
    let backgroundAt = 0;

    const wakeUp = async () => {
      const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
      const longSleep = sleptMs > 30_000; // more than 30 s in background

      // ── 1. Heal the Supabase auth client ──────────────────────────────────
      // After a long sleep the access token is likely expired and/or the
      // internal auth lock is frozen. Calling refreshSession() with a short
      // timeout forces a new token AND breaks any stuck lock (our safeLock
      // implementation in lib/supabase.ts will time out and release the lock).
      // We always refresh after a long sleep; for short returns we only probe.
      if (longSleep) {
        try {
          await withTimeoutMs((supabase as any).auth.refreshSession(), 8000);
        } catch (err) {
          console.warn('[wake] refreshSession failed:', (err as any)?.message ?? err);
          // Fallback: try a plain getSession to unstick the client
          try { await withTimeoutMs((supabase as any).auth.getSession(), 4000); } catch {}
        }
      } else {
        try {
          await withTimeoutMs((supabase as any).auth.getSession(), 4000);
        } catch {
          try {
            await withTimeoutMs((supabase as any).auth.refreshSession(), 6000);
          } catch (err) {
            console.warn('[wake] refreshSession (short sleep) failed:', (err as any)?.message ?? err);
          }
        }
      }

      // ── 2. Reconnect the Realtime WebSocket ───────────────────────────────
      try { (supabase as any).realtime?.connect?.(); } catch {}

      // ── 3. Re-ping to get a fresh connectivity reading ───────────────────
      // We can't rely on the stale isOnline state: if the network was already
      // active before sleep, isOnline is still true and the change-based effect
      // won't fire. We ping explicitly and act on the result.
      let online = false;
      for (const url of PING_URLS) {
        try {
          const res = await withTimeoutMs(
            fetch(url, { method: 'HEAD', cache: 'no-cache' }),
            5000,
          );
          if (res.ok || res.status === 204) { online = true; break; }
        } catch {}
      }
      setIsOnline(online);
      isOnlineRef.current = online;

      // ── 4. Invalidate all cached queries ─────────────────────────────────
      try { queryClient.invalidateQueries(); } catch {}

      // ── 5. Trigger sync if we have pending operations ─────────────────────
      if (online && queueRef.current.length > 0 && !syncingRef.current) {
        processSyncQueueRef.current();
      }
    };

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        wakeUp();
      } else if (next === 'background' || next === 'inactive') {
        backgroundAt = Date.now();
      }
    });

    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync logic ─────────────────────────────────────────────────────────────

  async function processSyncQueue() {
    // IMPORTANT: use queueRef.current (not queue from closure) so this function
    // works correctly even when called from a stale closure (AppState listener,
    // ping interval, etc.).
    if (syncingRef.current || queueRef.current.length === 0 || !isSupabaseConfigured) return;
    syncingRef.current = true;
    lastSyncAttemptRef.current = Date.now();
    setSyncStatus('syncing');

    // ── Ensure the Supabase session is fresh before any upload ────────────────
    // A stale/expired JWT causes Storage uploads to fail with HTTP 401 under
    // RLS, resulting in the endless "32 échecs" cycle the user sees.
    // We always refresh here (cheap no-op if the token is still valid).
    try {
      await withTimeoutMs((supabase as any).auth.refreshSession(), 8000);
    } catch {
      try { await withTimeoutMs((supabase as any).auth.getSession(), 4000); } catch {}
    }

    const pendingConflicts: StatusConflict[] = [];
    const failedOps: QueuedOperation[] = [];
    // Snapshot the queue from the ref (always current, not a stale closure)
    const currentQueue = [...queueRef.current];
    setSyncProgress({ done: 0, total: currentQueue.length });

    // Helper: re-queue an op while attaching the latest error message and
    // bumping its attempt counter so the user can see in the UI why it stays
    // stuck after each retry.
    const fail = (op: QueuedOperation, err: any) => {
      let msg: string;
      if (!err) msg = 'Erreur inconnue';
      else if (typeof err === 'string') msg = err;
      else if (err.message) {
        msg = err.message;
        if (err.code) msg = `[${err.code}] ${msg}`;
        if (err.details) msg += ` — ${err.details}`;
        if (err.hint) msg += ` (${err.hint})`;
      } else {
        try { msg = JSON.stringify(err); } catch { msg = String(err); }
      }
      console.warn(`[queue] ${op.op} ${op.table} failed:`, msg);
      failedOps.push({
        ...op,
        lastError: msg,
        attemptCount: (op.attemptCount ?? 0) + 1,
      });
    };

    let processed = 0;
    for (const op of currentQueue) {
      try {
        // ── Status-change conflict detection ───────────────────────────────
        if (op.conflictCheck) {
          const { entityId, previousStatus, newStatus, author, history, closedAt, closedBy } = op.conflictCheck;

          const { data: serverData, error: fetchErr } = await (supabase as any)
            .from('reserves')
            .select('status, title')
            .eq('id', entityId)
            .single();

          if (fetchErr) { fail(op, fetchErr); continue; }

          if (serverData && serverData.status !== previousStatus && serverData.status !== newStatus) {
            pendingConflicts.push({
              id: op.id,
              reserveId: entityId,
              reserveTitle: serverData.title ?? entityId,
              serverStatus: serverData.status,
              localStatus: newStatus,
              author,
              history,
              closedAt,
              closedBy,
            });
            continue;
          }

          const { error: applyErr } = await (supabase as any).from('reserves').update({
            status: newStatus,
            history,
            closed_at: closedAt ?? null,
            closed_by: closedBy ?? null,
          }).eq('id', entityId);

          if (applyErr) fail(op, applyErr);
          continue;
        }

        // ── Upload local photos / files before replaying insert/update ───────
        let data = op.data ? { ...op.data } : op.data;
        if (data) {
          if (op.table === 'reserves') {
            if (data.deadline === '—' || data.deadline === '') {
              data.deadline = null;
            }
          }
          try {
            const prep = await uploadLocalPhotosInPayload(op.table, data);
            if (prep.data === null && prep.allOk && op.table === 'photos') {
              console.warn(`[queue] dropping photos op ${op.id}: local file missing on disk`);
              processed += 1;
              setSyncProgress({ done: processed, total: currentQueue.length });
              continue;
            }
            if (prep.data) data = prep.data;
            if (!prep.allOk) {
              if (op.table === 'reserves') {
                // ── Partial photo failure for a reserve ───────────────────────
                // The photo upload failed but the reserve's text data (title,
                // description, status, lot, company, etc.) must not be held
                // hostage by it. Strategy:
                //   1. Strip the local photo URIs from the payload.
                //   2. Proceed with the insert/update so the reserve is saved.
                //   3. Re-queue a photo-only UPDATE so the photos keep retrying.
                const safeData = { ...(data ?? {}) };
                const pendingPhotoData: Record<string, any> = {};

                if (typeof safeData.photo_uri === 'string' && isLocalUri(safeData.photo_uri)) {
                  pendingPhotoData.photo_uri = safeData.photo_uri;
                  safeData.photo_uri = null;
                }
                if (Array.isArray(safeData.photos)) {
                  const localOnes = safeData.photos.filter(
                    (p: any) => p?.uri && isLocalUri(p.uri),
                  );
                  if (localOnes.length > 0) {
                    pendingPhotoData.photos = localOnes;
                    safeData.photos = safeData.photos.filter(
                      (p: any) => !p?.uri || !isLocalUri(p.uri),
                    );
                  }
                }

                data = safeData;

                // Re-queue a photo-only UPDATE (will keep retrying until it succeeds)
                const reserveId = safeData.id ?? op.filter?.value;
                if (Object.keys(pendingPhotoData).length > 0 && reserveId) {
                  const errDetail = prep.uploadErrors?.join(' | ') ?? '';
                  console.warn(
                    `[queue] reserve ${reserveId}: syncing text data without photos. Upload errors: ${errDetail}`,
                  );
                  failedOps.push({
                    id: genQueueId(),
                    queuedAt: new Date().toISOString(),
                    table: 'reserves',
                    op: 'update',
                    filter: { column: 'id', value: reserveId },
                    data: pendingPhotoData,
                    lastError: errDetail || 'Échec upload photo. Nouvelle tentative au prochain passage.',
                    attemptCount: (op.attemptCount ?? 0) + 1,
                  });
                }
                // Fall through to the generic replay below with safeData
              } else {
                const errDetail = prep.uploadErrors?.join(' | ') ?? '';
                fail(op, errDetail || 'Échec upload de fichiers locaux (photos/plans). Nouvelle tentative au prochain passage.');
                continue;
              }
            }
          } catch (e) {
            fail(op, e);
            continue;
          }
        }

        // ── Generic table/op replay ────────────────────────────────────────
        let result: { error: any; data?: any[] | null };

        if (op.op === 'insert') {
          result = await (supabase as any).from(op.table).insert(data!);
          if (result.error?.code === '23505') result = { error: null };
        } else if (op.op === 'update') {
          const q = (supabase as any).from(op.table).update(data!).select();
          result = op.filter
            ? await q.eq(op.filter.column, op.filter.value)
            : await q;
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            if (op.filter?.column === 'id') {
              try {
                const { data: exists, error: existsErr } = await (supabase as any)
                  .from(op.table)
                  .select('id')
                  .eq('id', op.filter.value)
                  .maybeSingle();
                if (!existsErr && !exists) {
                  continue;
                }
              } catch {}
            }
            fail(op, `UPDATE sur ${op.table} a affecté 0 ligne. Probablement bloqué par une policy RLS, ou l'élément ne vous appartient plus.`);
            continue;
          }
        } else {
          const q = (supabase as any).from(op.table).delete().select();
          result = op.filter
            ? await q.eq(op.filter.column, op.filter.value)
            : await q;
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            if (op.table === 'reserves' && op.filter?.column === 'id') {
              try {
                const { data: exists, error: existsErr } = await (supabase as any)
                  .from('reserves')
                  .select('id')
                  .eq('id', op.filter.value)
                  .maybeSingle();
                if (!existsErr && !exists) {
                  continue;
                }
              } catch {}
            }
            fail(op, `DELETE sur ${op.table} bloqué par une policy RLS (0 ligne supprimée).`);
            continue;
          }
        }

        if (result.error) fail(op, result.error);
      } catch (e) {
        fail(op, e);
      } finally {
        processed += 1;
        setSyncProgress({ done: processed, total: currentQueue.length });
      }
    }

    // Keep only unresolved items in the queue
    const remaining = [
      ...pendingConflicts.map(c => currentQueue.find(o => o.id === c.id)!),
      ...failedOps,
    ].filter(Boolean);

    setQueue(remaining);
    await saveQueue(remaining);

    try { queryClient.invalidateQueries(); } catch {}

    if (pendingConflicts.length > 0) {
      setConflicts(pendingConflicts);
      setSyncStatus('conflict');
    } else if (failedOps.length > 0) {
      setSyncStatus('error');
      reloadHandlerRef.current?.();
    } else {
      setSyncStatus('done');
      reloadHandlerRef.current?.();
      setTimeout(() => setSyncStatus('idle'), 4000);

      // ── Purge orphaned local photo files after a clean sync ───────────────
      // When all operations synced successfully there are no remaining local
      // URIs that need to be preserved. Collect any local URIs still referenced
      // by the (now-empty) queue — should be none — and delete everything else
      // in documentDirectory/photos/ that is older than 7 days.
      // This prevents device storage from filling with undeleted photo copies.
      const referencedUris = new Set<string>();
      for (const op of remaining) {
        const d = op.data;
        if (!d) continue;
        if (typeof d.photo_uri === 'string' && isLocalUri(d.photo_uri)) referencedUris.add(d.photo_uri);
        if (Array.isArray(d.photos)) {
          for (const p of d.photos) {
            if (p?.uri && isLocalUri(p.uri)) referencedUris.add(p.uri);
          }
        }
        if (typeof d.uri === 'string' && isLocalUri(d.uri)) referencedUris.add(d.uri);
      }
      purgeOrphanedPhotoFiles(referencedUris).catch(() => {});
    }

    setSyncProgress({ done: 0, total: 0 });
    syncingRef.current = false;
  }

  // Keep processSyncQueueRef always pointing at the latest implementation so
  // stale closures (AppState listener, ping interval) call the right version.
  // This is intentionally assigned during render (not in a useEffect) so the
  // ref is always current before any async callback fires.
  processSyncQueueRef.current = processSyncQueue;

  // ── Conflict resolution ────────────────────────────────────────────────────

  const resolveConflict = useCallback(async (conflictId: string, chosenStatus: string) => {
    const conflict = conflicts.find(c => c.id === conflictId);
    if (!conflict) return;

    const now = new Date().toISOString().split('T')[0];
    const history = [
      ...conflict.history,
      {
        id: `r_${Date.now()}`,
        action: 'Conflit résolu',
        author: conflict.author,
        createdAt: now,
        newValue: STATUS_LABELS[chosenStatus] ?? chosenStatus,
      },
    ];

    const { error: resolveErr } = await (supabase as any).from('reserves').update({
      status: chosenStatus,
      history,
      closed_at: chosenStatus === 'closed' ? (conflict.closedAt ?? now) : null,
      closed_by: chosenStatus === 'closed' ? conflict.closedBy ?? null : null,
    }).eq('id', conflict.reserveId);

    if (resolveErr) {
      console.warn('[resolveConflict] server error — conflict kept in queue:', resolveErr.message);
      setSyncStatus('error');
      return;
    }

    const remaining = conflicts.filter(c => c.id !== conflictId);
    setConflicts(remaining);

    if (remaining.length === 0) {
      setSyncStatus('done');
      reloadHandlerRef.current?.();
      setTimeout(() => setSyncStatus('idle'), 4000);
    }
  }, [conflicts]);

  const dismissConflicts = useCallback(() => {
    setConflicts([]);
    setSyncStatus('idle');
  }, []);

  // ── Queue management ───────────────────────────────────────────────────────

  const enqueueOperation = useCallback((op: Omit<QueuedOperation, 'id' | 'queuedAt'>) => {
    const newOp: QueuedOperation = {
      ...op,
      id: genQueueId(),
      queuedAt: new Date().toISOString(),
    };
    setQueue(prev => {
      const updated = [...prev, newOp];
      saveQueue(updated);
      return updated;
    });
  }, [saveQueue]);

  const clearQueue = useCallback(async () => {
    setQueue([]);
    try { await AsyncStorage.removeItem(offlineQueueKey); } catch {}
    try { await AsyncStorage.removeItem(OFFLINE_QUEUE_PREFIX + 'anon'); } catch {}
  }, [offlineQueueKey]);

  const registerReloadHandler = useCallback((fn: () => void) => {
    reloadHandlerRef.current = fn;
  }, []);

  return (
    <NetworkContext.Provider value={{
      isOnline,
      queue,
      queueCount: queue.length,
      queueLoaded,
      syncStatus,
      syncProgress,
      conflicts,
      enqueueOperation,
      resolveConflict,
      dismissConflicts,
      registerReloadHandler,
      clearQueue,
      retrySync: processSyncQueue,
    }}>
      {children}
    </NetworkContext.Provider>
  );
}
