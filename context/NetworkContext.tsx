import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';

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
  const [conflicts, setConflicts] = useState<StatusConflict[]>([]);

  const prevOnlineRef = useRef(true);
  const syncingRef = useRef(false);
  const reloadHandlerRef = useRef<(() => void) | null>(null);

  // ── Queue persistence ──────────────────────────────────────────────────────

  const saveQueue = useCallback(async (q: QueuedOperation[]) => {
    try {
      await AsyncStorage.setItem(offlineQueueKey, JSON.stringify(q));
    } catch {}
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(offlineQueueKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setQueue(parsed);
      }
    } catch {}
  }, []);

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
  }, []);

  // ── Trigger sync when coming back online ───────────────────────────────────

  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      if (isSupabaseConfigured && queue.length > 0) {
        processSyncQueue();
      }
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  // ── Sync logic ─────────────────────────────────────────────────────────────

  async function processSyncQueue() {
    if (syncingRef.current || queue.length === 0 || !isSupabaseConfigured) return;
    syncingRef.current = true;
    setSyncStatus('syncing');

    const pendingConflicts: StatusConflict[] = [];
    const failedOps: QueuedOperation[] = [];
    const currentQueue = queue;

    for (const op of currentQueue) {
      try {
        // ── Status-change conflict detection ───────────────────────────────
        if (op.conflictCheck) {
          const { entityId, previousStatus, newStatus, author, history, closedAt, closedBy } = op.conflictCheck;

          const { data: serverData, error: fetchErr } = await supabase
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
          const { error: applyErr } = await supabase.from('reserves').update({
            status: newStatus,
            history,
            closed_at: closedAt ?? null,
            closed_by: closedBy ?? null,
          }).eq('id', entityId);

          if (applyErr) failedOps.push(op);
          continue;
        }

        // ── Generic table/op replay ────────────────────────────────────────
        let result: { error: any; data?: any[] | null };

        if (op.op === 'insert') {
          result = await supabase.from(op.table).insert(op.data!);
          // 23505 = unique violation → already exists → treat as success
          if (result.error?.code === '23505') result = { error: null };
        } else if (op.op === 'update') {
          const q = supabase.from(op.table).update(op.data!);
          result = op.filter
            ? await q.eq(op.filter.column, op.filter.value)
            : await q;
        } else {
          // Use .select() so we can detect RLS-blocked DELETEs (error=null but 0 rows)
          const q = supabase.from(op.table).delete().select();
          result = op.filter
            ? await q.eq(op.filter.column, op.filter.value)
            : await q;
          // If RLS blocked the delete, data will be [] with no error — treat as failure
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            console.warn(`[queue] DELETE on ${op.table} blocked by RLS (0 rows deleted), re-queuing`);
            failedOps.push(op);
            continue;
          }
        }

        if (result.error) failedOps.push(op);
      } catch {
        failedOps.push(op);
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

    const { error: resolveErr } = await supabase.from('reserves').update({
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
  }, []);

  const registerReloadHandler = useCallback((fn: () => void) => {
    reloadHandlerRef.current = fn;
  }, []);

  return (
    <NetworkContext.Provider value={{
      isOnline,
      queue,
      queueCount: queue.length,
      syncStatus,
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
