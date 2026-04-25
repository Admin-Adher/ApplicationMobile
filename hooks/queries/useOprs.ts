import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toOpr, fromOpr } from '@/lib/mappers';
import { Opr } from '@/constants/types';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const OPRS_CACHE_KEY = 'buildtrack_oprs_cache_v1';

export function useOprs() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, queue } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const startupReady = useStartupDelay(!!user);

  const query = useQuery({
    queryKey: queryKeys.oprs(),
    queryFn: async (): Promise<Opr[]> => {
      let cached = await readCache<Opr>(OPRS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Opr[]>(queryKeys.oprs());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(o => o.id));
        const extra = rqCached.filter(o => !cachedIds.has(o.id));
        if (extra.length) cached = [...cached, ...extra];
      }
      if (!isSupabaseConfigured) return cached ?? [];
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      try {
        let q = ((supabase as any).from('oprs') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map(toOpr);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'oprs');
        const merged = mergeWithCache<Opr>(fresh, cached, pendingIds);
        await writeCache(OPRS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn(`[useOprs] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user && startupReady,
    staleTime: 5 * 60 * 1000,
  });

  const persist = useCallback((oprs: Opr[]) => {
    writeCache(OPRS_CACHE_KEY, oprs, userId);
  }, [userId]);

  const addOpr = useCallback(async (o: Opr) => {
    const orgId = user?.organizationId ?? null;
    queryClient.setQueryData<Opr[]>(queryKeys.oprs(), old => {
      if ((old ?? []).some(x => x.id === o.id)) return old ?? [];
      return [o, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<Opr[]>(queryKeys.oprs()) ?? []);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'oprs', op: 'insert', data: fromOpr(o, orgId) });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('oprs').insert(fromOpr(o, orgId));
      if (error) console.warn('[sync] addOpr error:', error.message);
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const updateOpr = useCallback(async (o: Opr) => {
    queryClient.setQueryData<Opr[]>(queryKeys.oprs(), old =>
      (old ?? []).map(x => x.id === o.id ? o : x)
    );
    persist(queryClient.getQueryData<Opr[]>(queryKeys.oprs()) ?? []);
    const orgId = user?.organizationId ?? null;
    const { id, organization_id, ...fields } = fromOpr(o, orgId);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'oprs', op: 'update', filter: { column: 'id', value: o.id }, data: fields });
      return;
    }
    if (isSupabaseConfigured) {
      (supabase as any).from('oprs').update(fields).eq('id', o.id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] updateOpr error:', error.message);
      });
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const deleteOpr = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Opr[]>(queryKeys.oprs()) ?? [];
    const previous = prev.find(o => o.id === id);
    queryClient.setQueryData<Opr[]>(queryKeys.oprs(), prev.filter(o => o.id !== id));
    persist(prev.filter(o => o.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'oprs', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any).from('oprs').delete().eq('id', id).select();
      if (error) {
        console.warn('[sync] deleteOpr erreur serveur:', error.message);
        if (previous) {
          queryClient.setQueryData<Opr[]>(queryKeys.oprs(), old => [previous, ...(old ?? [])]);
          Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cet OPR, ou il n\'existe plus sur le serveur.');
        }
      } else if (!deleted?.length) {
        console.warn('[sync] deleteOpr: aucune ligne supprimée');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  return {
    oprs: query.data ?? [],
    isLoadingOprs: query.isLoading,
    addOpr,
    updateOpr,
    deleteOpr,
    invalidateOprs: () => queryClient.invalidateQueries({ queryKey: queryKeys.oprs() }),
  };
}
