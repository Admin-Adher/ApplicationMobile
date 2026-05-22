import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toVisite, fromVisite } from '@/lib/mappers';
import { Reserve, Visite } from '@/constants/types';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import { supabaseRestRpc } from '@/lib/supabaseRest';
import { RESERVES_CACHE_KEY, VISITES_CACHE_KEY } from '@/lib/cacheKeys';

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

  useEffect(() => {
    if (!userId) return;
    readCache<Visite>(VISITES_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Visite[]>(queryKeys.visites());
      if (!rqCurrent?.length) return;
      const manualIds = new Set(manualCached.map(v => v.id));
      if (rqCurrent.some(v => !manualIds.has(v.id))) {
        queryClient.setQueryData<Visite[]>(queryKeys.visites(), rqCurrent.filter(v => manualIds.has(v.id)));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const query = useQuery({
    queryKey: queryKeys.visites(),
    queryFn: async (): Promise<Visite[]> => {
      let cached = await readCache<Visite>(VISITES_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Visite[]>(queryKeys.visites());
      if (!cached && rqCached?.length) cached = rqCached;
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

  const persistReserves = useCallback((reserves: Reserve[]) => {
    writeCache(RESERVES_CACHE_KEY, reserves, userId);
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
      const payload = fromVisite(v, orgId);
      const { error } = await (supabase as any).from('visites').insert(payload);
      if (error) {
        console.warn('[sync] addVisite error, queuing for retry:', error.message);
        enqueueOperation({ table: 'visites', op: 'insert', data: payload });
      }
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
      const { error } = await (supabase as any).from('visites').update(fields).eq('id', v.id);
      if (error) {
        console.warn('[sync] updateVisite error, queuing for retry:', error.message);
        enqueueOperation({ table: 'visites', op: 'update', filter: { column: 'id', value: v.id }, data: fields });
      }
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
        console.warn('[sync] deleteVisite erreur serveur:', error.code, error.message);
        const isPermissionDenied = error.code === '42501' || /row-level security|permission denied/i.test(error.message ?? '');
        if (isPermissionDenied && previous) {
          queryClient.setQueryData<Visite[]>(queryKeys.visites(), old => [previous, ...(old ?? [])]);
          persist(queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? []);
          Alert.alert('Suppression refusée', "Vous n'avez pas les droits pour supprimer cette visite, ou elle n'existe plus sur le serveur.");
        } else {
          console.warn('[sync] deleteVisite: erreur réseau/session, opération enqueued pour retry');
          enqueueOperation({ table: 'visites', op: 'delete', filter: { column: 'id', value: id } });
        }
      } else if (!deleted?.length) {
        console.warn('[sync] deleteVisite: aucune ligne supprimée');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  const attachReservesToVisite = useCallback(async (visiteId: string, reserveIds: string[]) => {
    const selectedIds = Array.from(new Set(
      reserveIds.map(id => String(id ?? '').trim()).filter(Boolean),
    ));
    if (selectedIds.length === 0) {
      return { success: true, movedCount: 0 };
    }

    const visites = queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? [];
    const target = visites.find(v => v.id === visiteId);
    if (!target) {
      return { success: false, error: 'Visite introuvable.' };
    }

    const currentReserves = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const previousVisitIds = Array.from(new Set(
      [
        ...currentReserves
          .filter(r => selectedIds.includes(r.id) && r.visiteId && r.visiteId !== visiteId)
          .map(r => r.visiteId!),
        ...visites
          .filter(v => v.id !== visiteId && (v.reserveIds ?? []).some(id => selectedIds.includes(id)))
          .map(v => v.id),
      ],
    ));

    const nextVisites = visites.map(v => {
      if (v.id === visiteId) {
        return { ...v, reserveIds: Array.from(new Set([...(v.reserveIds ?? []), ...selectedIds])) };
      }
      if (previousVisitIds.includes(v.id)) {
        return { ...v, reserveIds: (v.reserveIds ?? []).filter(id => !selectedIds.includes(id)) };
      }
      return v;
    });

    const nextReserves = currentReserves.map(r =>
      selectedIds.includes(r.id) ? { ...r, visiteId } : r
    );

    queryClient.setQueryData<Visite[]>(queryKeys.visites(), nextVisites);
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), nextReserves);
    persist(nextVisites);
    persistReserves(nextReserves);

    const rpcArgs = { p_visite_id: visiteId, p_reserve_ids: selectedIds };
    const queueRpc = (error?: string) => {
      enqueueOperation({
        table: 'visite_reserve_links',
        op: 'rpc',
        rpc: { fn: 'link_reserves_to_visite', args: rpcArgs },
        data: {
          visite_id: visiteId,
          reserve_ids: selectedIds,
          previous_visite_ids: previousVisitIds,
        },
        lastError: error,
      });
    };

    if (!isOnlineRef.current && isSupabaseConfigured) {
      queueRpc();
      return { success: true, queued: true, movedCount: previousVisitIds.length };
    }

    if (isSupabaseConfigured) {
      const { error } = await supabaseRestRpc('link_reserves_to_visite', rpcArgs);
      if (error) {
        const message = error.message ?? String(error);
        console.warn('[sync] attachReservesToVisite RPC error, queuing for retry:', message);
        queueRpc(message);
        return { success: true, queued: true, movedCount: previousVisitIds.length, error: message };
      }
    }

    return { success: true, movedCount: previousVisitIds.length };
  }, [queryClient, isOnlineRef, enqueueOperation, persist, persistReserves]);

  const unlinkReservesFromVisite = useCallback(async (visiteId: string, reserveIds: string[]) => {
    const selectedIds = Array.from(new Set(
      reserveIds.map(id => String(id ?? '').trim()).filter(Boolean),
    ));
    if (selectedIds.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const visites = queryClient.getQueryData<Visite[]>(queryKeys.visites()) ?? [];
    const target = visites.find(v => v.id === visiteId);
    if (!target) {
      return { success: false, error: 'Visite introuvable.' };
    }

    const currentReserves = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const nextVisites = visites.map(v =>
      v.id === visiteId
        ? { ...v, reserveIds: (v.reserveIds ?? []).filter(id => !selectedIds.includes(id)) }
        : v
    );
    const nextReserves = currentReserves.map(r =>
      selectedIds.includes(r.id) && r.visiteId === visiteId
        ? { ...r, visiteId: undefined }
        : r
    );

    queryClient.setQueryData<Visite[]>(queryKeys.visites(), nextVisites);
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), nextReserves);
    persist(nextVisites);
    persistReserves(nextReserves);

    const rpcArgs = { p_visite_id: visiteId, p_reserve_ids: selectedIds };
    const queueRpc = (error?: string) => {
      enqueueOperation({
        table: 'visite_reserve_links',
        op: 'rpc',
        rpc: { fn: 'unlink_reserves_from_visite', args: rpcArgs },
        data: {
          visite_id: visiteId,
          reserve_ids: selectedIds,
        },
        lastError: error,
      });
    };

    if (!isOnlineRef.current && isSupabaseConfigured) {
      queueRpc();
      return { success: true, queued: true, updatedCount: selectedIds.length };
    }

    if (isSupabaseConfigured) {
      const { error } = await supabaseRestRpc('unlink_reserves_from_visite', rpcArgs);
      if (error) {
        const message = error.message ?? String(error);
        console.warn('[sync] unlinkReservesFromVisite RPC error, queuing for retry:', message);
        queueRpc(message);
        return { success: true, queued: true, updatedCount: selectedIds.length, error: message };
      }
    }

    return { success: true, updatedCount: selectedIds.length };
  }, [queryClient, isOnlineRef, enqueueOperation, persist, persistReserves]);

  const linkReserveToVisite = useCallback(async (reserveId: string, visiteId: string) => {
    await attachReservesToVisite(visiteId, [reserveId]);
  }, [attachReservesToVisite]);

  return {
    visites: query.data ?? [],
    isLoadingVisites: query.isLoading,
    addVisite,
    updateVisite,
    deleteVisite,
    attachReservesToVisite,
    unlinkReservesFromVisite,
    linkReserveToVisite,
    invalidateVisites: () => queryClient.invalidateQueries({ queryKey: queryKeys.visites() }),
  };
}
