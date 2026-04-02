import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TimeEntry } from '@/constants/types';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { genId } from '@/lib/utils';

const POINTAGE_KEY = 'buildtrack_pointage_v1';

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
  };
}

export function PointageProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    async function load() {
      if (isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('time_entries')
            .select('*')
            .order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const loaded = data.map(toEntry);
            setEntries(loaded);
            await AsyncStorage.setItem(POINTAGE_KEY, JSON.stringify(loaded)).catch(() => {});
            return;
          }
        } catch {}
      }
      try {
        const stored = await AsyncStorage.getItem(POINTAGE_KEY);
        if (stored) setEntries(JSON.parse(stored));
      } catch {}
    }
    load();
  }, []);

  async function persistLocal(data: TimeEntry[]) {
    setEntries(data);
    try { await AsyncStorage.setItem(POINTAGE_KEY, JSON.stringify(data)); } catch {}
  }

  const addEntry = useCallback(async (entry: Omit<TimeEntry, 'id'>) => {
    const newEntry: TimeEntry = { ...entry, id: genId() };
    await persistLocal([...entriesRef.current, newEntry]);
    if (isSupabaseConfigured) {
      supabase.from('time_entries').insert(fromEntry(newEntry)).then(({ error }: { error: any }) => {
        if (error) console.warn('Erreur sauvegarde pointage:', error.message);
      });
    }
  }, []);

  const updateEntry = useCallback(async (id: string, updates: Partial<TimeEntry>) => {
    const updated = entriesRef.current.map(e => e.id === id ? { ...e, ...updates } : e);
    await persistLocal(updated);
    if (isSupabaseConfigured) {
      const full = updated.find(e => e.id === id);
      if (full) {
        supabase.from('time_entries').update(fromEntry(full)).eq('id', id).then(({ error }: { error: any }) => {
          if (error) console.warn('Erreur mise à jour pointage:', error.message);
        });
      }
    }
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    await persistLocal(entriesRef.current.filter(e => e.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('time_entries').delete().eq('id', id).then(({ error }: { error: any }) => {
        if (error) console.warn('Erreur suppression pointage:', error.message);
      });
    }
  }, []);

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
