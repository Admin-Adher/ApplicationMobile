import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RegulatoryDoc } from '@/constants/types';
import { genId } from '@/lib/utils';

const REG_DOCS_KEY = 'buildtrack_reglementaire_v1';

interface ReglementaireContextValue {
  docs: RegulatoryDoc[];
  addDoc: (doc: Omit<RegulatoryDoc, 'id' | 'createdAt'>) => Promise<void>;
  updateDoc: (id: string, updates: Partial<RegulatoryDoc>) => Promise<void>;
  deleteDoc: (id: string) => Promise<void>;
}

const ReglementaireContext = createContext<ReglementaireContextValue | null>(null);

export function ReglementaireProvider({ children }: { children: React.ReactNode }) {
  const [docs, setDocs] = useState<RegulatoryDoc[]>([]);
  const docsRef = useRef(docs);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  useEffect(() => {
    AsyncStorage.getItem(REG_DOCS_KEY)
      .then(raw => { if (raw) setDocs(JSON.parse(raw)); })
      .catch(() => {});
  }, []);

  async function persist(data: RegulatoryDoc[]) {
    setDocs(data);
    try { await AsyncStorage.setItem(REG_DOCS_KEY, JSON.stringify(data)); } catch {}
  }

  const addDoc = useCallback(async (doc: Omit<RegulatoryDoc, 'id' | 'createdAt'>) => {
    const newDoc: RegulatoryDoc = { ...doc, id: genId(), createdAt: new Date().toISOString() };
    await persist([...docsRef.current, newDoc]);
  }, []);

  const updateDoc = useCallback(async (id: string, updates: Partial<RegulatoryDoc>) => {
    await persist(docsRef.current.map(d => d.id === id ? { ...d, ...updates } : d));
  }, []);

  const deleteDoc = useCallback(async (id: string) => {
    await persist(docsRef.current.filter(d => d.id !== id));
  }, []);

  return (
    <ReglementaireContext.Provider value={{ docs, addDoc, updateDoc, deleteDoc }}>
      {children}
    </ReglementaireContext.Provider>
  );
}

export function useReglementaire() {
  const ctx = useContext(ReglementaireContext);
  if (!ctx) throw new Error('useReglementaire must be used inside ReglementaireProvider');
  return ctx;
}
