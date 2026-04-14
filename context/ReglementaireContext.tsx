import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RegulatoryDoc } from '@/constants/types';
import { genId, formatDateFR } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { mergeWithCache } from '@/lib/offlineCache';

const REG_DOCS_PREFIX = 'buildtrack_reglementaire_v2_';

interface ReglementaireContextValue {
  docs: RegulatoryDoc[];
  addDoc: (doc: Omit<RegulatoryDoc, 'id' | 'createdAt'>) => Promise<void>;
  updateDoc: (id: string, updates: Partial<RegulatoryDoc>) => Promise<void>;
  deleteDoc: (id: string) => Promise<void>;
}

const ReglementaireContext = createContext<ReglementaireContextValue | null>(null);

function toDoc(row: any): RegulatoryDoc {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    company: row.company ?? undefined,
    reference: row.reference ?? undefined,
    issueDate: row.issue_date ?? undefined,
    expiryDate: row.expiry_date ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    uri: row.uri ?? undefined,
    createdAt: row.created_at ?? row.createdAt ?? '',
    createdBy: row.created_by ?? row.createdBy ?? '',
  };
}

function fromDoc(doc: RegulatoryDoc): Record<string, any> {
  return {
    id: doc.id,
    type: doc.type,
    title: doc.title,
    company: doc.company ?? null,
    reference: doc.reference ?? null,
    issue_date: doc.issueDate ?? null,
    expiry_date: doc.expiryDate ?? null,
    status: doc.status,
    notes: doc.notes ?? null,
    uri: doc.uri ?? null,
    created_at: doc.createdAt,
    created_by: doc.createdBy,
  };
}

export function ReglementaireProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isOnline, enqueueOperation } = useNetwork();
  const [docs, setDocs] = useState<RegulatoryDoc[]>([]);
  const regDocsKey = REG_DOCS_PREFIX + (user?.id ?? 'anon');
  const docsRef = useRef(docs);
  const orgIdRef = useRef<string | null>(user?.organizationId ?? null);
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { docsRef.current = docs; }, [docs]);
  useEffect(() => { orgIdRef.current = user?.organizationId ?? null; }, [user?.organizationId]);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  useEffect(() => {
    async function load() {
      // Always read cache first so offline-created docs survive.
      let cached: RegulatoryDoc[] | null = null;
      try {
        const raw = await AsyncStorage.getItem(regDocsKey);
        if (raw) cached = JSON.parse(raw);
      } catch {}

      if (isSupabaseConfigured && user) {
        try {
          const { data, error } = await supabase
            .from('regulatory_docs')
            .select('*')
            .order('created_at', { ascending: false });
          if (!error && data) {
            const fresh = data.map(toDoc);
            const merged = mergeWithCache<RegulatoryDoc>(fresh, cached);
            setDocs(merged);
            AsyncStorage.setItem(regDocsKey, JSON.stringify(merged)).catch(() => {});
            return;
          }
        } catch {}
      }
      // Fallback to cache
      if (cached) setDocs(cached);
    }
    load();
  }, [user?.id]);

  useEffect(() => {
    if (!isSupabaseConfigured || !user) return;
    const sub = supabase
      .channel(`realtime-regulatory-docs-v2-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'regulatory_docs' }, (payload: any) => {
        const doc = toDoc(payload.new);
        setDocs(prev => {
          if (prev.find(d => d.id === doc.id)) return prev;
          const updated = [doc, ...prev];
          AsyncStorage.setItem(regDocsKey, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'regulatory_docs' }, (payload: any) => {
        const doc = toDoc(payload.new);
        setDocs(prev => {
          const updated = prev.map(d => d.id === doc.id ? doc : d);
          AsyncStorage.setItem(regDocsKey, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'regulatory_docs' }, (payload: any) => {
        const id = payload.old.id;
        setDocs(prev => {
          const updated = prev.filter(d => d.id !== id);
          AsyncStorage.setItem(regDocsKey, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [user?.id]);

  async function persistLocal(data: RegulatoryDoc[]) {
    setDocs(data);
    try { await AsyncStorage.setItem(regDocsKey, JSON.stringify(data)); } catch {}
  }

  const addDoc = useCallback(async (doc: Omit<RegulatoryDoc, 'id' | 'createdAt'>) => {
    const newDoc: RegulatoryDoc = { ...doc, id: genId(), createdAt: formatDateFR(new Date()) };
    await persistLocal([newDoc, ...docsRef.current]);
    if (isSupabaseConfigured) {
      const payload = { ...fromDoc(newDoc), organization_id: orgIdRef.current };
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'regulatory_docs', op: 'insert', data: payload });
        return;
      }
      supabase.from('regulatory_docs').insert(payload).then(({ error }: { error: any }) => {
        if (error) console.warn('Erreur sauvegarde doc réglementaire:', error.message);
      }).catch((e: any) => {
        console.warn('Erreur sauvegarde doc réglementaire:', e?.message ?? e);
      });
    }
  }, [enqueueOperation, regDocsKey]);

  const updateDoc = useCallback(async (id: string, updates: Partial<RegulatoryDoc>) => {
    const updated = docsRef.current.map(d => d.id === id ? { ...d, ...updates } : d);
    await persistLocal(updated);
    if (isSupabaseConfigured) {
      const full = updated.find(d => d.id === id);
      if (full) {
        if (!isOnlineRef.current) {
          enqueueOperation({ table: 'regulatory_docs', op: 'update', filter: { column: 'id', value: id }, data: fromDoc(full) });
          return;
        }
        supabase.from('regulatory_docs').update(fromDoc(full)).eq('id', id).then(({ error }: { error: any }) => {
          if (error) console.warn('Erreur mise à jour doc réglementaire:', error.message);
        }).catch((err: any) => {
          console.warn('Erreur réseau mise à jour doc réglementaire (données sauvegardées localement):', err?.message ?? err);
        });
      }
    }
  }, [enqueueOperation, regDocsKey]);

  const deleteDoc = useCallback(async (id: string) => {
    await persistLocal(docsRef.current.filter(d => d.id !== id));
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        enqueueOperation({ table: 'regulatory_docs', op: 'delete', filter: { column: 'id', value: id } });
        return;
      }
      supabase.from('regulatory_docs').delete().eq('id', id).then(({ error }: { error: any }) => {
        if (error) console.warn('Erreur suppression doc réglementaire:', error.message);
      }).catch((err: any) => {
        console.warn('Erreur réseau suppression doc réglementaire (supprimé localement):', err?.message ?? err);
      });
    }
  }, [enqueueOperation, regDocsKey]);

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
