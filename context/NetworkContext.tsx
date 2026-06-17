import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback,
} from 'react';
import { Platform, AppState, AppStateStatus, InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured, resetAuthLock, SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase';
import { isLocalUri, uploadLocalPhotosInPayload, purgeOrphanedPhotoFiles } from '@/lib/storage';
import { getSupabaseRestAccessToken, supabaseRestMutation, supabaseRestRpc, supabaseRestSelect } from '@/lib/supabaseRest';
import { forceRefreshSession, getSessionFromStorage } from '@/lib/offlineCache';
import { normalizeVisitePayloadForSupabase } from '@/lib/mappers';
import { useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/queryClient';
import { triggerMessagePush, triggerReserveCreatedPush } from '@/lib/push/client';
import type { Comment } from '@/constants/types';
import {
  applyReservePatchOperation,
  buildRequestHash,
  firstReserveMutationResult,
  isReserveMutationRpcUnavailable,
  newOperationId,
} from '@/lib/reserveOutbox';
import i18n from '@/lib/i18n';

const OFFLINE_QUEUE_PREFIX = 'buildtrack_offline_queue_v3_';
const OFFLINE_QUEUE_BACKUP_PREFIX = 'buildtrack_offline_queue_backup_v1_';

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
 * A comment-level delta for task comment mutations.
 *
 * Stored in the queue instead of a full `comments` array snapshot so the sync
 * engine can fetch the server state and apply each delta by comment ID — making
 * comment ops safe in the face of concurrent writes from other devices.
 *
 * - `add`    : insert `comment` if its `id` is not already in the server array.
 * - `edit`   : find the comment by `commentId`, update `content` and `editedAt`.
 * - `delete` : remove the comment by `commentId`.
 */
export interface CommentPatch {
  action: 'add' | 'edit' | 'delete';
  /** Full comment object — required for `add`. */
  comment?: Comment;
  /** Target comment ID — required for `edit` and `delete`. */
  commentId?: string;
  /** New text — required for `edit`. */
  newContent?: string;
  /** ISO timestamp — set for `edit`. */
  editedAt?: string;
}

export interface PhotoPatch {
  action: 'upsert' | 'delete';
  /** Photos to merge by ID into the reserve gallery. */
  photos?: any[];
  /** Legacy first-photo field kept in sync with the gallery. */
  photoUri?: string | null;
  /** Photo IDs to remove when action === 'delete'. */
  photoIds?: string[];
}

/**
 * A single queued offline mutation.
 *
 * Generic operations: table + op + filter + data → replayed verbatim against Supabase.
 * Status-change operations also carry a conflictCheck so we can detect concurrent edits.
 * Comment/photo operations carry patches so each delta is merged server-side by ID.
 */
export interface QueuedOperation {
  id: string;
  queuedAt: string;
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  filter?: { column: string; value: string };
  data?: Record<string, any>;
  /** Present for atomic Postgres functions replayed through PostgREST RPC. */
  rpc?: { fn: string; args?: Record<string, any> };
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
  /**
   * Present only for task comment mutations (add / edit / delete a single comment).
   * When set, `data` is ignored — the engine fetches the server's `comments` array
   * and applies the patch by comment ID before writing back.
   */
  commentPatch?: CommentPatch;
  /**
   * Present only for reserve photo-only retries. The engine fetches the live
   * server gallery and merges/removes by photo ID instead of overwriting the
   * whole `photos` array with a stale offline snapshot.
   */
  photoPatch?: PhotoPatch;
  /** Last server error captured during a failed sync attempt (set by processSyncQueue). */
  lastError?: string;
  /** Number of failed sync attempts. */
  attemptCount?: number;
  /** Server row version observed when the user made this mutation. */
  baseVersion?: number | null;
  /** Terminal failures stay visible but are not replayed automatically. */
  terminal?: boolean;
  terminalStatus?: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'done' | 'error';

interface NetworkContextValue {
  isOnline: boolean;
  queue: QueuedOperation[];
  queueCount: number;
  /**
   * Number of queued operations that have failed ≥ 3 times and are considered
   * "stuck" — they need manual attention (retry or clear) in Settings.
   */
  stuckCount: number;
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
  stuckCount: 0,
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
  return newOperationId();
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
const OFFLINE_CONFIRMATION_FAILURES = 2;

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

async function checkInternetReachable(): Promise<boolean> {
  for (const url of PING_URLS) {
    try {
      const res = await withTimeoutMs(fetch(url, { method: 'GET', cache: 'no-cache' }), 8000);
      if (res.ok || res.status === 204 || res.status === 404) return true;
    } catch {}
  }
  return false;
}

async function hasUsableStoredSession(): Promise<boolean> {
  try {
    const cached = await getSessionFromStorage();
    if (!cached?.access_token || typeof cached.expires_at !== 'number') return false;
    return cached.expires_at - 30 > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function checkSupabaseReachable(): Promise<boolean> {
  if (!isSupabaseConfigured || !SUPABASE_URL || !SUPABASE_KEY) return true;
  try {
    const res = await withTimeoutMs(fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }), 12000);
    // Any HTTP response means DNS/TLS/server routing worked. Auth/RLS failures
    // are not offline signals; live queries should still be allowed to run and
    // report their own typed errors.
    return true;
  } catch {
    return false;
  }
}

async function checkAppOnline(navigatorOnline = true): Promise<boolean> {
  if (!navigatorOnline) return false;
  if (isSupabaseConfigured) {
    if (await checkSupabaseReachable()) return true;
    if (await checkInternetReachable()) return true;
    // React Native probes can false-negative on cold DNS/TLS or emulator
    // network stalls. A still-valid persisted JWT means the app can safely try
    // live Supabase queries; failed writes still fall back into the outbox.
    return hasUsableStoredSession();
  }
  if (Platform.OS !== 'web') {
    return checkInternetReachable();
  }
  return true;
}

async function healSupabaseSessionAfterWake(longSleep: boolean): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try { resetAuthLock(); } catch {}
  try { (supabase as any).auth?.startAutoRefresh?.(); } catch {}

  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const { data } = await withTimeoutMs(
      (supabase as any).auth.getSession(),
      longSleep ? 5000 : 3000,
    ) as any;
    const session = data?.session;
    if (session?.access_token && (!session.expires_at || session.expires_at - 30 > nowSec)) {
      return true;
    }
  } catch {}

  try {
    const { data } = await withTimeoutMs(
      (supabase as any).auth.refreshSession(),
      longSleep ? 8000 : 5000,
    ) as any;
    const session = data?.session;
    if (session?.access_token) return true;
  } catch (err) {
    console.log('[wake] refreshSession failed:', (err as any)?.message ?? err);
  }

  try {
    const cached = await getSessionFromStorage();
    if (cached?.access_token && typeof cached.expires_at === 'number' && cached.expires_at - 30 > nowSec) {
      return true;
    }
    const token = await forceRefreshSession();
    return !!token;
  } catch {
    return false;
  }
}

async function refetchActiveQueries(reason: string): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      await new Promise<void>(resolve => {
        InteractionManager.runAfterInteractions(() => resolve());
      });
    }
    await queryClient.invalidateQueries({ refetchType: 'none' });
    await queryClient.refetchQueries({ type: 'active' });
  } catch (err) {
    console.warn(`[query] foreground refetch failed (${reason}):`, (err as any)?.message ?? err);
  }
}

