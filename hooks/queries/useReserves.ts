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
import { genId, formatDateFR } from '@/lib/utils';
import { genReserveId } from '@/lib/reserveUtils';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable } from '@/lib/offlineCache';

const RESERVES_CACHE_KEY = 'buildtrack_reserves_cache_v1';

export function useReserves() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, queue } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  const query = useQuery({
    queryKey: queryKeys.reserves(),
    queryFn: async (): Promise<Reserve[]> => {
      // Read manual AsyncStorage cache first so offline-created reserves can be displayed instantly.
      let cached = await readCache<Reserve>(RESERVES_CACHE_KEY, userId);

      // Also read RQ in-memory cache (restored by PersistQueryClientProvider on app restart).
      // If the manual cache is empty or was written with a stale userId, the RQ cache
      // may still contain the offline reserves — use it as a fallback source for merging.
      const rqCached = queryClient.getQueryData<Reserve[]>(queryKeys.reserves());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        // Merge both sources: items in rqCached but not in cached (e.g. written by stale persist)
        const cachedIds = new Set(cached.map(r => r.id));
        const extra = rqCached.filter(r => !cachedIds.has(r.id));
        if (extra.length) cached = [...cached, ...extra];
      }

      // No backend (mock mode)
      if (!isSupabaseConfigured) {
        return cached ?? [];
      }

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
        const merged = mergeWithCache<Reserve>(fresh, cached, pendingIds);
        await writeCache(RESERVES_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        // If fetch fails (offline), fall back to cache.
        console.warn(`[useReserves] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const persist = useCallback((reserves: Reserve[]) => {
    writeCache(RESERVES_CACHE_KEY, reserves, userId);
  }, [userId]);

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

    const rollback = () => {
      queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => (old ?? []).filter(x => x.id !== r.id));
      persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    };

    const { error } = await (supabase as any).from('reserves').insert(payload);
    if (!error) return;

    console.warn('[sync] addReserve server error:', error.code, error.message, '(org sent:', orgId, ', role:', user?.role, ')');

    const isRlsError = (error.code === '42501') || /row-level security/i.test(error.message ?? '');
    if (isRlsError) {
      // Most likely cause: stale local profile (organization_id) vs server profile.
      // Refetch the profile and retry once with the fresh organization_id.
      try {
        const { data: { session } } = await (supabase as any).auth.getSession();
        if (!session?.user?.id) {
          rollback();
          Alert.alert('Session expirée', 'Votre session a expiré. Reconnectez-vous pour créer une réserve.');
          return;
        }
        const { data: freshProfile } = await (supabase as any)
          .from('profiles')
          .select('organization_id, role')
          .eq('id', session.user.id)
          .single();
        const freshOrgId = freshProfile?.organization_id ?? null;
        const freshRole = freshProfile?.role ?? null;
        const allowedRoles = ['admin', 'conducteur', 'chef_equipe', 'super_admin'];

        if (!allowedRoles.includes(freshRole)) {
          rollback();
          Alert.alert(
            'Permission refusée',
            `Votre rôle actuel (${freshRole ?? 'inconnu'}) ne permet pas de créer des réserves. Contactez votre administrateur.`
          );
          return;
        }
        if (!freshOrgId) {
          rollback();
          Alert.alert(
            'Profil incomplet',
            "Votre compte n'est pas rattaché à une organisation. Contactez votre administrateur ou utilisez le lien d'invitation."
          );
          return;
        }
        if (freshOrgId !== orgId) {
          // Stale local org id — retry with the fresh value
          console.warn('[sync] addReserve retry with fresh organization_id:', freshOrgId, '(was:', orgId, ')');
          const { error: retryErr } = await (supabase as any).from('reserves').insert(buildPayload(freshOrgId));
          if (!retryErr) return;
          console.warn('[sync] addReserve retry also failed:', retryErr.code, retryErr.message);
          rollback();
          Alert.alert('Synchronisation impossible', `La réserve n'a pas pu être créée (${retryErr.message}). Reconnectez-vous puis réessayez.`);
          return;
        }
        // Fresh org_id matches what we sent — RLS still rejected. The server-side profile
        // and the row both have the same org but the policy still blocked. This usually means
        // the JWT in the request didn't include the right user. Force a session refresh.
        rollback();
        Alert.alert(
          'Synchronisation impossible',
          "Votre session est désynchronisée avec le serveur. Déconnectez-vous puis reconnectez-vous, puis réessayez."
        );
      } catch (diagErr: any) {
        console.warn('[sync] addReserve diagnostic failed:', diagErr?.message);
        rollback();
        Alert.alert('Synchronisation incomplète', `La réserve n'a pas pu être synchronisée (${error.message}).`);
      }
      return;
    }

    // Non-RLS error: keep local copy (so user doesn't lose their input) and tell them.
    Alert.alert('Synchronisation incomplète', `La réserve a été créée localement mais n'a pas pu être synchronisée (${error.message}).`);
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

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
      (supabase as any).from('reserves').update(payload).eq('id', r.id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] updateReserve error:', error.message);
      });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

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
        console.warn('[sync] deleteReserve erreur serveur:', error.message);
        if (previous) {
          queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => {
            const cur = old ?? [];
            if (cur.some(r => r.id === previous.id)) return cur;
            return [previous, ...cur];
          });
          persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
          Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette réserve, ou elle n\'existe plus sur le serveur.');
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
      id: genId(), action: 'Statut modifié', author: actualAuthor, createdAt: now,
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
      id: genId(), action: 'Archivée', author: actualAuthor, createdAt: today,
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
      id: genId(), action: 'Désarchivée', author: actualAuthor, createdAt: today,
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
    const reserves = query.data ?? [];
    const reserve = reserves.find(r => r.id === reserveId);
    if (!reserve) return;
    const comment: Comment = {
      id: genId(), content, author: author ?? user?.name ?? 'Inconnu',
      createdAt: new Date().toISOString().split('T')[0],
    };
    const updated: Reserve = { ...reserve, comments: [...reserve.comments, comment] };
    queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old =>
      (old ?? []).map(r => r.id === reserveId ? updated : r)
    );
    persist(queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? []);
    if (isSupabaseConfigured) {
      (supabase as any).from('reserves').update({ comments: updated.comments }).eq('id', reserveId)
        .then(({ error }: { error: any }) => {
          if (error) console.warn('[sync] addComment error:', error.message);
        });
    }
  }, [queryClient, user, persist]);

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
          id: genId(), action: 'Statut modifié (lot)', author: actualAuthor, createdAt: now,
          oldValue: statusLabels[reserve.status], newValue: statusLabels[updates.status],
        });
      }
      const newCompanies = updates.companies ?? (updates.company ? [updates.company] : undefined);
      const oldCompanies = reserve.companies ?? (reserve.company ? [reserve.company] : []);
      if (newCompanies && JSON.stringify(newCompanies) !== JSON.stringify(oldCompanies)) {
        historyEntries.push({
          id: genId(), action: 'Entreprises modifiées (lot)', author: actualAuthor, createdAt: now,
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
    if (isSupabaseConfigured) {
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
        if (results.some((res: any) => res.error)) console.warn('[sync] batchUpdateReserves some errors');
      });
    }
  }, [queryClient, user]);

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
    batchUpdateReserves,
    invalidateReserves: () => queryClient.invalidateQueries({ queryKey: queryKeys.reserves() }),
  };
}
