import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toLot, fromLot } from '@/lib/mappers';
import { Lot } from '@/constants/types';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const LOTS_CACHE_KEY = 'buildtrack_lots_cache_v1';

export const STANDARD_LOTS: Lot[] = [
  { id: 'lot-00', code: '00', name: 'VRD / Terrassement', color: '#78716C', cctpRef: 'CCTP Titre I — Travaux préparatoires' },
  { id: 'lot-01', code: '01', name: 'Gros œuvre / Maçonnerie', color: '#3B82F6', cctpRef: 'CCTP Titre II — Lot 01 GO' },
  { id: 'lot-02', code: '02', name: 'Charpente / Couverture', color: '#8B5CF6', cctpRef: 'CCTP Titre II — Lot 02 Charpente' },
  { id: 'lot-03', code: '03', name: 'Étanchéité', color: '#06B6D4', cctpRef: 'CCTP Titre II — Lot 03 Étanchéité' },
  { id: 'lot-04', code: '04', name: 'Menuiseries extérieures', color: '#F59E0B', cctpRef: 'CCTP Titre III — Lot 04 ME' },
  { id: 'lot-05', code: '05', name: 'Menuiseries intérieures', color: '#D97706', cctpRef: 'CCTP Titre III — Lot 05 MI' },
  { id: 'lot-06', code: '06', name: 'Isolation thermique / Doublage', color: '#10B981', cctpRef: 'CCTP Titre III — Lot 06 ITE' },
  { id: 'lot-07', code: '07', name: 'Plâtrerie / Cloisons sèches', color: '#EC4899', cctpRef: 'CCTP Titre III — Lot 07 Plâtrerie' },
  { id: 'lot-08', code: '08', name: 'Carrelage / Revêtements sols', color: '#EF4444', cctpRef: 'CCTP Titre III — Lot 08 Carrelage' },
  { id: 'lot-09', code: '09', name: 'Peinture / Finitions', color: '#6366F1', cctpRef: 'CCTP Titre III — Lot 09 Peinture' },
  { id: 'lot-10', code: '10', name: 'Plomberie / Sanitaire', color: '#0EA5E9', cctpRef: 'CCTP Titre IV — Lot 10 Plomberie' },
  { id: 'lot-11', code: '11', name: 'Chauffage / VMC / Climatisation', color: '#F97316', cctpRef: 'CCTP Titre IV — Lot 11 CVC' },
  { id: 'lot-12', code: '12', name: 'Électricité / Courants forts', color: '#FBBF24', cctpRef: 'CCTP Titre IV — Lot 12 CF' },
  { id: 'lot-13', code: '13', name: 'Courants faibles / Réseaux', color: '#A78BFA', cctpRef: 'CCTP Titre IV — Lot 13 CFa' },
  { id: 'lot-14', code: '14', name: 'Ascenseurs / Élévateurs', color: '#34D399', cctpRef: 'CCTP Titre V — Lot 14 Ascenseurs' },
  { id: 'lot-15', code: '15', name: 'Espaces verts / Aménagements ext.', color: '#22C55E', cctpRef: 'CCTP Titre VI — Lot 15 VRD ext.' },
  { id: 'lot-16', code: '16', name: 'Sécurité incendie / SSI', color: '#F43F5E', cctpRef: 'CCTP Titre V — Lot 16 SSI' },
];

export function useLots() {
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
    queryKey: queryKeys.lots(),
    queryFn: async (): Promise<Lot[]> => {
      let cached = await readCache<Lot>(LOTS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Lot[]>(queryKeys.lots());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(l => l.id));
        const extra = rqCached.filter(l => !cachedIds.has(l.id));
        if (extra.length) cached = [...cached, ...extra];
      }
      if (!isSupabaseConfigured) return (cached?.length ? cached : STANDARD_LOTS);
      if (!(await isSupabaseSessionValid())) return (cached?.length ? cached : STANDARD_LOTS);
      try {
        let q = ((supabase as any).from('lots') as any).select('*');
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (!data?.length) ? STANDARD_LOTS : data.map(toLot);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'lots');
        const merged = mergeWithCache<Lot>(fresh, cached, pendingIds);
        await writeCache(LOTS_CACHE_KEY, merged, userId);
        return merged.length > 0 ? merged : STANDARD_LOTS;
      } catch (err) {
        console.warn(`[useLots] fetch failed, using cache`, err);
        return (cached?.length ? cached : STANDARD_LOTS);
      }
    },
    enabled: !!user && startupReady,
    staleTime: 10 * 60 * 1000,
  });

  const persist = useCallback((lots: Lot[]) => {
    writeCache(LOTS_CACHE_KEY, lots, userId);
  }, [userId]);

  const addLot = useCallback(async (l: Lot) => {
    const orgId = user?.organizationId ?? null;
    const existing = queryClient.getQueryData<Lot[]>(queryKeys.lots()) ?? [];
    if (existing.some(x => x.name.trim().toLowerCase() === l.name.trim().toLowerCase())) {
      Alert.alert('Lot existant', `Un lot nommé "${l.name}" existe déjà.`);
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
      const { error } = await (supabase as any).from('lots').insert(fromLot(l, orgId));
      if (error) console.warn('[sync] addLot error:', error.message);
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
      (supabase as any).from('lots').update(fields).eq('id', l.id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] updateLot error:', error.message);
      });
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
        console.warn('[sync] deleteLot erreur serveur:', error.message);
        if (previous) {
          queryClient.setQueryData<Lot[]>(queryKeys.lots(), old => [...(old ?? []), previous]);
          Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer ce lot, ou il n\'existe plus sur le serveur.');
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
