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
import { genId, formatDateFR, nowTimestampFR } from '@/lib/utils';
import { genReserveId } from '@/lib/reserveUtils';
import { getReserveDescriptionText } from '@/lib/reserveDescription';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import { isLocalUri, uploadLocalPhotosInPayload } from '@/lib/storage';
import { triggerReserveCreatedPush } from '@/lib/push/client';
import { RESERVES_CACHE_KEY } from '@/lib/cacheKeys';
import i18n from '@/lib/i18n';

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
      if (!rqCurrent?.length) return;
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
    const deadlineValue = !reserve.deadline || reserve.deadline === '—' ? null : reserve.deadline;
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
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
      return;
    }
    if (!isSupabaseConfigured) return;

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

    const rollback = () => {
      queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => (old ?? []).filter(x => x.id !== reserve.id));
      persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
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
    const deadlineValue = !reserve.deadline || reserve.deadline === '—' ? null : reserve.deadline;
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
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: reserve.id }, data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      // Upload local photos before updating the row (same rationale as in addReserve).
      const prep = await uploadLocalPhotosInPayload('reserves', payload);
      if (!prep.allOk) {
        console.warn('[sync] updateReserve: photo upload failed, queuing for later sync');
        enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: reserve.id }, data: payload });
        return;
      }
      if (prep.hadLocal && prep.data) applyUploadedPhotoPayload(reserve.id, prep.data);
      // Await the result so we can detect failures and queue a retry.
      // prep.data! already has remote photo URLs (file:// paths were uploaded
      // above), so the sync engine's upload step will be a no-op for those.
      const { error } = await (supabase as any).from('reserves').update(prep.data!).eq('id', reserve.id);
      if (error) {
        console.warn('[sync] updateReserve error, queuing for retry:', error.message);
        enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: reserve.id }, data: prep.data! });
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
            createdAt: nowTimestampFR(),
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
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: id }, data: deletePayload });
      return;
    }
    if (isSupabaseConfigured) {
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
          enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: id }, data: deletePayload });
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
          createdAt: nowTimestampFR(),
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
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: id }, data: payload });
      return;
    }
    if (isSupabaseConfigured) {
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
          enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: id }, data: payload });
        }
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

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
      id: genId(), action: i18n.t('syncAlerts.statusChangedAction'), author: actualAuthor, createdAt: nowTimestampFR(),
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
    return updateReserve(updated);
  }, [query.data, user, updateReserve]);

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
      id: genId(), action: 'Archivée', author: actualAuthor, createdAt: nowTimestampFR(),
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
      id: genId(), action: 'Désarchivée', author: actualAuthor, createdAt: nowTimestampFR(),
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
      createdAt: nowTimestampFR(),
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
      if (!isOnlineRef.current) {
        queueComment();
        return;
      }
      (supabase as any).from('reserves').update({ comments: updatedComments }).eq('id', reserveId)
        .then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] addComment error:', error.message);
            queueComment();
          }
        })
        .catch((error: any) => {
          console.warn('[sync] addComment error:', error?.message ?? error);
          queueComment();
        });
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
    const editedAt = nowTimestampFR();
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
      if (!isOnlineRef.current) {
        queueComment();
        return;
      }
      (supabase as any).from('reserves').update({ comments: updatedComments }).eq('id', reserveId)
        .then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] updateComment error:', error.message);
            queueComment();
          }
        })
        .catch((error: any) => {
          console.warn('[sync] updateComment error:', error?.message ?? error);
          queueComment();
        });
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
      if (!isOnlineRef.current) {
        queueComment();
        return;
      }
      (supabase as any).from('reserves').update({ comments: updatedComments }).eq('id', reserveId)
        .then(({ error }: { error: any }) => {
          if (error) {
            console.warn('[sync] deleteComment error:', error.message);
            queueComment();
          }
        })
        .catch((error: any) => {
          console.warn('[sync] deleteComment error:', error?.message ?? error);
          queueComment();
        });
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
          id: genId(), action: 'Statut modifié (lot)', author: actualAuthor, createdAt: nowTimestampFR(),
          oldValue: statusLabels[reserve.status], newValue: statusLabels[updates.status],
        });
      }
      const newCompanies = updates.companies ?? (updates.company ? [updates.company] : undefined);
      const oldCompanies = reserve.companies ?? (reserve.company ? [reserve.company] : []);
      if (newCompanies && JSON.stringify(newCompanies) !== JSON.stringify(oldCompanies)) {
        historyEntries.push({
          id: genId(), action: 'Entreprises modifiées (lot)', author: actualAuthor, createdAt: nowTimestampFR(),
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
        status: r.status,
        company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? '',
        companies: r.companies ?? (r.company ? [r.company] : []),
        deadline: (!r.deadline || r.deadline === '\u2014') ? null : r.deadline,
        priority: r.priority,
        history: r.history,
        closed_at: r.closedAt ?? null,
        closed_by: r.closedBy ?? null,
      });
      const queueReserve = (r: Reserve) => enqueueOperation({
        table: 'reserves',
        op: 'update',
        filter: { column: 'id', value: r.id },
        data: payloadFor(r),
      });
      if (!isOnlineRef.current) {
        updated.forEach(queueReserve);
        return;
      }
      Promise.all(updated.map(r =>
        (supabase as any).from('reserves').update({
          status: r.status,
          company: (r.companies ?? (r.company ? [r.company] : []))[0] ?? '',
          companies: r.companies ?? (r.company ? [r.company] : []),
          deadline: (!r.deadline || r.deadline === '—') ? null : r.deadline,
          priority: r.priority, history: r.history,
          closed_at: r.closedAt ?? null, closed_by: r.closedBy ?? null,
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
