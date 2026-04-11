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
import { offlineQuery, writeCache } from '@/lib/offlineCache';

const OPRS_CACHE_KEY = 'buildtrack_oprs_cache_v1';

export function useOprs() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const startupReady = useStartupDelay(!!user);

  const query = useQuery({
    queryKey: queryKeys.oprs(),
    queryFn: async (): Promise<Opr[]> => {
      const fetchFn = isSupabaseConfigured
        ? async () => {
            const { data, error } = await supabase.from('oprs').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            return (data ?? []).map(toOpr);
          }
        : null;
      return offlineQuery<Opr>(OPRS_CACHE_KEY, fetchFn);
    },
    enabled: !!user && startupReady,
    staleTime: 5 * 60 * 1000,
  });

  const persist = useCallback((oprs: Opr[]) => {
    writeCache(OPRS_CACHE_KEY, oprs);
  }, []);

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
      const { error } = await supabase.from('oprs').insert(fromOpr(o, orgId));
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
      supabase.from('oprs').update(fields).eq('id', o.id).then(({ error }: { error: any }) => {
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
      const { data: deleted, error } = await supabase.from('oprs').delete().eq('id', id).select();
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
