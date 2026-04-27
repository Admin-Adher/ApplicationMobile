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
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import { uploadLocalPhotosInPayload } from '@/lib/storage';

const PHOTOS_CACHE_KEY = 'buildtrack_photos_cache_v1';

export function usePhotos() {
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
    queryKey: queryKeys.photos(),
    queryFn: async (): Promise<Photo[]> => {
      // Read manual AsyncStorage cache first so offline-created photos can be displayed instantly.
      let cached = await readCache<Photo>(PHOTOS_CACHE_KEY, userId);

      // Also read RQ in-memory cache (restored by PersistQueryClientProvider on app restart).
      const rqCached = queryClient.getQueryData<Photo[]>(queryKeys.photos());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(p => p.id));
        const extra = rqCached.filter(p => !cachedIds.has(p.id));
        if (extra.length) cached = [...cached, ...extra];
      }

      // No backend (mock mode)
      if (!isSupabaseConfigured) {
        return cached ?? [];
      }
      if (!(await isSupabaseSessionValid())) return cached ?? [];

      // Try online fetch; merge with cache to keep local-only (offline-created) items.
      try {
        let q = ((supabase as any).from('photos') as any).select('*').order('taken_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map(toPhoto);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'photos');
        const merged = mergeWithCache<Photo>(fresh, cached, pendingIds);
        await writeCache(PHOTOS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        // If fetch fails (offline), fall back to cache.
        console.warn(`[usePhotos] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user && startupReady,
  });

  const persist = useCallback((photos: Photo[]) => {
    writeCache(PHOTOS_CACHE_KEY, photos, userId);
  }, [userId]);

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
      // Upload the local file to Supabase Storage first; if that fails,
      // queue the row for a later sync attempt instead of pushing a broken
      // local URI into the photos table.
      const prep = await uploadLocalPhotosInPayload('photos', payload);
      if (!prep.allOk) {
        console.warn('[sync] addPhoto: upload failed, queuing for later sync');
        enqueueOperation({ table: 'photos', op: 'insert', data: payload });
        return;
      }
      const { error } = await (supabase as any).from('photos').insert(prep.data!);
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
      (supabase as any).from('photos').delete().eq('id', id).then(({ error }: { error: any }) => {
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
