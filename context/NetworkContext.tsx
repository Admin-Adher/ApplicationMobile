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

          if (fetchErr) { failedOps.push(op); continue; }

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

          if (applyErr) failedOps.push(op);
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
              console.warn(`[queue] some local files failed to upload for ${op.table}, will retry on next pass`);
              failedOps.push(op); // keep op in queue for next retry
              continue;
            }
          } catch (e) {
            console.warn(`[queue] uploadLocalPhotosInPayload failed for ${op.table}, will retry:`, e);
            failedOps.push(op);
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
          const q = (supabase as any).from(op.table).update(data!);
          result = op.filter
            ? await q.eq(op.filter.column, op.filter.value)
            : await q;
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
            console.warn(`[queue] DELETE on ${op.table} blocked by RLS (0 rows deleted), re-queuing`);
            failedOps.push(op);
            continue;
          }
        }

        if (result.error) failedOps.push(op);
      } catch {
        failedOps.push(op);
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
    }}>
      {children}
    </NetworkContext.Provider>
  );
}
