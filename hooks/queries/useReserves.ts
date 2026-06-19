import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toReserve } from '@/lib/mappers';
import { Reserve, ReserveStatus, Comment } from '@/constants/types';
import { genId } from '@/lib/utils';
import { genReserveId, toIsoDeadline } from '@/lib/reserveUtils';
import { getReserveDescriptionText } from '@/lib/reserveDescription';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import { isLocalUri, uploadLocalPhotosInPayload } from '@/lib/storage';
import { triggerReserveCreatedPush } from '@/lib/push/client';
import { RESERVES_CACHE_KEY } from '@/lib/cacheKeys';
import i18n from '@/lib/i18n';
import {
  appendReserveStatusEventOperation,
  applyReservePatchOperation,
  firstReserveMutationResult,
  isReserveMutationRpcUnavailable,
  newOperationId,
  type ReserveStatusEventPayload,
} from '@/lib/reserveOutbox';

const RESERVE_PATCH_DEDICATED_FIELDS = [
  'status',
  'closed_at',
  'closed_by',
  'comments',
  'photos',
  'photo_uri',
  'photo_annotations',
  'company_signatures',
] as const;

function reservePatchForVersionedRpc(payload: Record<string, any>): Record<string, any> {
  const patch = { ...payload };
  for (const key of RESERVE_PATCH_DEDICATED_FIELDS) {
    delete patch[key];
  }
  return patch;
}

function hasPatchFields(payload: Record<string, any>): boolean {
  return Object.keys(payload).length > 0;
}

