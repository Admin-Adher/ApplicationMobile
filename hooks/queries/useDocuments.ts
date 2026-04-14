import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toDocument } from '@/lib/mappers';
import { Document } from '@/constants/types';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { mergeWithCache, readCache, writeCache } from '@/lib/offlineCache';

const DOCUMENTS_CACHE_KEY = 'buildtrack_documents_cache_v1';

export function useDocuments() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const startupReady = useStartupDelay(!!user);

  const query = useQuery({
    queryKey: queryKeys.documents(),
    queryFn: async (): Promise<Document[]> => {
      let cached = await readCache<Document>(DOCUMENTS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Document[]>(queryKeys.documents());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(d => d.id));
        const extra = rqCached.filter(d => !cachedIds.has(d.id));
        if (extra.length) cached = [...cached, ...extra];
      }
      if (!isSupabaseConfigured) return cached ?? [];
      try {
        const { data, error } = await supabase.from('documents').select('*').order('uploaded_at', { ascending: false });
        if (error) throw error;
        const fresh = (data ?? []).map(toDocument);
        const merged = mergeWithCache<Document>(fresh, cached);
        await writeCache(DOCUMENTS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn(`[useDocuments] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user && startupReady,
    staleTime: 5 * 60 * 1000,
  });

  const persist = useCallback((documents: Document[]) => {
    writeCache(DOCUMENTS_CACHE_KEY, documents, userId);
  }, [userId]);

  const addDocument = useCallback(async (d: Document) => {
    const orgId = user?.organizationId ?? null;
    queryClient.setQueryData<Document[]>(queryKeys.documents(), old => {
      if ((old ?? []).some(x => x.id === d.id)) return old ?? [];
      return [d, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<Document[]>(queryKeys.documents()) ?? []);
    const payload = {
      id: d.id, name: d.name, type: d.type, category: d.category,
      uploaded_at: d.uploadedAt, size: d.size, version: d.version, uri: d.uri ?? null,
      organization_id: orgId, chantier_id: d.chantierId ?? null,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'documents', op: 'insert', data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('documents').insert(payload);
      if (error) console.warn('[sync] addDocument error:', error.message);
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const deleteDocument = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Document[]>(queryKeys.documents()) ?? [];
    queryClient.setQueryData<Document[]>(queryKeys.documents(), prev.filter(d => d.id !== id));
    persist(prev.filter(d => d.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'documents', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      supabase.from('documents').delete().eq('id', id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] deleteDocument error:', error.message);
      });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  return {
    documents: query.data ?? [],
    isLoadingDocuments: query.isLoading,
    addDocument,
    deleteDocument,
    invalidateDocuments: () => queryClient.invalidateQueries({ queryKey: queryKeys.documents() }),
  };
}
