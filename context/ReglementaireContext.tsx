import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RegulatoryDoc } from '@/constants/types';
import { genId, formatDateFR } from '@/lib/utils';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const REG_DOCS_KEY = 'buildtrack_reglementaire_v1';

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
  const [docs, setDocs] = useState<RegulatoryDoc[]>([]);
  const docsRef = useRef(docs);
  const orgIdRef = useRef<string | null>(null);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  useEffect(() => {
    async function load() {
      if (isSupabaseConfigured) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.id) {
            const { data: profile } = await supabase
              .from('profiles').select('organization_id').eq('id', session.user.id).single();
            if (profile?.organization_id) orgIdRef.current = profile.organization_id;
          }
          const { data, error } = await supabase
            .from('regulatory_docs')
            .select('*')
            .order('created_at', { ascending: false });
          if (!error && data) {
            const loaded = data.map(toDoc);
            setDocs(loaded);
            AsyncStorage.setItem(REG_DOCS_KEY, JSON.stringify(loaded)).catch(() => {});
            return;
          }
        } catch {}
      }
      try {
        const raw = await AsyncStorage.getItem(REG_DOCS_KEY);
        if (raw) setDocs(JSON.parse(raw));
      } catch {}
    }
    load();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sub = supabase
      .channel('realtime-regulatory-docs-v1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'regulatory_docs' }, (payload: any) => {
        const doc = toDoc(payload.new);
        setDocs(prev => {
          if (prev.find(d => d.id === doc.id)) return prev;
          const updated = [doc, ...prev];
          AsyncStorage.setItem(REG_DOCS_KEY, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'regulatory_docs' }, (payload: any) => {
        const doc = toDoc(payload.new);
        setDocs(prev => {
          const updated = prev.map(d => d.id === doc.id ? doc : d);
          AsyncStorage.setItem(REG_DOCS_KEY, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'regulatory_docs' }, (payload: any) => {
        const id = payload.old.id;
        setDocs(prev => {
          const updated = prev.filter(d => d.id !== id);
          AsyncStorage.setItem(REG_DOCS_KEY, JSON.stringify(updated)).catch(() => {});
          return updated;
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, []);

  async function persistLocal(data: RegulatoryDoc[]) {
    setDocs(data);
    try { await AsyncStorage.setItem(REG_DOCS_KEY, JSON.stringify(data)); } catch {}
  }

  const addDoc = useCallback(async (doc: Omit<RegulatoryDoc, 'id' | 'createdAt'>) => {
    const newDoc: RegulatoryDoc = { ...doc, id: genId(), createdAt: formatDateFR(new Date()) };
    await persistLocal([newDoc, ...docsRef.current]);
    if (isSupabaseConfigured) {
      (async () => {
        try {
          let orgId = orgIdRef.current;
          if (!orgId) {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) {
              const { data: prof } = await supabase
                .from('profiles').select('organization_id')
                .eq('id', session.user.id).single();
              orgId = prof?.organization_id ?? null;
              if (orgId) orgIdRef.current = orgId;
            }
          }
          const { error } = await supabase.from('regulatory_docs').insert({
            ...fromDoc(newDoc),
            organization_id: orgId,
          });
          if (error) console.warn('Erreur sauvegarde doc réglementaire:', error.message);
        } catch (e: any) {
          console.warn('Erreur sauvegarde doc réglementaire:', e?.message ?? e);
        }
      })();
    }
  }, []);

  const updateDoc = useCallback(async (id: string, updates: Partial<RegulatoryDoc>) => {
    const updated = docsRef.current.map(d => d.id === id ? { ...d, ...updates } : d);
    await persistLocal(updated);
    if (isSupabaseConfigured) {
      const full = updated.find(d => d.id === id);
      if (full) {
        supabase.from('regulatory_docs').update(fromDoc(full)).eq('id', id).then(({ error }: { error: any }) => {
          if (error) console.warn('Erreur mise à jour doc réglementaire:', error.message);
        }).catch((err: any) => {
          console.warn('Erreur réseau mise à jour doc réglementaire (données sauvegardées localement):', err?.message ?? err);
        });
      }
    }
  }, []);

  const deleteDoc = useCallback(async (id: string) => {
    await persistLocal(docsRef.current.filter(d => d.id !== id));
    if (isSupabaseConfigured) {
      supabase.from('regulatory_docs').delete().eq('id', id).then(({ error }: { error: any }) => {
        if (error) console.warn('Erreur suppression doc réglementaire:', error.message);
      }).catch((err: any) => {
        console.warn('Erreur réseau suppression doc réglementaire (supprimé localement):', err?.message ?? err);
      });
    }
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