function photoPatchFromPayload(payload: Record<string, any>): Record<string, any> | null {
  const patch: Record<string, any> = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'photo_uri')) {
    patch.photo_uri = payload.photo_uri ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'photos')) {
    patch.photos = payload.photos ?? null;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function pendingReserveDeletionPayloads(queue: any[] | undefined | null): Map<string, any> {
  const payloads = new Map<string, any>();
  for (const op of queue ?? []) {
    if (op?.table !== 'reserves' || op?.filter?.column !== 'id' || !op.filter.value) continue;
    if (op.op === 'delete' || (op.op === 'update' && op.data?.deleted_at)) {
      payloads.set(String(op.filter.value), op.data ?? {});
    }
  }
  return payloads;
}

function reservePhotoRowsForRpc(source: Record<string, any>, reserve: Reserve, author?: string | null) {
  const photos = Array.isArray(source.photos) ? source.photos : [];
  const rows: any[] = [];
  const seen = new Set<string>();
  const location = [`Bat. ${reserve.building || source.building || ''}`, reserve.level || source.level, reserve.zone || source.zone]
    .filter(Boolean)
    .join(' - ');

  for (const photo of photos) {
    const uri = typeof photo?.uri === 'string' ? photo.uri : '';
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    rows.push({
      id: photo.id ? `photo-row-${reserve.id}-${photo.id}` : `photo-row-${reserve.id}-${rows.length + 1}`,
      comment: reserve.kind === 'observation'
        ? `Photo observation ${reserve.id} - ${reserve.title}`
        : `Photo reserve ${reserve.id} - ${reserve.title}`,
      location,
      taken_at: photo.takenAt ?? reserve.createdAt ?? source.created_at,
      taken_by: photo.takenBy ?? author ?? 'BuildTrack',
      color_code: reserve.kind === 'observation' ? '#0EA5E9' : '#EF4444',
      uri,
    });
  }

  const legacyUri = typeof source.photo_uri === 'string' ? source.photo_uri : '';
  if (legacyUri && !seen.has(legacyUri)) {
    rows.push({
      id: `photo-row-${reserve.id}-legacy`,
      comment: reserve.kind === 'observation'
        ? `Photo observation ${reserve.id} - ${reserve.title}`
        : `Photo reserve ${reserve.id} - ${reserve.title}`,
      location,
      taken_at: reserve.createdAt ?? source.created_at,
      taken_by: author ?? 'BuildTrack',
      color_code: reserve.kind === 'observation' ? '#0EA5E9' : '#EF4444',
      uri: legacyUri,
    });
  }

  return rows;
}

function createReserveWithPhotosRpcArgs(source: Record<string, any>, reserve: Reserve, author?: string | null) {
  return {
    p_reserve: source,
    p_photo_rows: reservePhotoRowsForRpc(source, reserve, author),
  };
}

export function useReserves() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // ── On mount: clean stale ghost items from the RQ persisted cache ──────────
  // The RQ persisted cache (restored by PersistQueryClientProvider on startup)
  // can contain items that were already deleted — because the app was closed
  // before the 1-second throttled save completed after a deleteReserve().
  // The manual AsyncStorage cache (RESERVES_CACHE_KEY) is always written
  // synchronously on every mutation, so it is the ground truth.
  // We compare both on mount and drop any ghost items from the RQ cache
  // BEFORE the queryFn fires — this eliminates the startup flash entirely.
  useEffect(() => {
    if (!userId) return;
    readCache<Reserve>(RESERVES_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Reserve[]>(queryKeys.reserves());
      if (!rqCurrent?.length) {
        queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), manualCached);
        return;
      }
      const manualIds = new Set(manualCached.map(r => r.id));
      const hasGhosts = rqCurrent.some(r => !manualIds.has(r.id));
      if (hasGhosts) {
        queryClient.setQueryData<Reserve[]>(
          queryKeys.reserves(),
          rqCurrent.filter(r => manualIds.has(r.id)),
        );
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const query = useQuery({
    queryKey: queryKeys.reserves(),
    queryFn: async (): Promise<Reserve[]> => {
      // Read manual AsyncStorage cache first so offline-created reserves can be displayed instantly.
      // This cache is written synchronously on every mutation (add, update, delete)
      // so it is always the ground truth for locally-known state.
      let cached = await readCache<Reserve>(RESERVES_CACHE_KEY, userId);

      // Use the RQ in-memory cache ONLY as a fallback when the manual cache is
      // completely empty (first install, cache cleared by the OS, etc.).
      // We do NOT merge individual items from rqCached back into the manual cache
      // when the manual cache already has data — that would resurrect items that
      // were correctly deleted via deleteReserve() → persist(), creating a cycle
      // where server-deleted rows re-appear on every restart.
      const rqCached = queryClient.getQueryData<Reserve[]>(queryKeys.reserves());
      if (!cached && rqCached?.length) cached = rqCached;

      // No backend (mock mode)
      if (!isSupabaseConfigured) {
        return cached ?? [];
      }

      // Don't fetch with a missing/expired JWT — Supabase returns [] under
      // RLS, which would silently overwrite the local cache.
      if (!(await isSupabaseSessionValid())) return cached ?? [];

      // Don't fetch until the offline queue has been hydrated. Otherwise an
      // empty fetch (RLS denied, network blip) combined with an empty queue
      // would wipe the local cache before the queue is loaded.
      if (!queueLoaded) return cached ?? [];

      // Try online fetch; merge with cache to keep local-only (offline-created) items.
      try {
        let q = ((supabase as any).from('reserves') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const currentQueue = queueRef.current ?? [];
        const pendingDeletePayloads = pendingReserveDeletionPayloads(currentQueue);
        const fresh = ((data ?? []).map(toReserve) as Reserve[])
          .map(reserve => {
            const pendingDelete = pendingDeletePayloads.get(reserve.id);
            if (!pendingDelete) return reserve;
            return {
              ...reserve,
              deletedAt: reserve.deletedAt ?? pendingDelete.deleted_at ?? new Date().toISOString(),
              deletedBy: reserve.deletedBy ?? pendingDelete.deleted_by ?? i18n.t('common.system'),
              history: Array.isArray(pendingDelete.history) ? pendingDelete.history : reserve.history,
            };
          });
        const pendingIds = pendingIdsForTable(currentQueue, 'reserves');
        const merged = mergeWithCache<Reserve>(fresh, cached, pendingIds, { queueLoaded });
        await writeCache(RESERVES_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        // If fetch fails (offline), fall back to cache.
        console.warn(`[useReserves] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user,
  });

  const persist = useCallback((reserves: Reserve[]) => {
    writeCache(RESERVES_CACHE_KEY, reserves, userId);
  }, [userId]);

  const applyUploadedPhotoPayload = useCallback((reserveId: string, uploadedData: Record<string, any>) => {
    if (!Object.prototype.hasOwnProperty.call(uploadedData, 'photo_uri')
      && !Object.prototype.hasOwnProperty.call(uploadedData, 'photos')) {
      return;
    }

    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(reserve => {
        if (reserve.id !== reserveId) return reserve;
        return {
          ...reserve,
          photoUri: Object.prototype.hasOwnProperty.call(uploadedData, 'photo_uri')
            ? (uploadedData.photo_uri ?? undefined)
            : reserve.photoUri,
          photos: Object.prototype.hasOwnProperty.call(uploadedData, 'photos')
            ? (Array.isArray(uploadedData.photos) && uploadedData.photos.length > 0
              ? uploadedData.photos
              : undefined)
            : reserve.photos,
        };
      })
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
  }, [queryClient, persist]);

  const addReserve = useCallback(async (r: Reserve) => {
    const orgId = user?.organizationId ?? null;
    const reserve: Reserve = {
      ...r,
      title: r.title.trim(),
      description: getReserveDescriptionText(r.description, r.title, ''),
    };
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => {
      if ((old ?? []).some(x => x.id === reserve.id)) return old ?? [];
      return [reserve, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    // Fix 16: derive companies first, then company from companies[0] for consistency
    const companies = reserve.companies ?? (reserve.company ? [reserve.company] : []);
    const deadlineValue = !reserve.deadline || reserve.deadline === '—' ? null : toIsoDeadline(reserve.deadline);
    const buildPayload = (orgIdValue: string | null) => ({
      id: reserve.id, title: reserve.title,
      description: reserve.description ?? '',
      building: reserve.building ?? '',
      zone: reserve.zone ?? '',
      level: reserve.level ?? '',
      company: companies[0] ?? '',
      companies,
      priority: reserve.priority, status: reserve.status, created_at: reserve.createdAt, deadline: deadlineValue,
      comments: reserve.comments ?? [], history: reserve.history ?? [],
      plan_x: reserve.planX ?? null, plan_y: reserve.planY ?? null,
      photo_uri: reserve.photoUri ?? null, lot_id: reserve.lotId ?? null, kind: reserve.kind ?? null,
      chantier_id: reserve.chantierId ?? null, plan_id: reserve.planId ?? null,
      building_id: reserve.buildingId ?? null, level_id: reserve.levelId ?? null,
      visite_id: reserve.visiteId ?? null, linked_task_id: reserve.linkedTaskId ?? null,
      photos: reserve.photos ?? null, photo_annotations: reserve.photoAnnotations ?? null,
      enterprise_signature: reserve.enterpriseSignature ?? null,
      enterprise_signataire: reserve.enterpriseSignataire ?? null,
      enterprise_acknowledged_at: reserve.enterpriseAcknowledgedAt ?? null,
      company_signatures: reserve.companySignatures ?? null,
      organization_id: orgIdValue,
    });
    const payload = buildPayload(orgId);
    if (isSupabaseConfigured) {
      // Keep creation local-first: the form returns once the cache is persisted,
      // while NetworkContext owns uploads, RPC replay, retries, and push.
      enqueueOperation({
        table: 'reserves',
        op: 'rpc',
        rpc: {
          fn: 'create_reserve_with_photos',
          args: createReserveWithPhotosRpcArgs(payload, reserve, user?.name),
        },
        data: payload,
      });
    }
    return reserve;

    const queueAtomicCreate = (sourcePayload: Record<string, any>) => enqueueOperation({
      table: 'reserves',
      op: 'rpc',
      rpc: {
        fn: 'create_reserve_with_photos',
        args: createReserveWithPhotosRpcArgs(sourcePayload, reserve, user?.name),
      },
      data: sourcePayload,
    });

    if (!isOnlineRef.current && isSupabaseConfigured) {
      queueAtomicCreate(payload);
      return;
    }
    if (!isSupabaseConfigured) return;

    const rollback = () => {
      queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => (old ?? []).filter(x => x.id !== reserve.id));
      persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    };

    const prep = await uploadLocalPhotosInPayload('reserves', payload);
    if (!prep.allOk) {
      console.warn('[sync] addReserve: photo upload failed before atomic create, queuing full reserve:', prep.uploadErrors.join(' | '));
      queueAtomicCreate(payload);
      return reserve;
    }

    const atomicPayload = prep.data ?? payload;
    if (prep.hadLocal) {
      applyUploadedPhotoPayload(reserve.id, {
        photo_uri: atomicPayload.photo_uri ?? null,
        photos: Array.isArray(atomicPayload.photos) && atomicPayload.photos.length > 0 ? atomicPayload.photos : null,
      });
    }

    const { error: atomicError } = await (supabase as any).rpc(
      'create_reserve_with_photos',
      createReserveWithPhotosRpcArgs(atomicPayload, reserve, user?.name),
    );
    if (!atomicError) {
      triggerReserveCreatedPush(reserve.id);
      return {
        ...reserve,
        photoUri: atomicPayload.photo_uri ?? undefined,
        photos: Array.isArray(atomicPayload.photos) && atomicPayload.photos.length > 0 ? atomicPayload.photos : undefined,
        photoRowsCreated: true,
      } as any;
    }

    console.warn('[sync] addReserve atomic server error:', atomicError.code, atomicError.message, '(org sent:', orgId, ', role:', user?.role, ')');
    const atomicRlsError = (atomicError.code === '42501') || /row-level security/i.test(atomicError.message ?? '');
    if (atomicRlsError) {
      try {
        const { data: { session } } = await (supabase as any).auth.getSession();
        const { data: freshProfile, error: profileErr } = session?.user?.id
          ? await (supabase as any)
              .from('profiles')
              .select('organization_id, role')
              .eq('id', session.user.id)
              .single()
          : { data: null, error: { message: 'no-session' } };

        if (!profileErr && freshProfile) {
          const freshOrgId = freshProfile.organization_id ?? null;
          const freshRole = freshProfile.role ?? null;
          const allowedRoles = ['admin', 'conducteur', 'chef_equipe', 'super_admin'];
          if (!allowedRoles.includes(freshRole)) {
            rollback();
            Alert.alert(
              i18n.t('syncAlerts.permissionDeniedTitle'),
              i18n.t('syncAlerts.reserveCreateRoleDenied', { role: freshRole ?? i18n.t('common.unknown') }),
            );
            return;
          }
          if (!freshOrgId) {
            rollback();
            Alert.alert(
              i18n.t('syncAlerts.incompleteProfileTitle'),
              i18n.t('syncAlerts.reserveCreateNoOrg'),
            );
            return;
          }
          if (freshOrgId !== orgId) {
            const retryPayload: Record<string, any> = { ...atomicPayload, organization_id: freshOrgId };
            const { error: retryError } = await (supabase as any).rpc(
              'create_reserve_with_photos',
              createReserveWithPhotosRpcArgs(retryPayload, reserve, user?.name),
            );
            if (!retryError) {
              triggerReserveCreatedPush(reserve.id);
              return {
                ...reserve,
                photoUri: retryPayload.photo_uri ?? undefined,
                photos: Array.isArray(retryPayload.photos) && retryPayload.photos.length > 0 ? retryPayload.photos : undefined,
                photoRowsCreated: true,
              } as any;
            }
            queueAtomicCreate(retryPayload);
            return reserve;
          }
        }
      } catch (diagErr: any) {
        console.warn('[sync] addReserve atomic diagnostic failed, queuing:', diagErr?.message);
      }
    }

    queueAtomicCreate(atomicPayload);
    return reserve;

    const splitReservePayload = (source: Record<string, any>) => {
      const rowPayload = { ...source };
      let hasLocalPhoto = false;

      if (typeof rowPayload.photo_uri === 'string' && isLocalUri(rowPayload.photo_uri)) {
        hasLocalPhoto = true;
        rowPayload.photo_uri = null;
      }

      if (Array.isArray(rowPayload.photos)) {
        const remotePhotos = rowPayload.photos.filter((photo: any) => !photo?.uri || !isLocalUri(photo.uri));
        hasLocalPhoto = hasLocalPhoto || remotePhotos.length !== rowPayload.photos.length;
        rowPayload.photos = remotePhotos.length > 0 ? remotePhotos : null;
        if (!rowPayload.photo_uri && remotePhotos[0]?.uri) rowPayload.photo_uri = remotePhotos[0].uri;
      }

      return {
        rowPayload,
        photoPayload: hasLocalPhoto
          ? {
              photo_uri: source.photo_uri ?? null,
              photos: source.photos ?? null,
            }
          : null,
      };
    };

    const { rowPayload, photoPayload } = splitReservePayload(payload);
    const finalPayload = rowPayload;

    const syncPhotosAfterReserveRow = async (reserveId: string, rawPhotoPayload: Record<string, any> | null) => {
      if (!rawPhotoPayload) return reserve;

      const prep = await uploadLocalPhotosInPayload('reserves', rawPhotoPayload);
      if (!prep.allOk) {
        const errDetail = prep.uploadErrors?.join(' | ') ?? 'Echec upload photo. Nouvelle tentative au prochain passage.';
        console.warn('[sync] addReserve: reserve row saved, photo upload deferred:', errDetail);
        enqueueOperation({
          table: 'reserves',
          op: 'update',
          filter: { column: 'id', value: reserveId },
          data: rawPhotoPayload,
          photoPatch: {
            action: 'upsert',
            photos: Array.isArray(rawPhotoPayload.photos) ? rawPhotoPayload.photos : undefined,
            photoUri: typeof rawPhotoPayload.photo_uri === 'string' ? rawPhotoPayload.photo_uri : null,
          },
        });
        return reserve;
      }

      const photoUpdate = {
        photo_uri: prep.data?.photo_uri ?? null,
        photos: Array.isArray(prep.data?.photos) && prep.data.photos.length > 0 ? prep.data.photos : null,
      };
      if (prep.hadLocal) applyUploadedPhotoPayload(reserveId, photoUpdate);

      const { error: photoError } = await (supabase as any)
        .from('reserves')
        .update(photoUpdate)
        .eq('id', reserveId);
      if (photoError) {
        console.warn('[sync] addReserve: reserve row saved, photo patch queued:', photoError.message);
        enqueueOperation({
          table: 'reserves',
          op: 'update',
          filter: { column: 'id', value: reserveId },
          data: photoUpdate,
          photoPatch: {
            action: 'upsert',
            photos: Array.isArray(photoUpdate.photos) ? photoUpdate.photos : undefined,
            photoUri: typeof photoUpdate.photo_uri === 'string' ? photoUpdate.photo_uri : null,
          },
        });
      }

      return {
        ...reserve,
        photoUri: photoUpdate.photo_uri ?? undefined,
        photos: photoUpdate.photos ?? undefined,
      };
    };

    const { error } = await (supabase as any).from('reserves').insert(finalPayload);
    if (!error) {
      triggerReserveCreatedPush(reserve.id);
      return syncPhotosAfterReserveRow(reserve.id, photoPayload);
    }

    console.warn('[sync] addReserve server error:', error.code, error.message, '(org sent:', orgId, ', role:', user?.role, ')');

    const isRlsError = (error.code === '42501') || /row-level security/i.test(error.message ?? '');
    if (isRlsError) {
      // Most likely causes:
      //   1. Expired JWT that couldn't be refreshed while offline — the device
      //      appeared online (false-positive ping) but Supabase rejected the token.
      //   2. Stale local organization_id in the profile — retry with fresh value.
      //
      // Critical rule: NEVER call rollback() for connectivity/session issues.
      // Rolling back deletes the local optimistic copy → data loss.
      // Instead, queue the operation so it syncs when connectivity is restored.
      try {
        const { data: { session } } = await (supabase as any).auth.getSession();
        if (!session?.user?.id) {
          // No active session — could be truly signed out, or device is offline
          // and couldn't reach the auth server. Queue to be safe; the sync engine
          // will surface the error clearly if the session is genuinely expired.
          console.warn('[sync] addReserve: no session during RLS diagnosis, queuing for later sync');
          enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
          return;
        }
        const { data: freshProfile, error: profileErr } = await (supabase as any)
          .from('profiles')
          .select('organization_id, role')
          .eq('id', session.user.id)
          .single();

        if (profileErr) {
          // Profile fetch failed — almost certainly a network error while offline.
          // Queue the insert; do not discard the local copy.
          console.warn('[sync] addReserve: profile fetch failed during RLS diagnosis, queuing:', profileErr?.message);
          enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
          return;
        }

        const freshOrgId = freshProfile?.organization_id ?? null;
        const freshRole = freshProfile?.role ?? null;
        const allowedRoles = ['admin', 'conducteur', 'chef_equipe', 'super_admin'];

        if (!allowedRoles.includes(freshRole)) {
          // Server confirmed the user's role genuinely forbids creating reserves.
          rollback();
          Alert.alert(
            i18n.t('syncAlerts.permissionDeniedTitle'),
            i18n.t('syncAlerts.reserveCreateRoleDenied', { role: freshRole ?? i18n.t('common.unknown') }),
          );
          return;
        }
        if (!freshOrgId) {
          // Server confirmed the profile has no organisation.
          rollback();
          Alert.alert(
            i18n.t('syncAlerts.incompleteProfileTitle'),
            i18n.t('syncAlerts.reserveCreateNoOrg'),
          );
          return;
        }
        if (freshOrgId !== orgId) {
          // Stale local org id — retry with the fresh value (reuse the
          // photo fields are replayed separately after the durable row exists.
          console.warn('[sync] addReserve retry with fresh organization_id:', freshOrgId, '(was:', orgId, ')');
          const retryPayload = { ...payload, organization_id: freshOrgId };
          const retrySplit = splitReservePayload(retryPayload);
          const { error: retryErr } = await (supabase as any).from('reserves').insert(retrySplit.rowPayload);
          if (!retryErr) {
            triggerReserveCreatedPush(reserve.id);
            return syncPhotosAfterReserveRow(reserve.id, retrySplit.photoPayload);
          }
          // Retry also failed: queue with the corrected org_id so it syncs later.
          console.warn('[sync] addReserve retry also failed, queuing:', retryErr.code, retryErr.message);
          enqueueOperation({ table: 'reserves', op: 'insert', data: retryPayload });
          return;
        }
        // Fresh org_id matches what we sent — RLS still rejected. The JWT in the
        // request didn't carry the right claims (common when the token expired
        // mid-session and couldn't be refreshed offline). Queue for later sync.
        console.warn('[sync] addReserve: RLS rejected with correct org_id, queuing for session recovery');
        enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
      } catch (diagErr: any) {
        // Any exception here is a network error (device offline, timeout, etc.).
        // Queue the insert so it retries when connectivity is restored.
        console.warn('[sync] addReserve diagnostic failed (likely offline), queuing:', diagErr?.message);
        enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
      }
      return;
    }

    // Non-RLS server error (constraint violation, DB error, etc.): keep local
    // copy AND queue the insert so it retries automatically when connectivity
    // is restored. Do not rollback — user data must never be silently lost.
    console.warn('[sync] addReserve non-RLS error, queuing for retry:', error.message);
    enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist, applyUploadedPhotoPayload]);

  const updateReserve = useCallback(async (r: Reserve) => {
    const reserve: Reserve = {
      ...r,
      title: r.title.trim(),
      description: getReserveDescriptionText(r.description, r.title, ''),
    };
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(x => x.id === reserve.id ? reserve : x)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    // Fix 16: derive companies first, then company from companies[0] for consistency
    const companies = reserve.companies ?? (reserve.company ? [reserve.company] : []);
    const deadlineValue = !reserve.deadline || reserve.deadline === '—' ? null : toIsoDeadline(reserve.deadline);
    const payload = {
      title: reserve.title,
      description: reserve.description ?? '',
      building: reserve.building ?? '',
      zone: reserve.zone ?? '',
      level: reserve.level ?? '',
      company: companies[0] ?? '',
      companies,
      priority: reserve.priority, status: reserve.status, deadline: deadlineValue,
      comments: reserve.comments ?? [], history: reserve.history ?? [],
      plan_x: reserve.planX ?? null, plan_y: reserve.planY ?? null,
      photo_uri: reserve.photoUri ?? null, lot_id: reserve.lotId ?? null, kind: reserve.kind ?? null,
      chantier_id: reserve.chantierId ?? null, plan_id: reserve.planId ?? null,
      building_id: reserve.buildingId ?? null, level_id: reserve.levelId ?? null,
      visite_id: reserve.visiteId ?? null, linked_task_id: reserve.linkedTaskId ?? null,
      photos: reserve.photos ?? null, photo_annotations: reserve.photoAnnotations ?? null,
      enterprise_signature: reserve.enterpriseSignature ?? null,
      enterprise_signataire: reserve.enterpriseSignataire ?? null,
      enterprise_acknowledged_at: reserve.enterpriseAcknowledgedAt ?? null,
      company_signatures: reserve.companySignatures ?? null,
      closed_at: reserve.closedAt ?? null, closed_by: reserve.closedBy ?? null,
      archived_at: reserve.archivedAt ?? null, archived_by: reserve.archivedBy ?? null,
      deleted_at: reserve.deletedAt ?? null, deleted_by: reserve.deletedBy ?? null,
    };
    const queuePatch = (patch: Record<string, any>) => {
      const versioned = typeof reserve.version === 'number';
      const scalarPatch = versioned ? reservePatchForVersionedRpc(patch) : patch;
      if (hasPatchFields(scalarPatch)) {
        enqueueOperation({
          table: 'reserves',
          op: 'update',
          filter: { column: 'id', value: reserve.id },
          data: scalarPatch,
          baseVersion: reserve.version ?? null,
        });
      }
      const photoPatch = versioned ? photoPatchFromPayload(patch) : null;
      if (photoPatch) {
        enqueueOperation({
          table: 'reserves',
          op: 'update',
          filter: { column: 'id', value: reserve.id },
          data: photoPatch,
          photoPatch: {
            action: 'upsert',
            photos: Array.isArray(photoPatch.photos) ? photoPatch.photos : undefined,
            photoUri: typeof photoPatch.photo_uri === 'string' ? photoPatch.photo_uri : null,
          },
        });
      }
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      queuePatch(payload);
      return;
    }
    if (isSupabaseConfigured) {
      // Upload local photos before updating the row (same rationale as in addReserve).
      const prep = await uploadLocalPhotosInPayload('reserves', payload);
      if (!prep.allOk) {
        console.warn('[sync] updateReserve: photo upload failed, queuing for later sync');
        queuePatch(payload);
        return;
      }
      if (prep.hadLocal && prep.data) applyUploadedPhotoPayload(reserve.id, prep.data);
      if (typeof reserve.version === 'number') {
        const scalarPatch = reservePatchForVersionedRpc(prep.data!);
        const photoPatch = photoPatchFromPayload(prep.data!);
        const rpcResult = await applyReservePatchOperation({
          operationId: newOperationId(),
          reserveId: reserve.id,
          baseVersion: reserve.version,
          patch: scalarPatch,
        });
        const outcome = firstReserveMutationResult(rpcResult.data);
        if (!rpcResult.error && (!outcome || outcome.status === 'ok')) {
          if (typeof outcome?.version === 'number') {
            queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
              (old ?? []).map(x => x.id === reserve.id ? { ...x, version: outcome.version } : x)
            );
            persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
          }
          if (photoPatch) {
            enqueueOperation({
              table: 'reserves',
              op: 'update',
              filter: { column: 'id', value: reserve.id },
              data: photoPatch,
              photoPatch: {
                action: 'upsert',
                photos: Array.isArray(photoPatch.photos) ? photoPatch.photos : undefined,
                photoUri: typeof photoPatch.photo_uri === 'string' ? photoPatch.photo_uri : null,
              },
            });
          }
          return;
        }
        if (!rpcResult.error || !isReserveMutationRpcUnavailable(rpcResult.error)) {
          console.warn('[sync] updateReserve RPC result, queuing for attention:', outcome?.status ?? rpcResult.error?.message);
          queuePatch(prep.data!);
          return;
        }
      }
      // Await the result so we can detect failures and queue a retry.
      // prep.data! already has remote photo URLs (file:// paths were uploaded
      // above), so the sync engine's upload step will be a no-op for those.
      const { error } = await (supabase as any).from('reserves').update(prep.data!).eq('id', reserve.id);
      if (error) {
        console.warn('[sync] updateReserve error, queuing for retry:', error.message);
        queuePatch(prep.data!);
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist, applyUploadedPhotoPayload]);

  const updateReserveFields = useCallback(async (r: Reserve) => {
    return updateReserve(r);
  }, [updateReserve]);

  const deleteReserve = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const previous = prev.find(r => r.id === id);
    const deletedAt = new Date().toISOString();
    const deletedBy = user?.name ?? i18n.t('common.system');
    const deletedHistory = previous
      ? [
          ...(previous.history ?? []),
          {
            id: genId(),
            action: 'Supprimee (corbeille)',
            author: deletedBy,
            createdAt: new Date().toISOString(),
            oldValue: 'Active',
            newValue: 'Corbeille',
          },
        ]
      : undefined;
    const deletePayload = {
      deleted_at: deletedAt,
      deleted_by: deletedBy,
      ...(deletedHistory ? { history: deletedHistory } : {}),
    };
    const softDeleted = previous
      ? {
          ...previous,
          deletedAt,
          deletedBy,
          history: deletedHistory ?? previous.history,
        }
      : undefined;
    const next = softDeleted
      ? prev.map(r => r.id === id ? softDeleted : r)
      : prev.filter(r => r.id !== id);
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), next);
    persist(next);
    const queueDelete = () => enqueueOperation({
      table: 'reserves',
      op: 'update',
      filter: { column: 'id', value: id },
      data: deletePayload,
      baseVersion: previous?.version ?? null,
    });
    if (!isOnlineRef.current && isSupabaseConfigured) {
      queueDelete();
      return;
    }
    if (isSupabaseConfigured) {
      if (typeof previous?.version === 'number') {
        const rpcResult = await applyReservePatchOperation({
          operationId: newOperationId(),
          reserveId: id,
          baseVersion: previous.version,
          patch: deletePayload,
        });
        const outcome = firstReserveMutationResult(rpcResult.data);
        if (!rpcResult.error && (!outcome || outcome.status === 'ok' || outcome.status === 'not_found')) {
          return;
        }
        if (!rpcResult.error || !isReserveMutationRpcUnavailable(rpcResult.error)) {
          if (outcome?.status === 'forbidden' && previous) {
            queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => {
              const cur = old ?? [];
              if (cur.some(r => r.id === previous.id)) {
                return cur.map(r => r.id === previous.id ? previous : r);
              }
              return [previous, ...cur];
            });
            persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
            Alert.alert(i18n.t('syncAlerts.deleteDeniedTitle'), i18n.t('syncAlerts.deleteReserveDenied'));
            return;
          }
          queueDelete();
          return;
        }
      }
      const { data: deleted, error } = await (supabase as any)
        .from('reserves')
        .update(deletePayload)
        .eq('id', id)
        .select('id');
      if (error) {
        console.warn('[sync] deleteReserve erreur serveur:', error.code, error.message);
        // Distinguish a genuine permission denial (42501 / RLS) from a
        // network or session error. Only roll back for real server rejections —
        // for everything else, keep the local deletion and queue a retry so the
        // server catches up when connectivity/auth is restored.
        const isPermissionDenied =
          error.code === '42501' ||
          /row-level security|permission denied/i.test(error.message ?? '');
        if (isPermissionDenied && previous) {
          queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => {
            const cur = old ?? [];
            if (cur.some(r => r.id === previous.id)) {
              return cur.map(r => r.id === previous.id ? previous : r);
            }
            return [previous, ...cur];
          });
          persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
          Alert.alert(i18n.t('syncAlerts.deleteDeniedTitle'), i18n.t('syncAlerts.deleteReserveDenied'));
        } else {
          // Network / session error: local deletion is already applied and persisted.
          // Queue the delete so the sync engine retries it when connectivity is restored.
          console.warn('[sync] deleteReserve: erreur réseau/session, opération enqueued pour retry');
          queueDelete();
        }
      } else if (!deleted?.length) {
        // If the row doesn't exist server-side (ex: never synced), keep local deletion.
        console.warn('[sync] deleteReserve: aucune ligne supprimée (probablement déjà supprimée ou jamais synchronisée)');
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const restoreReserve = useCallback(async (id: string, author?: string) => {
    const prev = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const previous = prev.find(r => r.id === id);
    if (!previous || !previous.deletedAt) return;
    const actualAuthor = author ?? user?.name ?? i18n.t('common.system');
    const restored: Reserve = {
      ...previous,
      deletedAt: undefined,
      deletedBy: undefined,
      history: [
        ...(previous.history ?? []),
        {
          id: genId(),
          action: 'Restaurée depuis la corbeille',
          author: actualAuthor,
          createdAt: new Date().toISOString(),
          oldValue: 'Corbeille',
          newValue: 'Active',
        },
      ],
    };
    const payload = {
      deleted_at: null,
      deleted_by: null,
      history: restored.history,
    };
    const next = prev.map(r => r.id === id ? restored : r);
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), next);
    persist(next);
    const queueRestore = () => enqueueOperation({
      table: 'reserves',
      op: 'update',
      filter: { column: 'id', value: id },
      data: payload,
      baseVersion: previous.version ?? null,
    });
    if (!isOnlineRef.current && isSupabaseConfigured) {
      queueRestore();
      return;
    }
    if (isSupabaseConfigured) {
      if (typeof previous.version === 'number') {
        const rpcResult = await applyReservePatchOperation({
          operationId: newOperationId(),
          reserveId: id,
          baseVersion: previous.version,
          patch: payload,
        });
        const outcome = firstReserveMutationResult(rpcResult.data);
        if (!rpcResult.error && (!outcome || outcome.status === 'ok')) {
          return;
        }
        if (!rpcResult.error || !isReserveMutationRpcUnavailable(rpcResult.error)) {
          if (outcome?.status === 'forbidden') {
            queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), prev);
            persist(prev);
            Alert.alert(i18n.t('syncAlerts.permissionDeniedTitle'), i18n.t('syncAlerts.deleteReserveDenied'));
            return;
          }
          queueRestore();
          return;
        }
      }
      const { error } = await (supabase as any).from('reserves').update(payload).eq('id', id);
      if (error) {
        console.warn('[sync] restoreReserve error:', error.code, error.message);
        const isPermissionDenied =
          error.code === '42501' ||
          /row-level security|permission denied/i.test(error.message ?? '');
        if (isPermissionDenied) {
          queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), prev);
          persist(prev);
          Alert.alert(i18n.t('syncAlerts.permissionDeniedTitle'), i18n.t('syncAlerts.deleteReserveDenied'));
        } else {
          queueRestore();
        }
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const permanentlyDeleteReserve = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const previous = prev.find(r => r.id === id);
    if (!previous) return;

    if (!isOnlineRef.current && isSupabaseConfigured) {
      Alert.alert(
        i18n.t('syncAlerts.permissionDeniedTitle'),
        i18n.t('syncAlerts.permanentDeleteRequiresServer'),
      );
      return;
    }

    const next = prev.filter(r => r.id !== id);
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), next);
    persist(next);

    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any)
        .from('reserves')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) {
        console.warn('[sync] permanentlyDeleteReserve error:', error.code, error.message);
        queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), prev);
        persist(prev);
        Alert.alert(
          i18n.t('syncAlerts.permissionDeniedTitle'),
          error.message ?? i18n.t('syncAlerts.permanentDeleteServerDenied'),
        );
      } else if (!deleted?.length) {
        console.warn('[sync] permanentlyDeleteReserve: aucune ligne supprimee (probablement deja absente cote serveur)');
      }
    }
  }, [queryClient, isOnlineRef, persist]);

  // Fix 11: use query.data instead of queryClient.getQueryData for fresher reactive data
  const updateReserveStatus = useCallback(async (id: string, status: ReserveStatus, author?: string) => {
    const reserves = query.data ?? [];
    const reserve = reserves.find(r => r.id === id);
    if (!reserve) return;
    const actualAuthor = author ?? user?.name ?? i18n.t('common.system');
    const now = new Date().toISOString().split('T')[0];
    const statusLabels: Record<string, string> = {
      open: i18n.t('reserveLabels.status.open'),
      in_progress: i18n.t('reserveLabels.status.in_progress'),
      waiting: i18n.t('reserveLabels.status.waiting'),
      verification: i18n.t('reserveLabels.status.verification'),
      closed: i18n.t('reserveLabels.status.closed'),
    };
    const historyEntry = {
      id: genId(), action: i18n.t('syncAlerts.statusChangedAction'), author: actualAuthor, createdAt: new Date().toISOString(),
      oldValue: statusLabels[reserve.status], newValue: statusLabels[status],
    };
    const isClosing = status === 'closed' && reserve.status !== 'closed';
    const isReopening = status !== 'closed' && reserve.status === 'closed';
    const updated: Reserve = {
      ...reserve, status,
      history: [...reserve.history, historyEntry],
      closedAt: isClosing ? now : isReopening ? undefined : reserve.closedAt,
      closedBy: isClosing ? actualAuthor : isReopening ? undefined : reserve.closedBy,
    };
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(x => x.id === id ? updated : x)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);

    const event: ReserveStatusEventPayload = {
      id: newOperationId(),
      reserve_id: id,
      from_status: reserve.status,
      to_status: status,
      actor_id: user?.id ?? null,
      actor_name: actualAuthor,
      occurred_at: new Date().toISOString(),
      reason: historyEntry.action,
      history_entry: historyEntry,
      closed_at: updated.closedAt ?? null,
      closed_by: updated.closedBy ?? null,
    };
    const fallbackPayload = {
      status,
      history: updated.history,
      closed_at: updated.closedAt ?? null,
      closed_by: updated.closedBy ?? null,
    };
    const queueStatusEvent = () => enqueueOperation({
      table: 'reserves',
      op: 'rpc',
      filter: { column: 'id', value: id },
      rpc: { fn: 'append_reserve_status_event', args: { p_event: event } },
      data: fallbackPayload,
      baseVersion: reserve.version ?? null,
    });

    if (!isSupabaseConfigured) return;
    if (!isOnlineRef.current) {
      queueStatusEvent();
      return;
    }

    const rpcResult = await appendReserveStatusEventOperation({
      operationId: newOperationId(),
      event,
    });
    const outcome = firstReserveMutationResult(rpcResult.data);
    if (!rpcResult.error && (!outcome || outcome.status === 'ok')) {
      if (typeof outcome?.version === 'number') {
        queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
          (old ?? []).map(x => x.id === id ? { ...x, version: outcome.version } : x)
        );
        persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
      }
      return;
    }
    if (rpcResult.error && isReserveMutationRpcUnavailable(rpcResult.error)) {
      return updateReserve(updated);
    }
    console.warn('[sync] updateReserveStatus RPC result, queuing:', outcome?.status ?? rpcResult.error?.message);
    queueStatusEvent();
  }, [query.data, user, queryClient, persist, enqueueOperation, updateReserve]);

  // Archive / désarchive : action distincte du changement de statut.
  // Une réserve archivée garde son statut métier (ouverte, en cours, clôturée…)
  // mais est masquée du plan et de la liste des réserves actives. Elle reste
  // consultable via le toggle "Voir les archives".
  const archiveReserve = useCallback(async (id: string, author?: string) => {
    const reserves = query.data ?? [];
    const reserve = reserves.find(r => r.id === id);
    if (!reserve || reserve.archivedAt) return;
    const actualAuthor = author ?? user?.name ?? 'Système';
    const now = new Date().toISOString();
    const today = now.split('T')[0];
    const historyEntry = {
      id: genId(), action: 'Archivée', author: actualAuthor, createdAt: new Date().toISOString(),
      oldValue: 'Active', newValue: 'Archivée',
    };
    const updated: Reserve = {
      ...reserve,
      archivedAt: now,
      archivedBy: actualAuthor,
      history: [...reserve.history, historyEntry],
    };
    return updateReserve(updated);
  }, [query.data, user, updateReserve]);

  const unarchiveReserve = useCallback(async (id: string, author?: string) => {
    const reserves = query.data ?? [];
    const reserve = reserves.find(r => r.id === id);
    if (!reserve || !reserve.archivedAt) return;
    const actualAuthor = author ?? user?.name ?? 'Système';
    const today = new Date().toISOString().split('T')[0];
    const historyEntry = {
      id: genId(), action: 'Désarchivée', author: actualAuthor, createdAt: new Date().toISOString(),
      oldValue: 'Archivée', newValue: 'Active',
    };
    const updated: Reserve = {
      ...reserve,
      archivedAt: undefined,
      archivedBy: undefined,
      history: [...reserve.history, historyEntry],
    };
    return updateReserve(updated);
  }, [query.data, user, updateReserve]);

  const addComment = useCallback(async (reserveId: string, content: string, author?: string) => {
    // IMPORTANT : lire depuis queryClient.getQueryData (live cache) et non depuis
    // query.data (qui peut être stale dans le closure du useCallback). Sinon, après
    // une suppression de commentaire, l'ajout suivant repart de l'ancienne liste
    // et fait "réapparaître" le commentaire supprimé.
    const reserves = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const reserve = reserves.find(r => r.id === reserveId);
    if (!reserve) return;
    const comment: Comment = {
      id: genId(), content, author: author ?? user?.name ?? 'Inconnu',
      authorId: user?.id,
      createdAt: new Date().toISOString(),
    };
    const updatedComments = [...reserve.comments, comment];
    const updated: Reserve = { ...reserve, comments: updatedComments };
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(r => r.id === reserveId ? updated : r)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    const queueComment = () => enqueueOperation({
      table: 'reserves',
      op: 'update',
      filter: { column: 'id', value: reserveId },
      commentPatch: { action: 'add', comment },
    });
    if (isSupabaseConfigured) {
      queueComment();
    }
  }, [queryClient, user, persist, enqueueOperation]);

  const updateComment = useCallback(async (reserveId: string, commentId: string, newContent: string) => {
    const reserves = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const reserve = reserves.find(r => r.id === reserveId);
    if (!reserve) return;
    const target = reserve.comments.find(c => c.id === commentId);
    if (!target) return;
    const isOwner = (target.authorId && user?.id && target.authorId === user.id) ||
                    (!target.authorId && target.author === user?.name);
    if (!isOwner) return;
    const editedAt = new Date().toISOString();
    const updatedComments = reserve.comments.map(c =>
      c.id === commentId ? { ...c, content: newContent, editedAt } : c
    );
    const updated: Reserve = { ...reserve, comments: updatedComments };
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(r => r.id === reserveId ? updated : r)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    const queueComment = () => enqueueOperation({
      table: 'reserves',
      op: 'update',
      filter: { column: 'id', value: reserveId },
      commentPatch: { action: 'edit', commentId, newContent, editedAt },
    });
    if (isSupabaseConfigured) {
      queueComment();
    }
  }, [queryClient, user, persist, enqueueOperation]);

  const deleteComment = useCallback(async (reserveId: string, commentId: string) => {
    const reserves = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const reserve = reserves.find(r => r.id === reserveId);
    if (!reserve) return;
    const target = reserve.comments.find(c => c.id === commentId);
    if (!target) return;
    const isOwner = (target.authorId && user?.id && target.authorId === user.id) ||
                    (!target.authorId && target.author === user?.name);
    if (!isOwner) return;
    const updatedComments = reserve.comments.filter(c => c.id !== commentId);
    const updated: Reserve = { ...reserve, comments: updatedComments };
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(r => r.id === reserveId ? updated : r)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    const queueComment = () => enqueueOperation({
      table: 'reserves',
      op: 'update',
      filter: { column: 'id', value: reserveId },
      commentPatch: { action: 'delete', commentId },
    });
    if (isSupabaseConfigured) {
      queueComment();
    }
  }, [queryClient, user, persist, enqueueOperation]);

  const batchUpdateReserves = useCallback(async (
    ids: string[],
    updates: Partial<Pick<Reserve, 'status' | 'company' | 'companies' | 'deadline' | 'priority'>>,
    author?: string
  ) => {
    const actualAuthor = author ?? user?.name ?? 'Système';
    const statusLabels: Record<string, string> = {
      open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
      verification: 'Vérification', closed: 'Clôturé',
    };
    const now = new Date().toISOString().split('T')[0];
    const reserves = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const updated: Reserve[] = [];
    for (const id of ids) {
      const reserve = reserves.find(r => r.id === id);
      if (!reserve) continue;
      const historyEntries: typeof reserve.history = [];
      if (updates.status && updates.status !== reserve.status) {
        historyEntries.push({
          id: genId(), action: 'Statut modifié (lot)', author: actualAuthor, createdAt: new Date().toISOString(),
          oldValue: statusLabels[reserve.status], newValue: statusLabels[updates.status],
        });
      }
      const newCompanies = updates.companies ?? (updates.company ? [updates.company] : undefined);
      const oldCompanies = reserve.companies ?? (reserve.company ? [reserve.company] : []);
      if (newCompanies && JSON.stringify(newCompanies) !== JSON.stringify(oldCompanies)) {
        historyEntries.push({
          id: genId(), action: 'Entreprises modifiées (lot)', author: actualAuthor, createdAt: new Date().toISOString(),
          oldValue: oldCompanies.join(', '), newValue: newCompanies.join(', '),
        });
      }
      const isClosing = updates.status === 'closed' && reserve.status !== 'closed';
      const isReopening = !!updates.status && updates.status !== 'closed' && reserve.status === 'closed';
      const r: Reserve = {
        ...reserve, ...updates,
        companies: newCompanies ?? oldCompanies,
        company: (newCompanies ?? oldCompanies)[0] ?? reserve.company,
        history: [...reserve.history, ...historyEntries],
        closedAt: isClosing ? now : isReopening ? undefined : reserve.closedAt,
        closedBy: isClosing ? actualAuthor : isReopening ? undefined : reserve.closedBy,
      };
      updated.push(r);
    }
    const updatedMap = new Map(updated.map(r => [r.id, r]));
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(r => updatedMap.has(r.id) ? updatedMap.get(r.id)! : r)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    if (isSupabaseConfigured) {
      const payloadFor = (r: Reserve) => ({
        company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? '',
        companies: r.companies ?? (r.company ? [r.company] : []),
        deadline: (!r.deadline || r.deadline === '\u2014') ? null : toIsoDeadline(r.deadline),
        priority: r.priority,
        history: r.history,
      });
      const previousFor = (r: Reserve) => reserves.find(source => source.id === r.id);
      const queueReserve = (r: Reserve) => {
        const previous = previousFor(r);
        const payload = payloadFor(r);
        enqueueOperation({
          table: 'reserves',
          op: 'update',
          filter: { column: 'id', value: r.id },
          data: typeof previous?.version === 'number' ? reservePatchForVersionedRpc(payload) : payload,
          baseVersion: previous?.version ?? null,
        });
      };
      const queueStatusEvent = (r: Reserve) => {
        const previous = previousFor(r);
        if (!previous || !updates.status || previous.status === r.status) return;
        const historyEntry = r.history
          .slice()
          .reverse()
          .find(entry => entry.action === 'Statut modifié (lot)' && entry.newValue === statusLabels[r.status]);
        const event: ReserveStatusEventPayload = {
          id: newOperationId(),
          reserve_id: r.id,
          from_status: previous.status,
          to_status: r.status,
          actor_id: user?.id ?? null,
          actor_name: actualAuthor,
          occurred_at: new Date().toISOString(),
          reason: historyEntry?.action ?? 'Statut modifié (lot)',
          history_entry: historyEntry,
          closed_at: r.closedAt ?? null,
          closed_by: r.closedBy ?? null,
        };
        enqueueOperation({
          table: 'reserves',
          op: 'rpc',
          filter: { column: 'id', value: r.id },
          rpc: { fn: 'append_reserve_status_event', args: { p_event: event } },
          data: {
            status: r.status,
            history: r.history,
            closed_at: r.closedAt ?? null,
            closed_by: r.closedBy ?? null,
          },
          baseVersion: previous.version ?? null,
        });
      };
      if (!isOnlineRef.current) {
        updated.forEach(queueReserve);
        updated.forEach(queueStatusEvent);
        return;
      }
      if (updated.some(r => typeof previousFor(r)?.version === 'number')) {
        updated.forEach(queueReserve);
        updated.forEach(queueStatusEvent);
        return;
      }
      updated.forEach(queueStatusEvent);
      Promise.all(updated.map(r =>
        (supabase as any).from('reserves').update({
          company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? '',
          companies: r.companies ?? (r.company ? [r.company] : []),
          deadline: (!r.deadline || r.deadline === '—') ? null : toIsoDeadline(r.deadline),
          priority: r.priority, history: r.history,
        }).eq('id', r.id)
      )).then(results => {
        const failed = results
          .map((res: any, index: number) => ({ error: res.error, reserve: updated[index] }))
          .filter((res: any) => res.error);
        if (failed.length) {
          console.warn('[sync] batchUpdateReserves errors:', failed.map((res: any) => res.error?.message).join('; '));
          failed.forEach((res: any) => queueReserve(res.reserve));
        }
      }).catch((error: any) => {
        console.warn('[sync] batchUpdateReserves error:', error?.message ?? error);
        updated.forEach(queueReserve);
      });
    }
  }, [queryClient, user, persist, enqueueOperation]);

  return {
    reserves: query.data ?? [],
    isLoadingReserves: query.isLoading,
    addReserve,
    updateReserve,
    updateReserveFields,
    deleteReserve,
    restoreReserve,
    permanentlyDeleteReserve,
    updateReserveStatus,
    archiveReserve,
    unarchiveReserve,
    addComment,
    updateComment,
    deleteComment,
    batchUpdateReserves,
    invalidateReserves: () => queryClient.invalidateQueries({ queryKey: queryKeys.reserves() }),
  };
}