const QUEUE_ORG_SCOPED_INSERT_TABLES = new Set(['reserves', 'photos', 'site_plans', 'chantiers']);

const CRITICAL_SOFT_DELETE_RPCS: Record<string, { fn: string; idArg: string; reason: string }> = {
  photos: { fn: 'soft_delete_photo', idArg: 'p_photo_id', reason: 'offline_queue_soft_delete_photo' },
  site_plans: { fn: 'soft_delete_site_plan', idArg: 'p_plan_id', reason: 'offline_queue_soft_delete_site_plan' },
  chantiers: { fn: 'soft_delete_chantier', idArg: 'p_chantier_id', reason: 'offline_queue_soft_delete_chantier' },
};

function hydrateQueuedOrganizationId(
  table: string,
  data: Record<string, any> | null | undefined,
  organizationId: string | null | undefined,
  role: string | null | undefined,
): Record<string, any> | undefined {
  if (!data || !organizationId || !QUEUE_ORG_SCOPED_INSERT_TABLES.has(table)) return data ?? undefined;

  const currentOrg = data.organization_id;
  if (!currentOrg || (role !== 'super_admin' && currentOrg !== organizationId)) {
    return { ...data, organization_id: organizationId };
  }

  return data;
}

function reservePhotoRowsForRpcPayload(source: Record<string, any>, author?: string | null): any[] {
  const rows = new Map<string, any>();
  const reserveId = String(source.id ?? '');
  const location = [source.building, source.level, source.zone].filter(Boolean).join(' - ');
  const takenAt = source.created_at ?? new Date().toISOString().split('T')[0];
  const takenBy = author || 'BuildTrack';

  const add = (photo: any, index: number) => {
    const uri = typeof photo?.uri === 'string' ? photo.uri : '';
    if (!uri) return;
    const id = String(photo?.id ?? `${reserveId}-photo-${index + 1}`);
    rows.set(id, {
      id,
      uri,
      comment: photo?.comment ?? `Photo reserve ${reserveId}`,
      location: photo?.location ?? location,
      taken_at: photo?.takenAt ?? photo?.taken_at ?? takenAt,
      taken_by: photo?.takenBy ?? photo?.taken_by ?? takenBy,
      color_code: photo?.colorCode ?? photo?.color_code ?? (source.kind === 'observation' ? '#0EA5E9' : '#EF4444'),
    });
  };

  if (typeof source.photo_uri === 'string' && source.photo_uri) {
    add({ id: `${reserveId}-cover`, uri: source.photo_uri }, 0);
  }
  if (Array.isArray(source.photos)) {
    source.photos.forEach(add);
  }

  return Array.from(rows.values());
}

