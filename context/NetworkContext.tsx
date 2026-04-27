import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback,
} from 'react';
import { Platform, AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uploadPhoto, isLocalUri, uploadLocalPhotosInPayload } from '@/lib/storage';
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

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const offlineQueueKey = OFFLINE_QUEUE_PREFIX + (user?.id ?? 'anon');
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [conflicts, setConflicts] = useState<StatusConflict[]>([]);

  const prevOnlineRef = useRef(true);
  const syncingRef = useRef(false);
  const reloadHandlerRef = useRef<(() => void) | null>(null);

  // ── Queue persistence ──────────────────────────────────────────────────────

  const saveQueue = useCallback(async (q: QueuedOperation[]) => {
    try {
      await AsyncStorage.setItem(offlineQueueKey, JSON.stringify(q));
    } catch {}
  }, [offlineQueueKey]);

  const loadQueue = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(offlineQueueKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setQueue(parsed);
      }
    } catch {}
  }, [offlineQueueKey]);

  // ── Network detection ──────────────────────────────────────────────────────

  useEffect(() => {
    loadQueue();

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

    // Native: ping every 10 s for reliable detection in construction environments
    const PING_URLS = [
      'https://clients3.google.com/generate_204',
      'https://connectivitycheck.gstatic.com/generate_204',
    ];

    const check = async () => {
      let online = false;
      for (const url of PING_URLS) {
        try {
          const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
          if (res.ok || res.status === 204) { online = true; break; }
        } catch {}
      }
      setIsOnline(online);
    };

    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, [loadQueue]);

  // ── Trigger sync + refetch when coming back online ─────────────────────────
  //
  // When connectivity is restored we always force a refetch of every React
  // Query so Supabase becomes the source of truth again — the cache may have
  // been showing stale data while we were offline. In addition, any queued
  // mutations are replayed.

  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      if (isSupabaseConfigured) {
        if (queue.length > 0) processSyncQueue();
        // Network just came back — invalidate every cached query so Supabase
        // re-becomes the source of truth.
        queryClient.invalidateQueries();
      }
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  // ── Refetch when the app comes back to the foreground (native) ─────────────
  //
  // React Query's `refetchOnWindowFocus` only fires on web. On iOS / Android
  // we hook into AppState transitions and invalidate all queries when the user
  // returns to the app, so the data shown is whatever Supabase currently has.

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active' && isSupabaseConfigured) {
        queryClient.invalidateQueries();
      }
    });
    return () => sub.remove();
  }, []);

  // ── Sync logic ─────────────────────────────────────────────────────────────

  async function processSyncQueue() {
    if (syncingRef.current || queue.length === 0 || !isSupabaseConfigured) return;
    syncingRef.current = true;
    setSyncStatus('syncing');

    const pendingConflicts: StatusConflict[] = [];
    const failedOps: QueuedOperation[] = [];
    const currentQueue = queue;
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
            // Someone else changed the status while we were offline → conflict
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
            continue; // wait for user resolution
          }

          // No conflict: apply our change
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
        // When the queued operation contains local URIs (offline photos, plan
        // PDFs, etc.), upload them to Supabase Storage first and replace with
        // remote URLs. Delegated to the shared helper used by online writes,
        // so the behaviour stays consistent across both code paths.
        let data = op.data ? { ...op.data } : op.data;
        if (data) {
          if (op.table === 'reserves') {
            // Normalize placeholder values that may break inserts/updates
            if (data.deadline === '—' || data.deadline === '') {
              data.deadline = null;
            }
          }
          try {
            const prep = await uploadLocalPhotosInPayload(op.table, data);
            if (prep.data) data = prep.data;
            if (!prep.allOk) {
              fail(op, 'Échec upload de fichiers locaux (photos/plans). Nouvelle tentative au prochain passage.');
              continue;
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
          // 23505 = unique violation → already exists → treat as success
          if (result.error?.code === '23505') result = { error: null };
        } else if (op.op === 'update') {
          // Use .select() so we can detect UPDATEs that affected 0 rows — that
          // happens when the row was deleted server-side (drop from queue) or
          // when an RLS policy silently blocks the write (re-queue with hint).
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
                  // Row no longer exists → treat as success
                  continue;
                }
              } catch {}
            }
            fail(op, `UPDATE sur ${op.table} a affecté 0 ligne. Probablement bloqué par une policy RLS, ou l'élément ne vous appartient plus.`);
            continue;
          }
        } else {
          // Use .select() so we can detect RLS-blocked DELETEs (error=null but 0 rows)
          const q = (supabase as any).from(op.table).delete().select();
          result = op.filter
            ? await q.eq(op.filter.column, op.filter.value)
            : await q;
          // If DELETE returned 0 rows with no error, it can mean either:
          // - row doesn't exist anymore (success from our POV)
          // - RLS blocked the delete (should be retried)
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            if (op.table === 'reserves' && op.filter?.column === 'id') {
              try {
                const { data: exists, error: existsErr } = await (supabase as any)
                  .from('reserves')
                  .select('id')
                  .eq('id', op.filter.value)
                  .maybeSingle();
                // If row doesn't exist, treat delete as success (drop from queue)
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

    if (pendingConflicts.length > 0) {
      setConflicts(pendingConflicts);
      setSyncStatus('conflict');
    } else if (failedOps.length > 0) {
      setSyncStatus('error');
      // Still reload so we get the data that did sync successfully
      reloadHandlerRef.current?.();
    } else {
      setSyncStatus('done');
      reloadHandlerRef.current?.();
      // Auto-reset status after feedback
      setTimeout(() => setSyncStatus('idle'), 4000);
    }

    // Reset live progress now that the pass is finished — the chip falls back
    // to just showing the pending count.
    setSyncProgress({ done: 0, total: 0 });

    syncingRef.current = false;
  }

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
    await AsyncStorage.removeItem(offlineQueueKey);
  }, [offlineQueueKey]);

  const registerReloadHandler = useCallback((fn: () => void) => {
    reloadHandlerRef.current = fn;
  }, []);

  return (
    <NetworkContext.Provider value={{
      isOnline,
      queue,
      queueCount: queue.length,
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
