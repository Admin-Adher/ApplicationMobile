import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TimeEntry } from '@/constants/types';
import { genId } from '@/lib/utils';

// TODO (Fix 15): PointageContext est entièrement local (AsyncStorage uniquement).
// Il n'y a pas de synchronisation Supabase pour les pointages (table `time_entries` à créer).
// À implémenter : addEntry / updateEntry / deleteEntry avec supabase.from('time_entries').
const POINTAGE_KEY = 'buildtrack_pointage_v1';

interface PointageContextValue {
  entries: TimeEntry[];
  addEntry: (entry: Omit<TimeEntry, 'id'>) => Promise<void>;
  updateEntry: (id: string, updates: Partial<TimeEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  getEntriesForDate: (date: string) => TimeEntry[];
}

const PointageContext = createContext<PointageContextValue | null>(null);

export function PointageProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const entriesRef = useRef(entries);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  useEffect(() => {
    AsyncStorage.getItem(POINTAGE_KEY)
      .then(raw => { if (raw) setEntries(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  async function persist(data: TimeEntry[]) {
    setEntries(data);
    try { await AsyncStorage.setItem(POINTAGE_KEY, JSON.stringify(data)); } catch {}
  }

  const addEntry = useCallback(async (entry: Omit<TimeEntry, 'id'>) => {
    const newEntry: TimeEntry = { ...entry, id: genId() };
    await persist([...entriesRef.current, newEntry]);
  }, []);

  const updateEntry = useCallback(async (id: string, updates: Partial<TimeEntry>) => {
    await persist(entriesRef.current.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    await persist(entriesRef.current.filter(e => e.id !== id));
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