function queueReplayPriority(op: QueuedOperation): number {
  if (op.op === 'rpc' && op.rpc?.fn === 'create_reserve_with_photos') return 10;
  if (op.op === 'rpc' && op.rpc?.fn === 'create_site_plan_revision_with_reserve_migration') return 15;
  if (op.table === 'reserves' && op.op === 'insert') return 10;
  if (op.table === 'photos' && op.op === 'insert') return 20;
  return 30;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const offlineQueueKey = OFFLINE_QUEUE_PREFIX + (userId ?? 'anon');
  const offlineQueueBackupKey = OFFLINE_QUEUE_BACKUP_PREFIX + (userId ?? 'anon');
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
  const wakeInFlightRef = useRef(false);
  const wakeAgainRef = useRef(false);
  const offlineProbeFailuresRef = useRef(0);

  // ── Stable refs so any closure (including stale ones in AppState) can always
  // access the CURRENT queue and the CURRENT processSyncQueue implementation.
  // This is the fix for the "stale closure" bug where AppState and ping
  // handlers captured the initial empty queue and never saw later updates.
  const queueRef = useRef<QueuedOperation[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  const isOnlineRef = useRef(true);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  const applyOnlineReading = useCallback((online: boolean) => {
    if (online) {
      offlineProbeFailuresRef.current = 0;
      isOnlineRef.current = true;
      setIsOnline(true);
      return true;
    }

    offlineProbeFailuresRef.current += 1;
    if (offlineProbeFailuresRef.current >= OFFLINE_CONFIRMATION_FAILURES) {
      isOnlineRef.current = false;
      setIsOnline(false);
      return false;
    }

    return isOnlineRef.current;
  }, []);

  // processSyncQueueRef is always updated to point to the latest version of
  // processSyncQueue on every render, so stale closures can safely call
  // processSyncQueueRef.current() and get the correct behaviour.
  const processSyncQueueRef = useRef<() => Promise<void>>(async () => {});

  // Throttle: track when the last sync attempt started so ping-driven retries
  // don't hammer the server (max one attempt per 20 seconds).
  const lastSyncAttemptRef = useRef<number>(0);

  // ── Queue persistence ──────────────────────────────────────────────────────

  const backupQueue = useCallback(async (q: QueuedOperation[], reason: string) => {
    if (q.length === 0) return;
    try {
      await AsyncStorage.setItem(
        offlineQueueBackupKey,
        JSON.stringify({ backedUpAt: new Date().toISOString(), reason, queue: q }),
      );
    } catch (err) {
      console.warn('[queue] failed to write recovery backup:', (err as any)?.message ?? err);
    }
  }, [offlineQueueBackupKey]);

  const saveQueue = useCallback(async (q: QueuedOperation[]) => {
    try {
      await AsyncStorage.setItem(offlineQueueKey, JSON.stringify(q));
    } catch (err) {
      console.warn('[queue] failed to persist offline queue:', (err as any)?.message ?? err);
    }
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
      void refetchActiveQueries('queue-loaded');
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
      const refresh = async () => {
        const current = typeof navigator !== 'undefined' ? navigator.onLine : true;
        setIsOnline(await checkAppOnline(current));
      };
      const up = () => { refresh(); };
      const dn = () => setIsOnline(false);
      refresh();
      window.addEventListener('online', up);
      window.addEventListener('offline', dn);
      const interval = setInterval(refresh, 10_000);
      return () => {
        window.removeEventListener('online', up);
        window.removeEventListener('offline', dn);
        clearInterval(interval);
      };
    }

    const check = async () => {
      const online = applyOnlineReading(await checkAppOnline());

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
  }, [applyOnlineReading]);

  // ── Trigger sync + refetch when coming back online ─────────────────────────

  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      if (isSupabaseConfigured) {
        if (queueRef.current.length > 0) processSyncQueueRef.current();
        void refetchActiveQueries('online-transition');
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

    const runWakeUpPass = async () => {
      const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
      const longSleep = sleptMs > 30_000; // more than 30 s in background

      // ── 1. Heal the Supabase auth client ──────────────────────────────────
      // After a long sleep the access token is likely expired and/or the
      // internal auth lock is frozen. Calling refreshSession() with a short
      // timeout forces a new token AND breaks any stuck lock (our safeLock
      // implementation in lib/supabase.ts will time out and release the lock).
      // We heal even after a short return because Android can freeze JS while
      // Supabase is mid-refresh. The helper uses short timeouts plus an
      // AsyncStorage/raw-refresh fallback, so this never blocks forever.
      const sessionHealthy = await healSupabaseSessionAfterWake(longSleep);

      // ── 2. Reconnect the Realtime WebSocket ───────────────────────────────
      try { (supabase as any).realtime?.disconnect?.(); } catch {}
      try { (supabase as any).realtime?.connect?.(); } catch {}

      // ── 3. Re-ping to get a fresh connectivity reading ───────────────────
      // We can't rely on the stale isOnline state: if the network was already
      // active before sleep, isOnline is still true and the change-based effect
      // won't fire. We ping explicitly and act on the result.
      const online = applyOnlineReading(sessionHealthy || await checkAppOnline());

      // ── 4. Refresh active screens immediately ────────────────────────────
      // invalidateQueries alone can be lazy. Refetch active queries now so
      // another user's changes appear without needing a full app restart.
      await refetchActiveQueries('foreground');
      try { reloadHandlerRef.current?.(); } catch {}

      // ── 5. Trigger sync if we have pending operations ─────────────────────
      if (online && queueRef.current.length > 0 && !syncingRef.current) {
        await processSyncQueueRef.current();
        await refetchActiveQueries('foreground-after-queue-sync');
        try { reloadHandlerRef.current?.(); } catch {}
      }

      // Some devices report `active` before the network stack has fully
      // resumed. A short follow-up fetch catches the second-wave readiness
      // without requiring the user to kill and relaunch the app.
      setTimeout(() => {
        if (isOnlineRef.current) {
          void refetchActiveQueries('foreground-follow-up');
          try { reloadHandlerRef.current?.(); } catch {}
        }
      }, 2500);
    };

    const wakeUp = async () => {
      if (wakeInFlightRef.current) {
        wakeAgainRef.current = true;
        return;
      }
      wakeInFlightRef.current = true;
      try {
        do {
          wakeAgainRef.current = false;
          await runWakeUpPass();
        } while (wakeAgainRef.current);
      } finally {
        wakeInFlightRef.current = false;
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
    try { await getSupabaseRestAccessToken(); } catch {}

    const pendingConflicts: StatusConflict[] = [];
    const failedOps: QueuedOperation[] = [];
    // Snapshot the queue from the ref (always current, not a stale closure)
    const currentQueue = [...queueRef.current].sort((a, b) => {
      const priorityDiff = queueReplayPriority(a) - queueReplayPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return a.queuedAt.localeCompare(b.queuedAt);
    });
    setSyncProgress({ done: 0, total: currentQueue.length });

    // Helper: re-queue an op while attaching the latest error message and
    // bumping its attempt counter so the user can see in the UI why it stays
    // stuck after each retry.
    const fail = (op: QueuedOperation, err: any, options?: { terminalStatus?: string }) => {
      let msg: string;
      if (!err) msg = i18n.t('networkQueue.unknownError');
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
        terminal: Boolean(options?.terminalStatus) || op.terminal,
        terminalStatus: options?.terminalStatus ?? op.terminalStatus,
      });
    };

    let processed = 0;
    for (const op of currentQueue) {
      let retryOpForCatch: QueuedOperation = op;
      try {
        if (op.terminal) {
          failedOps.push(op);
          continue;
        }
        // ── Status-change conflict detection ───────────────────────────────
        if (op.op === 'rpc') {
          if (!op.rpc?.fn) {
            fail(op, i18n.t('networkQueue.missingRpc'));
            continue;
          }
          let args = { ...(op.rpc.args ?? {}) };
          let retryRpcOp = op;

          if (op.rpc.fn === 'create_reserve_with_photos') {
            const rawReserve = hydrateQueuedOrganizationId(
              'reserves',
              (args.p_reserve ?? op.data) as Record<string, any> | undefined,
              user?.organizationId ?? null,
              user?.role ?? null,
            );
            if (!rawReserve?.id) {
              fail(op, i18n.t('networkQueue.createReserveMissingPayload'));
              continue;
            }
            if (rawReserve.deadline === 'â€”' || rawReserve.deadline === '') {
              rawReserve.deadline = null;
            }
            const prep = await uploadLocalPhotosInPayload('reserves', rawReserve);
            if (!prep.allOk) {
              fail(op, prep.uploadErrors?.join(' | ') || i18n.t('networkQueue.uploadReservePhotosFailed'));
              continue;
            }
            const preparedReserve = prep.data ?? rawReserve;
            args = {
              ...args,
              p_reserve: preparedReserve,
              p_photo_rows: reservePhotoRowsForRpcPayload(
                preparedReserve,
                user?.name ?? user?.email ?? null,
              ),
            };
            retryRpcOp = { ...op, data: preparedReserve, rpc: { ...op.rpc, args } };
          } else if (op.rpc.fn === 'create_site_plan_revision_with_reserve_migration') {
            const rawPlan = hydrateQueuedOrganizationId(
              'site_plans',
              (args.p_new_plan ?? op.data) as Record<string, any> | undefined,
              user?.organizationId ?? null,
              user?.role ?? null,
            );
            if (!args.p_parent_plan_id || !rawPlan?.id) {
              fail(op, 'RPC create_site_plan_revision_with_reserve_migration refusee: plan parent ou nouvelle revision manquant.');
              continue;
            }
            const prep = await uploadLocalPhotosInPayload('site_plans', rawPlan);
            if (!prep.allOk) {
              fail(op, prep.uploadErrors?.join(' | ') || 'Echec upload fichier plan avant creation revision controlee.');
              continue;
            }
            const preparedPlan = prep.data ?? rawPlan;
            args = { ...args, p_new_plan: preparedPlan };
            retryRpcOp = { ...op, data: preparedPlan, rpc: { ...op.rpc, args } };
          } else if (op.rpc.fn === 'replace_site_plan_file_safely') {
            const rawPatch = (args.p_patch ?? op.data) as Record<string, any> | undefined;
            if (!args.p_plan_id || !rawPatch) {
              fail(op, i18n.t('networkQueue.replacePlanMissingPatch'));
              continue;
            }
            const prep = await uploadLocalPhotosInPayload('site_plans', rawPatch);
            if (!prep.allOk) {
              fail(op, prep.uploadErrors?.join(' | ') || i18n.t('networkQueue.uploadPlanFileFailed'));
              continue;
            }
            const preparedPatch = { ...(prep.data ?? rawPatch) };
            delete preparedPatch.__replace_file_safely;
            args = { ...args, p_patch: preparedPatch };
            retryRpcOp = { ...op, data: preparedPatch, rpc: { ...op.rpc, args } };
          } else if (op.rpc.fn === 'append_reserve_status_event') {
            const event = args.p_event ?? op.data;
            if (!event?.reserve_id || !event?.to_status) {
              fail(op, i18n.t('networkQueue.reserveStatusEventMissing'));
              continue;
            }
            args = {
              ...args,
              p_operation_id: args.p_operation_id ?? op.id,
              p_request_hash: args.p_request_hash ?? await buildRequestHash({
                fn: 'append_reserve_status_event',
                event,
              }),
              p_event: event,
            };
            retryRpcOp = { ...op, rpc: { ...op.rpc, args } };
          }

          const { data: rpcData, error } = await supabaseRestRpc(op.rpc.fn, args);
          if (error && op.rpc.fn === 'append_reserve_status_event' && isReserveMutationRpcUnavailable(error)) {
            if (op.filter?.column === 'id' && op.data) {
              const { error: fallbackErr } = await supabaseRestMutation(
                'reserves',
                'update',
                op.data,
                op.filter,
              );
              if (fallbackErr) fail({ ...retryRpcOp, data: op.data }, fallbackErr);
            } else {
              fail(retryRpcOp, error);
            }
          } else if (error) fail(retryRpcOp, error);
          else if (op.rpc.fn === 'append_reserve_status_event') {
            const outcome = firstReserveMutationResult(rpcData);
            if (outcome && outcome.status !== 'ok') {
              const terminal = ['deleted', 'forbidden', 'not_found', 'duplicate_operation_mismatch', 'invalid_payload'].includes(outcome.status);
              fail(retryRpcOp, outcome.message ?? outcome.status, terminal ? { terminalStatus: outcome.status } : undefined);
            }
          }
          else if (op.rpc.fn === 'create_reserve_with_photos' && args.p_reserve?.id) {
            triggerReserveCreatedPush(String(args.p_reserve.id));
          }
          continue;
        }

        if (op.conflictCheck) {
          const { entityId, previousStatus, newStatus, author, history, closedAt, closedBy } = op.conflictCheck;

          const { data: serverRows, error: fetchErr } = await supabaseRestSelect<any>(
            'reserves',
            'status,title',
            { column: 'id', value: entityId },
          );
          const serverData = serverRows?.[0] ?? null;

          if (fetchErr) { fail(op, fetchErr); continue; }
          if (!serverData) continue;

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

          const { error: applyErr } = await supabaseRestMutation('reserves', 'update', {
            status: newStatus,
            history,
            closed_at: closedAt ?? null,
            closed_by: closedBy ?? null,
          }, { column: 'id', value: entityId });

          if (applyErr) fail(op, applyErr);
          continue;
        }

        // ── Comment patch (CRDT-lite merge by comment ID) ─────────────────
        // Replaces the old "store full comments array" approach.  Each comment
        // op carries only the delta (add/edit/delete a single comment). The
        // engine fetches the live server array and merges by ID so concurrent
        // writes from other devices are never silently overwritten.
        if (op.commentPatch && (op.table === 'tasks' || op.table === 'reserves') && op.filter?.column === 'id') {
          const rowId = op.filter.value;
          const patch  = op.commentPatch;

          const { data: taskRows, error: fetchErr } = await supabaseRestSelect<any>(
            op.table,
            'comments',
            { column: 'id', value: rowId },
          );
          const serverTask = taskRows?.[0] ?? null;

          if (fetchErr) { fail(op, fetchErr); continue; }

          // Row is gone — treat as success (nothing to patch)
          if (!serverTask) continue;

          const serverComments: Comment[] = Array.isArray(serverTask.comments)
            ? serverTask.comments
            : [];

          let merged: Comment[];
          if (patch.action === 'add' && patch.comment) {
            // Idempotent: skip if the comment ID is already present
            merged = serverComments.some(c => c.id === patch.comment!.id)
              ? serverComments
              : [...serverComments, patch.comment];
          } else if (patch.action === 'edit' && patch.commentId) {
            merged = serverComments.map(c =>
              c.id === patch.commentId
                ? { ...c, content: patch.newContent ?? c.content, editedAt: patch.editedAt }
                : c
            );
          } else if (patch.action === 'delete' && patch.commentId) {
            merged = serverComments.filter(c => c.id !== patch.commentId);
          } else {
            // Malformed patch — drop silently
            console.warn('[queue] commentPatch malformed, dropping:', JSON.stringify(patch));
            continue;
          }

          const { error: writeErr } = await supabaseRestMutation(
            op.table,
            'update',
            { comments: merged },
            { column: 'id', value: rowId },
          );

          if (writeErr) fail(op, writeErr);
          continue;
        }

        // ── Upload local photos / files before replaying insert/update ───────
        let data = op.data ? { ...op.data } : op.data;
        data = hydrateQueuedOrganizationId(op.table, data, user?.organizationId ?? null, user?.role ?? null);
        let retryData = data;
        let deferredPhotoPatch: QueuedOperation | null = null;
        if (data) {
          if (op.table === 'visites') {
            data = normalizeVisitePayloadForSupabase(data);
            retryData = data;
          }
          if (op.table === 'reserves') {
            if (data.deadline === '—' || data.deadline === '') {
              data.deadline = null;
            }
          }
          // ── Logs détaillés pour site_plans ──────────────────────────────
          if (op.table === 'site_plans') {
            const hasLocalUri = typeof data.uri === 'string' && data.uri.startsWith('file://');
            console.log(`[SYNC:site_plans] ── op ${op.id} (tentative #${(op.attemptCount ?? 0) + 1}) ──`);
            console.log(`[SYNC:site_plans] op     : ${op.op}`);
            console.log(`[SYNC:site_plans] name   : ${data.name ?? '(sans nom)'}`);
            console.log(`[SYNC:site_plans] uri    : ${typeof data.uri === 'string' ? (data.uri.slice(0, 100)) : '(absent)'}`);
            console.log(`[SYNC:site_plans] uri locale : ${hasLocalUri ? 'OUI → upload requis' : 'NON (déjà remote ou null)'}`);
          }
          try {
            const prep = await uploadLocalPhotosInPayload(op.table, data);
            if (op.table === 'site_plans') {
              console.log(`[SYNC:site_plans] upload résultat — allOk:${prep.allOk} hadLocal:${prep.hadLocal}`);
              if (!prep.allOk) {
                console.error(`[SYNC:site_plans] ECHEC upload — erreurs: ${(prep.uploadErrors ?? []).join(' | ')}`);
              }
              if (prep.data?.uri && prep.data.uri !== op.data?.uri) {
                console.log(`[SYNC:site_plans] uri transformée → ${String(prep.data.uri).slice(0, 100)}`);
              }
            }
            if (prep.data === null && prep.allOk && op.table === 'photos') {
              console.warn(`[queue] dropping photos op ${op.id}: local file missing on disk`);
              processed += 1;
              setSyncProgress({ done: processed, total: currentQueue.length });
              continue;
            }
            if (prep.data) {
              data = prep.data;
              retryData = prep.data;
            }
            if (!prep.allOk) {
              const errDetail = prep.uploadErrors?.join(' | ') ?? '';
              if (op.photoPatch) {
                fail(op, errDetail || 'Échec upload photo. Nouvelle tentative au prochain passage.');
                continue;
              }

              if (op.table === 'reserves') {
                // ── Partial photo failure for a reserve ───────────────────────
                // The photo upload failed but the reserve's text data (title,
                // description, status, lot, company, etc.) must not be held
                // hostage by it. Strategy:
                //   1. Strip the local photo URIs from the payload.
                //   2. Proceed with the insert/update so the reserve is saved.
                //   3. Re-queue a photo-only merge after the reserve row succeeds.
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
                retryData = { ...safeData };
                if (Object.prototype.hasOwnProperty.call(pendingPhotoData, 'photo_uri')) {
                  retryData.photo_uri = pendingPhotoData.photo_uri;
                }
                if (Array.isArray(pendingPhotoData.photos)) {
                  retryData.photos = [
                    ...(Array.isArray(safeData.photos) ? safeData.photos : []),
                    ...pendingPhotoData.photos,
                  ];
                }

                // Defer the photo-only retry until the generic reserve op succeeds.
                // Otherwise an INSERT followed by a photo UPDATE can replay in the
                // wrong order and the photo patch will hit a row that does not exist.
                const reserveId = safeData.id ?? op.filter?.value;
                if (Object.keys(pendingPhotoData).length > 0 && reserveId) {
                  console.warn(
                    `[queue] reserve ${reserveId}: syncing text data without photos. Upload errors: ${errDetail}`,
                  );
                  deferredPhotoPatch = {
                    id: genQueueId(),
                    queuedAt: new Date().toISOString(),
                    table: 'reserves',
                    op: 'update',
                    filter: { column: 'id', value: reserveId },
                    data: pendingPhotoData,
                    photoPatch: {
                      action: 'upsert',
                      photos: Array.isArray(pendingPhotoData.photos) ? pendingPhotoData.photos : undefined,
                      photoUri: typeof pendingPhotoData.photo_uri === 'string' ? pendingPhotoData.photo_uri : null,
                    },
                    lastError: errDetail || 'Échec upload photo. Nouvelle tentative au prochain passage.',
                    attemptCount: (op.attemptCount ?? 0) + 1,
                  };
                }
                // Fall through to the generic replay below with safeData
              } else {
                fail(op, errDetail || 'Échec upload de fichiers locaux (photos/plans). Nouvelle tentative au prochain passage.');
                continue;
              }
            }
          } catch (e) {
            fail(op, e);
            continue;
          }
        }
        retryOpForCatch = retryData ? { ...op, data: retryData } : op;

        // ── Reserve photo patch (merge by photo ID) ─────────────────────────
        // A photo-only retry must not write a stale `photos` snapshot. Fetch the
        // live gallery, merge/delete by photo ID, then write the merged result.
        if (op.photoPatch && op.table === 'reserves' && op.filter?.column === 'id') {
          const reserveId = op.filter.value;
          const { data: reserveRows, error: fetchErr } = await supabaseRestSelect<any>(
            'reserves',
            'photos,photo_uri',
            { column: 'id', value: reserveId },
          );
          if (fetchErr) { fail(op, fetchErr); continue; }

          const serverReserve = reserveRows?.[0] ?? null;
          if (!serverReserve) continue;

          let mergedPhotos: any[] = Array.isArray(serverReserve.photos)
            ? [...serverReserve.photos]
            : [];

          if (op.photoPatch.action === 'delete') {
            const ids = new Set((op.photoPatch.photoIds ?? []).map(String));
            mergedPhotos = mergedPhotos.filter((p: any) => !ids.has(String(p?.id)));
          } else {
            const incomingPhotos = Array.isArray(data?.photos)
              ? data.photos
              : (op.photoPatch.photos ?? []);
            const byId = new Map<string, any>();
            for (const photo of mergedPhotos) {
              if (photo?.id) byId.set(String(photo.id), photo);
            }
            for (const photo of incomingPhotos) {
              if (photo?.id) byId.set(String(photo.id), photo);
            }
            mergedPhotos = Array.from(byId.values());
          }

          const incomingPhotoUri =
            typeof data?.photo_uri === 'string'
              ? data.photo_uri
              : typeof op.photoPatch.photoUri === 'string'
              ? op.photoPatch.photoUri
              : undefined;
          const nextPhotoUri = op.photoPatch.action === 'delete' && mergedPhotos.length === 0
            ? null
            : incomingPhotoUri ?? mergedPhotos[0]?.uri ?? serverReserve.photo_uri ?? null;
          const nextPayload = {
            photos: mergedPhotos.length > 0 ? mergedPhotos : null,
            photo_uri: nextPhotoUri,
          };
          const { error: writeErr } = await supabaseRestMutation(
            'reserves',
            'update',
            nextPayload,
            { column: 'id', value: reserveId },
          );
          if (writeErr) fail({ ...op, data: nextPayload }, writeErr);
          continue;
        }

        // ── Generic table/op replay ────────────────────────────────────────
        let result: { error: any; data?: any[] | null };

        if (op.table === 'site_plans') {
          console.log(`[SYNC:site_plans] ── INSERT Supabase (table site_plans) ──`);
          console.log(`[SYNC:site_plans] payload uri   : ${typeof data?.uri === 'string' ? data.uri.slice(0, 100) : '(null)'}`);
          console.log(`[SYNC:site_plans] payload name  : ${data?.name ?? '(absent)'}`);
          console.log(`[SYNC:site_plans] payload org_id: ${data?.organization_id ?? '(absent)'}`);
        }

        if (op.op === 'insert') {
          result = await supabaseRestMutation(op.table, 'insert', data!);
          if (op.table === 'site_plans') {
            if (result.error) {
              console.error(`[SYNC:site_plans] ECHEC INSERT — code:${result.error.code} msg:${result.error.message} details:${result.error.details ?? ''} hint:${result.error.hint ?? ''}`);
            } else {
              console.log(`[SYNC:site_plans] SUCCÈS INSERT ✓`);
            }
          }
          if (result.error?.code === '23505') result = { error: null };
        } else if (op.op === 'upsert') {
          result = await supabaseRestMutation(op.table, 'upsert', data!);
        } else if (op.op === 'update') {
          if (!op.filter) {
            fail(op, `UPDATE ${op.table} refusé: filtre manquant.`);
            continue;
          }
          if (op.table === 'site_plans' && data?.__replace_file_safely && op.filter.column === 'id') {
            const patch = { ...data };
            delete patch.__replace_file_safely;
            result = await supabaseRestRpc('replace_site_plan_file_safely', {
              p_plan_id: op.filter.value,
              p_patch: patch,
              p_reason: 'offline_queue_replace_site_plan_file',
            });
          } else if (op.table === 'reserves' && op.filter.column === 'id' && typeof op.baseVersion === 'number') {
            const rpcResult = await applyReservePatchOperation({
              operationId: op.id,
              reserveId: String(op.filter.value),
              baseVersion: op.baseVersion,
              patch: data!,
            });
            const outcome = firstReserveMutationResult(rpcResult.data);
            if (rpcResult.error && isReserveMutationRpcUnavailable(rpcResult.error)) {
              result = await supabaseRestMutation(op.table, 'update', data!, op.filter);
            } else if (rpcResult.error) {
              result = rpcResult;
            } else if (!outcome || outcome.status === 'ok') {
              result = { error: null, data: outcome ? [outcome] : null };
            } else {
              const terminal = ['deleted', 'forbidden', 'not_found', 'duplicate_operation_mismatch', 'invalid_payload'].includes(outcome.status);
              fail(retryOpForCatch, outcome.message ?? outcome.status, terminal ? { terminalStatus: outcome.status } : undefined);
              continue;
            }
          } else {
            result = await supabaseRestMutation(op.table, 'update', data!, op.filter);
          }
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            if (op.filter?.column === 'id') {
              try {
                const { data: exists, error: existsErr } = await supabaseRestSelect(
                  op.table,
                  'id',
                  { column: 'id', value: op.filter.value },
                );
                if (!existsErr && !exists?.[0]) {
                  continue;
                }
              } catch {}
            }
            fail(retryOpForCatch, `UPDATE sur ${op.table} a affecté 0 ligne. Probablement bloqué par une policy RLS, ou l'élément ne vous appartient plus.`);
            continue;
          }
        } else if (op.op === 'delete') {
          if (!op.filter) {
            fail(op, `DELETE ${op.table} refusé: filtre manquant.`);
            continue;
          }
          const criticalDeleteRpc = CRITICAL_SOFT_DELETE_RPCS[op.table];
          if (criticalDeleteRpc && op.filter.column === 'id') {
            result = await supabaseRestRpc(criticalDeleteRpc.fn, {
              [criticalDeleteRpc.idArg]: op.filter.value,
              p_reason: op.data?.deleted_reason ?? criticalDeleteRpc.reason,
            });
          } else {
          if (op.table === 'chantiers' && op.filter.column === 'id') {
            const { data: linkedReserves, error: linkedErr } = await supabaseRestSelect(
              'reserves',
              'id',
              { column: 'chantier_id', value: op.filter.value },
            );
            if (linkedErr) {
              fail(op, linkedErr);
              continue;
            }
            if (linkedReserves?.[0]) {
              fail(op, i18n.t('networkQueue.deleteProjectHasReserves'));
              continue;
            }
          }
          if (op.table === 'reserves') {
            const softDeletePayload = {
              deleted_at: op.data?.deleted_at ?? new Date().toISOString(),
              deleted_by: op.data?.deleted_by ?? user?.name ?? user?.email ?? 'Sync offline',
              ...(Array.isArray(op.data?.history) ? { history: op.data.history } : {}),
            };
            result = await supabaseRestMutation(op.table, 'update', softDeletePayload, op.filter);
          } else {
            result = await supabaseRestMutation(op.table, 'delete', undefined, op.filter);
          }
          }
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            if (op.filter?.column === 'id') {
              try {
                const { data: exists, error: existsErr } = await supabaseRestSelect(
                  op.table,
                  'id',
                  { column: 'id', value: op.filter.value },
                );
                if (!existsErr && !exists?.[0]) {
                  // Row is already gone server-side — consider the delete successful
                  continue;
                }
              } catch {}
            }
            fail(op, `DELETE sur ${op.table} bloqué par une policy RLS (0 ligne supprimée).`);
            continue;
          }
        } else {
          fail(op, `Opération inconnue: ${(op as any).op}`);
          continue;
        }

        if (result.error) fail(retryOpForCatch, result.error);
        else {
          if (op.op === 'insert' && op.table === 'messages' && data?.id && data?.channel_id) {
            triggerMessagePush(String(data.id), String(data.channel_id));
          }
          if (op.op === 'insert' && op.table === 'reserves' && data?.id) {
            triggerReserveCreatedPush(String(data.id));
          }
          if (deferredPhotoPatch) failedOps.push(deferredPhotoPatch);
        }
      } catch (e) {
        fail(retryOpForCatch, e);
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

    await backupQueue(currentQueue, 'before-sync-prune');
    setQueue(remaining);
    await saveQueue(remaining);

    await refetchActiveQueries('queue-processed');

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

    const { error: resolveErr } = await supabaseRestMutation('reserves', 'update', {
      status: chosenStatus,
      history,
      closed_at: chosenStatus === 'closed' ? (conflict.closedAt ?? now) : null,
      closed_by: chosenStatus === 'closed' ? conflict.closedBy ?? null : null,
    }, { column: 'id', value: conflict.reserveId });

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
    const allowedOps = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
    if (!allowedOps.has((op as any).op)) {
      console.warn('[queue] operation ignored: op inconnue', (op as any).op, op.table);
      return;
    }
    if ((op.op === 'update' || op.op === 'delete') && !op.filter) {
      console.warn(`[queue] ${op.op} ${op.table} ignored: filtre manquant`);
      return;
    }
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
    await backupQueue(queueRef.current, 'manual-clear');
    setQueue([]);
    try { await AsyncStorage.removeItem(offlineQueueKey); } catch {}
    try { await AsyncStorage.removeItem(OFFLINE_QUEUE_PREFIX + 'anon'); } catch {}
  }, [backupQueue, offlineQueueKey]);

  const registerReloadHandler = useCallback((fn: () => void) => {
    reloadHandlerRef.current = fn;
  }, []);

  return (
    <NetworkContext.Provider value={{
      isOnline,
      queue,
      queueCount: queue.length,
      stuckCount: queue.filter(op => op.terminal || (op.attemptCount ?? 0) >= 3).length,
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
