import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toPhoto } from '@/lib/mappers';
import { Photo } from '@/constants/types';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { mergeWithCache, readCache, writeCache } from '@/lib/offlineCache';

const PHOTOS_CACHE_KEY = 'buildtrack_photos_cache_v1';

export function usePhotos() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const startupReady = useStartupDelay(!!user);

  const query = useQuery({
    queryKey: queryKeys.photos(),
    queryFn: async (): Promise<Photo[]> => {
      // Read cache first so offline-created photos can be displayed instantly.
      const cached = await readCache<Photo>(PHOTOS_CACHE_KEY, userId);

      // No backend (mock mode)
      if (!isSupabaseConfigured) {
        return cached ?? [];
      }

      // Try online fetch; merge with cache to keep local-only (offline-created) items.
      try {
        const { data, error } = await supabase.from('photos').select('*').order('taken_at', { ascending: false });
        if (error) throw error;
        const fresh = (data ?? []).map(toPhoto);
        const merged = mergeWithCache<Photo>(fresh, cached);
        await writeCache(PHOTOS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        // If fetch fails (offline), fall back to cache.
        console.warn(`[usePhotos] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user && startupReady,
    staleTime: 5 * 60 * 1000,
  });

  const persist = useCallback((photos: Photo[]) => {
    writeCache(PHOTOS_CACHE_KEY, photos, userId);
  }, []);

  const addPhoto = useCallback(async (p: Photo) => {
    const orgId = user?.organizationId ?? null;
    queryClient.setQueryData<Photo[]>(queryKeys.photos(), old => {
      if ((old ?? []).some(x => x.id === p.id)) return old ?? [];
      return [p, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<Photo[]>(queryKeys.photos()) ?? []);
    const payload = {
      id: p.id, comment: p.comment, location: p.location,
      taken_at: p.takenAt, taken_by: p.takenBy, color_code: p.colorCode, uri: p.uri ?? null,
      reserve_id: p.reserveId ?? null, organization_id: orgId,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'photos', op: 'insert', data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('photos').insert(payload);
      if (error) {
        console.warn('[sync] addPhoto error:', error.message);
        Alert.alert('Synchronisation incomplète', `La photo a été sauvegardée localement mais n'a pas pu être synchronisée (${error.message}).`);
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const deletePhoto = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Photo[]>(queryKeys.photos()) ?? [];
    queryClient.setQueryData<Photo[]>(queryKeys.photos(), prev.filter(p => p.id !== id));
    persist(prev.filter(p => p.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'photos', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      supabase.from('photos').delete().eq('id', id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] deletePhoto error:', error.message);
      });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  return {
    photos: query.data ?? [],
    isLoadingPhotos: query.isLoading,
    addPhoto,
    deletePhoto,
    invalidatePhotos: () => queryClient.invalidateQueries({ queryKey: queryKeys.photos() }),
  };
}
