import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState, AppStateStatus, Platform } from 'react-native';
import { TimeEntry } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { genId } from '@/lib/utils';
import { mergeWithCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const POINTAGE_PREFIX = 'buildtrack_pointage_v2_';

interface PointageContextValue {
  entries: TimeEntry[];
  addEntry: (entry: Omit<TimeEntry, 'id'>) => Promise<void>;
  updateEntry: (id: string, updates: Partial<TimeEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  getEntriesForDate: (date: string) => TimeEntry[];
}

const PointageContext = createContext<PointageContextValue | null>(null);

function toEntry(row: any): TimeEntry {
  return {
    id: row.id,
    date: row.date,
    companyId: row.company_id ?? '',
    companyName: row.company_name ?? '',
    companyColor: row.company_color ?? '#10B981',
    workerName: row.worker_name,
    arrivalTime: row.arrival_time,
    departureTime: row.departure_time ?? undefined,
    notes: row.notes ?? undefined,
    recordedBy: row.recorded_by ?? '',
    taskId: row.task_id ?? undefined,
    taskTitle: row.task_title ?? undefined,
    updatedBy: row.updated_by ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  };
}

function fromEntry(e: TimeEntry): Record<string, any> {
  return {
    id: e.id,
    date: e.date,
    company_id: e.companyId ?? null,
    company_name: e.companyName ?? null,
    company_color: e.companyColor ?? null,
    worker_name: e.workerName,
    arrival_time: e.arrivalTime,
    departure_time: e.departureTime ?? null,
    notes: e.notes ?? null,
    recorded_by: e.recordedBy ?? null,
    task_id: e.taskId ?? null,
    task_title: e.taskTitle ?? null,
    updated_by: e.updatedBy ?? null,
    updated_at: e.updatedAt ?? null,
  };
}

export function PointageProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const pointageKey = POINTAGE_PREFIX + (user?.id ?? 'anon');
  const [foregroundReloadSeq, setForegroundReloadSeq] = useState(0);
  const entriesRef = useRef(entries);
  const orgIdRef = useRef<string | null>(user?.organizationId ?? null);
  const isOnlineRef = useRef(isOnline);
  const queueRef = useRef(queue);
  useEffect(() => { entriesRef.current = entries; }, [entries]);
  useEffect(() => { orgIdRef.current = user?.organizationId ?? null; }, [user?.organizationId]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    async function load() {
      if (user?.role === 'magasinier') {
        setEntries([]);
        return;
      }
      // Always read cache first so offline-created entries survive.
      let cached: TimeEntry[] | null = null;
      try {
        const stored = await AsyncStorage.getItem(pointageKey);
        if (stored) cached = JSON.parse(stored);
      } catch {}

      if (isSupabaseConfigured && user && queueLoaded && await isSupabaseSessionValid()) {
        try {
          let q = (supabase as any)
            .from('time_entries')
            .select('*')
            .order('created_at', { ascending: false });
          if (user.role !== 'super_admin' && user.organizationId) {
            q = q.eq('organization_id', user.organizationId);
          }
          const { data, error } = await q;
          if (!error && data) {
            const fresh = data.map(toEntry);
            const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'time_entries');
            const merged = mergeWithCache<TimeEntry>(fresh, cached, pendingIds, { queueLoaded });
            setEntries(merged);
            await AsyncStorage.setItem(pointageKey, JSON.stringify(merged)).catch(() => {});
            return;
          }
        } catch {}
      }
      // Fallback to cache
      if (cached) setEntries(cached);
    }
    load();
  }, [user?.id, user?.role, queueLoaded, foregroundReloadSeq]);

  useEffect(() => {
    if (!isSupabaseConfigured || Platform.OS === 'web' || !user || user.role === 'magasinier') return;
    let backgroundAt = 0;
    let lastReloadAt = 0;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
        if (sleptMs > 5000 && Date.now() - lastReloadAt > 2000) {
          lastReloadAt = Date.now();
          setForegroundReloadSeq(seq => seq + 1);
        }
      } else if (state === 'background' || state === 'inactive') {
        backgroundAt = Date.now();
      }
    });
    return () => sub.remove();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user || user.role === 'magasinier') return;
    const sub = supabase
      .channel(`realtime-time-entries-v2-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'time_entries' }, (payload: any) => {
        const entry = toEntry(payload.new);
        setEntries(prev => {
          if (prev.find(e => e.id === entry.id)) return prev;
          const updated = [entry, ...prev];
          AsyncStorage.setItem(pointageKey, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'time_entries' }, (payload: any) => {
        const entry = toEntry(payload.new);
        setEntries(prev => {
          const updated = prev.map(e => e.id === entry.id ? entry : e);
          AsyncStorage.setItem(pointageKey, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'time_entries' }, (payload: any) => {
        const id = payload.old.id;
        setEntries(prev => {
          const updated = prev.filter(e => e.id !== id);
          AsyncStorage.setItem(pointageKey, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [user?.id, user?.role, foregroundReloadSeq]);

  async function persistLocal(data: TimeEntry[]) {
    setEntries(data);
    try { await AsyncStorage.setItem(pointageKey, JSON.stringify(data)); } catch {}
  }

  const addEntry = useCallback(async (entry: Omit<TimeEntry, 'id'>) => {
    const newEntry: TimeEntry = { ...entry, id: genId() };
    await persistLocal([...entriesRef.current, newEntry]);
    if (isSupabaseConfigured) {
      const payload = { ...fromEntry(newEntry), organization_id: orgIdRef.current ?? null };
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'time_entries', op: 'insert', data: payload });
        return;
      }
      (supabase as any).from('time_entries').insert(payload).then(({ error }: { error: any }) => {
        if (error) {
          console.warn('[sync] addEntry server error (data saved locally):', error.message);
          enqueueOperation({ table: 'time_entries', op: 'insert', data: payload });
        }
      }).catch((err: any) => {
        console.warn('[sync] addEntry network error (data saved locally):', err?.message ?? err);
        enqueueOperation({ table: 'time_entries', op: 'insert', data: payload });
      });
    }
  }, [enqueueOperation, pointageKey]);

  const updateEntry = useCallback(async (id: string, updates: Partial<TimeEntry>) => {
    const updated = entriesRef.current.map(e => e.id === id ? { ...e, ...updates } : e);
    await persistLocal(updated);
    if (isSupabaseConfigured) {
      const full = updated.find(e => e.id === id);
      if (full) {
        const payload = fromEntry(full);
        if (!isOnlineRef.current) {
          enqueueOperation({ table: 'time_entries', op: 'update', filter: { column: 'id', value: id }, data: payload });
          return;
        }
        (supabase as any).from('time_entries').update(payload).eq('id', id).then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateEntry server error (data saved locally):', error.message);
            enqueueOperation({ table: 'time_entries', op: 'update', filter: { column: 'id', value: id }, data: payload });
          }
        }).catch((err: any) => {
          console.warn('[sync] updateEntry network error (data saved locally):', err?.message ?? err);
          enqueueOperation({ table: 'time_entries', op: 'update', filter: { column: 'id', value: id }, data: payload });
        });
      }
    }
  }, [enqueueOperation, pointageKey]);

  const deleteEntry = useCallback(async (id: string) => {
    await persistLocal(entriesRef.current.filter(e => e.id !== id));
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'time_entries', op: 'delete', filter: { column: 'id', value: id } });
        return;
      }
      (supabase as any).from('time_entries').delete().eq('id', id).then(({ error }: { error: any }) => {
        if (error) {
          console.warn('[sync] deleteEntry server error (data deleted locally):', error.message);
          enqueueOperation({ table: 'time_entries', op: 'delete', filter: { column: 'id', value: id } });
        }
      }).catch((err: any) => {
        console.warn('[sync] deleteEntry network error (data deleted locally):', err?.message ?? err);
        enqueueOperation({ table: 'time_entries', op: 'delete', filter: { column: 'id', value: id } });
      });
    }
  }, [enqueueOperation, pointageKey]);

  const getEntriesForDate = useCallback((date: string) => {
    return entriesRef.current.filter(e => e.date === date);
  }, []);

  return (
    <PointageContext.Provider value={{ entries, addEntry, updateEntry, deleteEntry, getEntriesForDate }}>
      {children}
    </PointageContext.Provider>
  );
}

export function usePointage() {
  const ctx = useContext(PointageContext);
  if (!ctx) throw new Error('usePointage must be used inside PointageProvider');
  return ctx;
}
