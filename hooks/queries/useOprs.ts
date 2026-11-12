import * as Crypto from 'expo-crypto';
import { buildTerrainChanges, projectTerrainChanges, projectQueuedTerrainRows } from '@/lib/terrainPatch';
import { showAlert } from '@/lib/appAlert';
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
import i18n from '@/lib/i18n';

const OPRS_CACHE_KEY = 'buildtrack_oprs_cache_v1';

export function useOprs() {
  const { user, permissions } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, enqueueOperationDurable, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const startupReady = useStartupDelay(!!user);

  useEffect(() => {
    if (!userId) return;
    readCache<Opr>(OPRS_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Opr[]>(queryKeys.oprs());
      if (!rqCurrent?.length) return;
      const manualIds = new Set(manualCached.map(o => o.id));
      if (rqCurrent.some(o => !manualIds.has(o.id))) {
        queryClient.setQueryData<Opr[]>(queryKeys.oprs(), rqCurrent.filter(o => manualIds.has(o.id)));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const query = useQuery({
    queryKey: queryKeys.oprs(),
    queryFn: async (): Promise<Opr[]> => {
      let cached = await readCache<Opr>(OPRS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Opr[]>(queryKeys.oprs());
      if (!cached && rqCached?.length) cached = rqCached;
      if (!isSupabaseConfigured) return cached ?? [];
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];
      try {
        let q = ((supabase as any).from('oprs') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map(toOpr);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'oprs');
        const merged = projectQueuedTerrainRows(mergeWithCache<Opr>(fresh, cached, pendingIds, { queueLoaded }), 'oprs', queueRef.current, row => fromOpr(row, user!.organizationId), toOpr);
        await writeCache(OPRS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn(`[useOprs] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user && user.role !== 'magasinier' && startupReady,
  });

  const persist = useCallback((oprs: Opr[]) => {
    writeCache(OPRS_CACHE_KEY, oprs, userId);
  }, [userId]);

  const addOpr = useCallback(async (o: Opr) => {
    if (!permissions.canCreate) return;
    if (isSupabaseConfigured) enqueueOperation({ table: 'oprs', op: 'insert', data: fromOpr(o, user?.organizationId ?? null) }, { proveNeverStarted: true });
    queryClient.setQueryData<Opr[]>(queryKeys.oprs(), old => (old ?? []).some(row => row.id === o.id) ? old : [o, ...(old ?? [])]);
    persist(queryClient.getQueryData<Opr[]>(queryKeys.oprs()) ?? []);
  }, [queryClient, user, permissions.canCreate, enqueueOperation, persist]);

  const updateOpr = useCallback(async (next: Opr, previous: Opr) => {
    if (!permissions.canEdit || next.id !== previous.id) return;
    const orgId = user?.organizationId ?? null;
    const changes = buildTerrainChanges('oprs', fromOpr(previous, orgId), fromOpr(next, orgId));
    if (!changes.length) return;
    if (isSupabaseConfigured) {
      try {
        await enqueueOperationDurable({ table: 'oprs', op: 'rpc', data: { id: next.id }, rpc: {
          fn: 'apply_terrain_patch', args: { p_operation_id: Crypto.randomUUID(), p_table: 'oprs', p_id: next.id, p_changes: changes },
        } });
      } catch (error: any) {
        showAlert(i18n.t('common.error'), error?.message ?? 'Enregistrement local non confirmé.');
        return;
      }
    }
    queryClient.setQueryData<Opr[]>(queryKeys.oprs(), old => (old ?? []).map(row =>
      row.id === next.id ? toOpr(projectTerrainChanges(fromOpr(row, orgId), changes)) : row));
    persist(queryClient.getQueryData<Opr[]>(queryKeys.oprs()) ?? []);
  }, [queryClient, user, permissions.canEdit, enqueueOperationDurable, persist]);

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
        console.warn('[sync] deleteOpr erreur serveur:', error.code, error.message);
        const isPermissionDenied = error.code === '42501' || /row-level security|permission denied/i.test(error.message ?? '');
        if (isPermissionDenied && previous) {
          queryClient.setQueryData<Opr[]>(queryKeys.oprs(), old => [previous, ...(old ?? [])]);
          persist(queryClient.getQueryData<Opr[]>(queryKeys.oprs()) ?? []);
          Alert.alert(i18n.t('syncAlerts.deleteDeniedTitle'), i18n.t('syncAlerts.deleteOprDenied'));
        } else {
          console.warn('[sync] deleteOpr: erreur réseau/session, opération enqueued pour retry');
          enqueueOperation({ table: 'oprs', op: 'delete', filter: { column: 'id', value: id } });
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
