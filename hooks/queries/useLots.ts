import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toLot, fromLot } from '@/lib/mappers';
import type { Lot } from '@/constants/types';
import { STANDARD_LOTS } from '@/constants/standardLots';

export { STANDARD_LOTS } from '@/constants/standardLots';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import i18n from '@/lib/i18n';

const LOTS_CACHE_KEY = 'buildtrack_lots_cache_v1';

export function useLots() {
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
    readCache<Lot>(LOTS_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Lot[]>(queryKeys.lots());
      if (!rqCurrent?.length) return;
      const manualIds = new Set(manualCached.map(l => l.id));
      if (rqCurrent.some(l => !manualIds.has(l.id))) {
        queryClient.setQueryData<Lot[]>(queryKeys.lots(), rqCurrent.filter(l => manualIds.has(l.id)));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const query = useQuery({
    queryKey: queryKeys.lots(),
    queryFn: async (): Promise<Lot[]> => {
      let cached = await readCache<Lot>(LOTS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Lot[]>(queryKeys.lots());
      if (!cached && rqCached?.length) cached = rqCached;
      if (!isSupabaseConfigured) return (cached?.length ? cached : STANDARD_LOTS);
      if (!(await isSupabaseSessionValid())) return (cached?.length ? cached : STANDARD_LOTS);
      if (!queueLoaded) return (cached?.length ? cached : STANDARD_LOTS);
      try {
        let q = ((supabase as any).from('lots') as any).select('*');
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (!data?.length) ? STANDARD_LOTS : data.map(toLot);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'lots');
        const merged = mergeWithCache<Lot>(fresh, cached, pendingIds, { queueLoaded });
        await writeCache(LOTS_CACHE_KEY, merged, userId);
        return merged.length > 0 ? merged : STANDARD_LOTS;
      } catch (err) {
        console.warn(`[useLots] fetch failed, using cache`, err);
        return (cached?.length ? cached : STANDARD_LOTS);
      }
    },
    enabled: !!user && user.role !== 'magasinier' && startupReady,
  });

  const persist = useCallback((lots: Lot[]) => {
    writeCache(LOTS_CACHE_KEY, lots, userId);
  }, [userId]);

  const addLot = useCallback(async (l: Lot) => {
    const orgId = user?.organizationId ?? null;
    const existing = queryClient.getQueryData<Lot[]>(queryKeys.lots()) ?? [];
    if (existing.some(x => x.name.trim().toLowerCase() === l.name.trim().toLowerCase())) {
      Alert.alert(
        i18n.t('syncAlerts.duplicateLotTitle'),
        i18n.t('syncAlerts.duplicateLotMessage', { name: l.name }),
      );
      return;
    }
    const newList = [...existing, l];
    queryClient.setQueryData<Lot[]>(queryKeys.lots(), newList);
    persist(newList);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'lots', op: 'insert', data: fromLot(l, orgId) });
      return;
    }
    if (isSupabaseConfigured) {
      const payload = fromLot(l, orgId);
      const { error } = await (supabase as any).from('lots').insert(payload);
      if (error) {
        console.warn('[sync] addLot error, queuing for retry:', error.message);
        enqueueOperation({ table: 'lots', op: 'insert', data: payload });
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const updateLot = useCallback(async (l: Lot) => {
    queryClient.setQueryData<Lot[]>(queryKeys.lots(), old =>
      (old ?? []).map(x => x.id === l.id ? l : x)
    );
    persist(queryClient.getQueryData<Lot[]>(queryKeys.lots()) ?? []);
    const orgId = user?.organizationId ?? null;
    const { id, organization_id, ...fields } = fromLot(l, orgId);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'lots', op: 'update', filter: { column: 'id', value: l.id }, data: fields });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('lots').update(fields).eq('id', l.id);
      if (error) {
        console.warn('[sync] updateLot error, queuing for retry:', error.message);
        enqueueOperation({ table: 'lots', op: 'update', filter: { column: 'id', value: l.id }, data: fields });
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const deleteLot = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Lot[]>(queryKeys.lots()) ?? [];
    const previous = prev.find(l => l.id === id);
    queryClient.setQueryData<Lot[]>(queryKeys.lots(), prev.filter(l => l.id !== id));
    persist(prev.filter(l => l.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'lots', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any).from('lots').delete().eq('id', id).select();
      if (error) {
        console.warn('[sync] deleteLot erreur serveur:', error.code, error.message);
        const isPermissionDenied = error.code === '42501' || /row-level security|permission denied/i.test(error.message ?? '');
        if (isPermissionDenied && previous) {
          queryClient.setQueryData<Lot[]>(queryKeys.lots(), old => [...(old ?? []), previous]);
          persist(queryClient.getQueryData<Lot[]>(queryKeys.lots()) ?? []);
          Alert.alert(i18n.t('syncAlerts.deleteDeniedTitle'), i18n.t('syncAlerts.deleteLotDenied'));
        } else {
          console.warn('[sync] deleteLot: erreur réseau/session, opération enqueued pour retry');
          enqueueOperation({ table: 'lots', op: 'delete', filter: { column: 'id', value: id } });
        }
      } else if (!deleted?.length) {
        console.warn('[sync] deleteLot: aucune ligne supprimée');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  return {
    lots: query.data ?? STANDARD_LOTS,
    isLoadingLots: query.isLoading,
    addLot,
    updateLot,
    deleteLot,
    invalidateLots: () => queryClient.invalidateQueries({ queryKey: queryKeys.lots() }),
  };
}
