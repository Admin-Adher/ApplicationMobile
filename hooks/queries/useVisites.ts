import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toVisite, fromVisite } from '@/lib/mappers';
import { Visite } from '@/constants/types';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const VISITES_CACHE_KEY = 'buildtrack_visites_cache_v1';

export function useVisites() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const startupReady = useStartupDelay(!!user);

  const query = useQuery({
    queryKey: queryKeys.visites(),
    queryFn: async (): Promise<Visite[]> => {
      let cached = await readCache<Visite>(VISITES_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Visite[]>(queryKeys.visites());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(v => v.id));
        const extra = rqCached.filter(v => !cachedIds.has(v.id));
        if (extra.length) cached = [...cached, ...extra];
      }
      if (!isSupabaseConfigured) return cached ?? [];
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];
      try {
        let q = ((supabase as any).from('visites') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map(toVisite);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'visites');
        const merged = mergeWithCache<Visite>(fresh, cached, pendingIds, { queueLoaded });
        await writeCache(VISITES_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn(`[useVisites] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user && startupReady,
  });

  const persist = useCallback((visites: Visite[]) => {
    writeCache(VISITES_CACHE_KEY, visites, userId);
  }, [userId]);

  const addVisite = useCallback(async (v: Visite) => {
    const orgId = user?.organizationId ?? null;
    queryClient.setQueryData<Visite[]>(queryKeys.visites(), old => {
      if ((old ?? []).some(x => x.id === v.id)) return old ?? [];
      return [v, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? []);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'visites', op: 'insert', data: fromVisite(v, orgId) });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('visites').insert(fromVisite(v, orgId));
      if (error) console.warn('[sync] addVisite error:', error.message);
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const updateVisite = useCallback(async (v: Visite) => {
    queryClient.setQueryData<Visite[]>(queryKeys.visites(), old =>
      (old ?? []).map(x => x.id === v.id ? v : x)
    );
    persist(queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? []);
    const orgId = user?.organizationId ?? null;
    const { id, organization_id, ...fields } = fromVisite(v, orgId);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'visites', op: 'update', filter: { column: 'id', value: v.id }, data: fields });
      return;
    }
    if (isSupabaseConfigured) {
      (supabase as any).from('visites').update(fields).eq('id', v.id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] updateVisite error:', error.message);
      });
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const deleteVisite = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? [];
    const previous = prev.find(v => v.id === id);
    queryClient.setQueryData<Visite[]>(queryKeys.visites(), prev.filter(v => v.id !== id));
    persist(prev.filter(v => v.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'visites', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any).from('visites').delete().eq('id', id).select();
      if (error) {
        console.warn('[sync] deleteVisite erreur serveur:', error.message);
        if (previous) {
          queryClient.setQueryData<Visite[]>(queryKeys.visites(), old => [previous, ...(old ?? [])]);
          Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette visite, ou elle n\'existe plus sur le serveur.');
        }
      } else if (!deleted?.length) {
        console.warn('[sync] deleteVisite: aucune ligne supprimée');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  const linkReserveToVisite = useCallback(async (reserveId: string, visiteId: string) => {
    const visites = queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? [];
    const visite = visites.find(v => v.id === visiteId);
    if (!visite) return;
    if (visite.reserveIds.includes(reserveId)) return;
    const updated = { ...visite, reserveIds: [...visite.reserveIds, reserveId] };
    queryClient.setQueryData<Visite[]>(queryKeys.visites(), old =>
      (old ?? []).map(v => v.id === visiteId ? updated : v)
    );
    persist(queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? []);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'visites', op: 'update', filter: { column: 'id', value: visiteId }, data: { reserve_ids: updated.reserveIds } });
      return;
    }
    if (isSupabaseConfigured) {
      (supabase as any).from('visites').update({ reserve_ids: updated.reserveIds }).eq('id', visiteId)
        .then(({ error }: { error: any }) => {
          if (error) console.warn('[sync] linkReserveToVisite error:', error.message);
        });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  return {
    visites: query.data ?? [],
    isLoadingVisites: query.isLoading,
    addVisite,
    updateVisite,
    deleteVisite,
    linkReserveToVisite,
    invalidateVisites: () => queryClient.invalidateQueries({ queryKey: queryKeys.visites() }),
  };
}
