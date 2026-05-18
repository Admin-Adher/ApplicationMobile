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
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import { uploadLocalPhotosInPayload } from '@/lib/storage';

const RESERVES_CACHE_KEY = 'buildtrack_reserves_cache_v1';

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
        const fresh = (data ?? []).map(toReserve);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'reserves');
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
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => {
      if ((old ?? []).some(x => x.id === r.id)) return old ?? [];
      return [r, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    // Fix 16: derive companies first, then company from companies[0] for consistency
    const companies = r.companies ?? (r.company ? [r.company] : []);
    const deadlineValue = !r.deadline || r.deadline === '—' ? null : r.deadline;
    const buildPayload = (orgIdValue: string | null) => ({
      id: r.id, title: r.title,
      description: r.description ?? '',
      building: r.building ?? '',
      zone: r.zone ?? '',
      level: r.level ?? '',
      company: companies[0] ?? '',
      companies,
      priority: r.priority, status: r.status, created_at: r.createdAt, deadline: deadlineValue,
      comments: r.comments ?? [], history: r.history ?? [],
      plan_x: r.planX ?? 50, plan_y: r.planY ?? 50,
      photo_uri: r.photoUri ?? null, lot_id: r.lotId ?? null, kind: r.kind ?? null,
      chantier_id: r.chantierId ?? null, plan_id: r.planId ?? null,
      building_id: r.buildingId ?? null, level_id: r.levelId ?? null,
      visite_id: r.visiteId ?? null, linked_task_id: r.linkedTaskId ?? null,
      photos: r.photos ?? null, photo_annotations: r.photoAnnotations ?? null,
      enterprise_signature: r.enterpriseSignature ?? null,
      enterprise_signataire: r.enterpriseSignataire ?? null,
      enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
      company_signatures: r.companySignatures ?? null,
      organization_id: orgIdValue,
    });
    const payload = buildPayload(orgId);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
      return;
    }
    if (!isSupabaseConfigured) return;

    // Upload any local photo URIs BEFORE inserting the row, so we never
    // ship a `file://` path to Supabase. If even one upload fails we fall
    // back to the offline queue, which retries the whole thing later.
    const prep = await uploadLocalPhotosInPayload('reserves', payload);
    if (!prep.allOk) {
      console.warn('[sync] addReserve: photo upload failed, queuing for later sync');
      enqueueOperation({ table: 'reserves', op: 'insert', data: payload });
      return;
    }
    const finalPayload = prep.data!;
    if (prep.hadLocal) applyUploadedPhotoPayload(r.id, finalPayload);

    const rollback = () => {
      queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => (old ?? []).filter(x => x.id !== r.id));
      persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    };

    const { error } = await (supabase as any).from('reserves').insert(finalPayload);
    if (!error) return;

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
          enqueueOperation({ table: 'reserves', op: 'insert', data: finalPayload });
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
          enqueueOperation({ table: 'reserves', op: 'insert', data: finalPayload });
          return;
        }

        const freshOrgId = freshProfile?.organization_id ?? null;
        const freshRole = freshProfile?.role ?? null;
        const allowedRoles = ['admin', 'conducteur', 'chef_equipe', 'super_admin'];

        if (!allowedRoles.includes(freshRole)) {
          // Server confirmed the user's role genuinely forbids creating reserves.
          rollback();
          Alert.alert(
            'Permission refusée',
            `Votre rôle actuel (${freshRole ?? 'inconnu'}) ne permet pas de créer des réserves. Contactez votre administrateur.`
          );
          return;
        }
        if (!freshOrgId) {
          // Server confirmed the profile has no organisation.
          rollback();
          Alert.alert(
            'Profil incomplet',
            "Votre compte n'est pas rattaché à une organisation. Contactez votre administrateur ou utilisez le lien d'invitation."
          );
          return;
        }
        if (freshOrgId !== orgId) {
          // Stale local org id — retry with the fresh value (reuse the
          // already-uploaded photo URLs from finalPayload, no need to re-upload).
          console.warn('[sync] addReserve retry with fresh organization_id:', freshOrgId, '(was:', orgId, ')');
          const { error: retryErr } = await (supabase as any).from('reserves').insert({ ...finalPayload, organization_id: freshOrgId });
          if (!retryErr) return;
          // Retry also failed: queue with the corrected org_id so it syncs later.
          console.warn('[sync] addReserve retry also failed, queuing:', retryErr.code, retryErr.message);
          enqueueOperation({ table: 'reserves', op: 'insert', data: { ...finalPayload, organization_id: freshOrgId } });
          return;
        }
        // Fresh org_id matches what we sent — RLS still rejected. The JWT in the
        // request didn't carry the right claims (common when the token expired
        // mid-session and couldn't be refreshed offline). Queue for later sync.
        console.warn('[sync] addReserve: RLS rejected with correct org_id, queuing for session recovery');
        enqueueOperation({ table: 'reserves', op: 'insert', data: finalPayload });
      } catch (diagErr: any) {
        // Any exception here is a network error (device offline, timeout, etc.).
        // Queue the insert so it retries when connectivity is restored.
        console.warn('[sync] addReserve diagnostic failed (likely offline), queuing:', diagErr?.message);
        enqueueOperation({ table: 'reserves', op: 'insert', data: finalPayload });
      }
      return;
    }

    // Non-RLS server error (constraint violation, DB error, etc.): keep local
    // copy AND queue the insert so it retries automatically when connectivity
    // is restored. Do not rollback — user data must never be silently lost.
    console.warn('[sync] addReserve non-RLS error, queuing for retry:', error.message);
    enqueueOperation({ table: 'reserves', op: 'insert', data: finalPayload });
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist, applyUploadedPhotoPayload]);

  const updateReserve = useCallback(async (r: Reserve) => {
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(x => x.id === r.id ? r : x)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    // Fix 16: derive companies first, then company from companies[0] for consistency
    const companies = r.companies ?? (r.company ? [r.company] : []);
    const deadlineValue = !r.deadline || r.deadline === '—' ? null : r.deadline;
    const payload = {
      title: r.title,
      description: r.description ?? '',
      building: r.building ?? '',
      zone: r.zone ?? '',
      level: r.level ?? '',
      company: companies[0] ?? '',
      companies,
      priority: r.priority, status: r.status, deadline: deadlineValue,
      comments: r.comments ?? [], history: r.history ?? [],
      plan_x: r.planX ?? 50, plan_y: r.planY ?? 50,
      photo_uri: r.photoUri ?? null, lot_id: r.lotId ?? null, kind: r.kind ?? null,
      chantier_id: r.chantierId ?? null, plan_id: r.planId ?? null,
      building_id: r.buildingId ?? null, level_id: r.levelId ?? null,
      visite_id: r.visiteId ?? null, linked_task_id: r.linkedTaskId ?? null,
      photos: r.photos ?? null, photo_annotations: r.photoAnnotations ?? null,
      enterprise_signature: r.enterpriseSignature ?? null,
      enterprise_signataire: r.enterpriseSignataire ?? null,
      enterprise_acknowledged_at: r.enterpriseAcknowledgedAt ?? null,
      company_signatures: r.companySignatures ?? null,
      closed_at: r.closedAt ?? null, closed_by: r.closedBy ?? null,
      archived_at: r.archivedAt ?? null, archived_by: r.archivedBy ?? null,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: r.id }, data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      // Upload local photos before updating the row (same rationale as in addReserve).
      const prep = await uploadLocalPhotosInPayload('reserves', payload);
      if (!prep.allOk) {
        console.warn('[sync] updateReserve: photo upload failed, queuing for later sync');
        enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: r.id }, data: payload });
        return;
      }
      if (prep.hadLocal && prep.data) applyUploadedPhotoPayload(r.id, prep.data);
      // Await the result so we can detect failures and queue a retry.
      // prep.data! already has remote photo URLs (file:// paths were uploaded
      // above), so the sync engine's upload step will be a no-op for those.
      const { error } = await (supabase as any).from('reserves').update(prep.data!).eq('id', r.id);
      if (error) {
        console.warn('[sync] updateReserve error, queuing for retry:', error.message);
        enqueueOperation({ table: 'reserves', op: 'update', filter: { column: 'id', value: r.id }, data: prep.data! });
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist, applyUploadedPhotoPayload]);

  const updateReserveFields = useCallback(async (r: Reserve) => {
    return updateReserve(r);
  }, [updateReserve]);

  const deleteReserve = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [];
    const previous = prev.find(r => r.id === id);
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), prev.filter(r => r.id !== id));
    persist(prev.filter(r => r.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'reserves', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any).from('reserves').delete().eq('id', id).select();
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
            if (cur.some(r => r.id === previous.id)) return cur;
            return [previous, ...cur];
          });
          persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
          Alert.alert('Suppression refusée', "Vous n'avez pas les droits pour supprimer cette réserve, ou elle n'existe plus sur le serveur.");
        } else {
          // Network / session error: local deletion is already applied and persisted.
          // Queue the delete so the sync engine retries it when connectivity is restored.
          console.warn('[sync] deleteReserve: erreur réseau/session, opération enqueued pour retry');
          enqueueOperation({ table: 'reserves', op: 'delete', filter: { column: 'id', value: id } });
        }
      } else if (!deleted?.length) {
        // If the row doesn't exist server-side (ex: never synced), keep local deletion.
        console.warn('[sync] deleteReserve: aucune ligne supprimée (probablement déjà supprimée ou jamais synchronisée)');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  // Fix 11: use query.data instead of queryClient.getQueryData for fresher reactive data
  const updateReserveStatus = useCallback(async (id: string, status: ReserveStatus, author?: string) => {
    const reserves = query.data ?? [];
    const reserve = reserves.find(r => r.id === id);
    if (!reserve) return;
    const actualAuthor = author ?? user?.name ?? 'Système';
    const now = new Date().toISOString().split('T')[0];
    const statusLabels: Record<string, string> = {
      open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
      verification: 'Vérification', closed: 'Clôturé',
    };
    const historyEntry = {
      id: genId(), action: 'Statut modifié', author: actualAuthor, createdAt: nowTimestampFR(),
      oldValue: statusLabels[reserve.status], newValue: statusLabels[status],
    };
    const isClosing = status === 'closed' && reserve.status !== 'closed';
    const updated: Reserve = {
      ...reserve, status,
      history: [...reserve.history, historyEntry],
      closedAt: isClosing ? now : reserve.closedAt,
      closedBy: isClosing ? actualAuthor : reserve.closedBy,
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
      const r: Reserve = {
        ...reserve, ...updates,
        companies: newCompanies ?? oldCompanies,
        company: (newCompanies ?? oldCompanies)[0] ?? reserve.company,
        history: [...reserve.history, ...historyEntries],
        closedAt: isClosing ? now : reserve.closedAt,
        closedBy: isClosing ? actualAuthor : reserve.closedBy,
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
