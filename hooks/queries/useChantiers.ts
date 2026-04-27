import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toChantier, toSitePlan } from '@/lib/mappers';
import { Chantier, SitePlan, Channel } from '@/constants/types';
import { uploadLocalPhotosInPayload } from '@/lib/storage';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const CHANTIERS_CACHE_KEY = 'buildtrack_chantiers_cache_v1';
const SITE_PLANS_CACHE_KEY = 'buildtrack_site_plans_cache_v1';

export function useChantiers() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation, queue } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const userId = user?.id;

  const chantiersQuery = useQuery({
    queryKey: queryKeys.chantiers(),
    queryFn: async (): Promise<Chantier[]> => {
      let cached = await readCache<Chantier>(CHANTIERS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(c => c.id));
        const extra = rqCached.filter(c => !cachedIds.has(c.id));
        if (extra.length) cached = [...cached, ...extra];
      }
      if (!isSupabaseConfigured) return cached ?? [];
      // Avoid hitting Supabase without a usable JWT — RLS would silently
      // return [] and the empty array would overwrite the local cache,
      // making the user think every chantier was deleted (typical symptom
      // after a cold start following an APK auto-update).
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      try {
        let q = ((supabase as any).from('chantiers') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map(toChantier);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'chantiers');
        const merged = mergeWithCache<Chantier>(fresh, cached, pendingIds);
        await writeCache(CHANTIERS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn('[useChantiers] fetch failed, using cache', err);
        return cached ?? [];
      }
    },
    enabled: !!user,

  });

  const sitePlansQuery = useQuery({
    queryKey: queryKeys.sitePlans(),
    queryFn: async (): Promise<SitePlan[]> => {
      let cached = await readCache<SitePlan>(SITE_PLANS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(p => p.id));
        const extra = rqCached.filter(p => !cachedIds.has(p.id));
        if (extra.length) cached = [...cached, ...extra];
      }
      if (!isSupabaseConfigured) return cached ?? [];
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      try {
        let spQ = ((supabase as any).from('site_plans') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          spQ = spQ.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await spQ;
        if (error) throw error;
        const fresh = (data ?? []).map(toSitePlan);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'site_plans');
        const merged = mergeWithCache<SitePlan>(fresh, cached, pendingIds);
        await writeCache(SITE_PLANS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn('[useChantiers/sitePlans] fetch failed, using cache', err);
        return cached ?? [];
      }
    },
    enabled: !!user,

  });

  const addChantier = useCallback(async (c: Chantier, plans: SitePlan[], onCreated?: (ch: Channel) => void) => {
    const existing = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers()) ?? [];
    if (existing.some(x => x.name.trim().toLowerCase() === c.name.trim().toLowerCase())) {
      Alert.alert('Chantier existant', `Un chantier nommé "${c.name}" existe déjà.`);
      return;
    }
    const newChantiers = [...existing, c];
    queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), newChantiers);
    writeCache(CHANTIERS_CACHE_KEY, newChantiers, userId);
    const existingPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), [...existingPlans, ...plans]);
    writeCache(SITE_PLANS_CACHE_KEY, [...existingPlans, ...plans], userId);

    const buildingChannel: Channel = {
      id: `building-${c.id}`,
      name: c.name,
      description: c.description ?? '',
      icon: 'business',
      color: '#3B82F6',
      type: 'building',
      members: user?.name ? [user.name] : [],
      createdBy: user?.name || undefined,
      organizationId: user?.organizationId || undefined,
    };
    onCreated?.(buildingChannel);

    const orgId = user?.organizationId ?? null;
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'chantiers', op: 'insert', data: {
        id: c.id, name: c.name, address: c.address ?? null, description: c.description ?? null,
        start_date: c.startDate ?? null, end_date: c.endDate ?? null, status: c.status,
        created_by: c.createdBy ?? null, buildings: c.buildings ? JSON.stringify(c.buildings) : null,
        organization_id: orgId, company_ids: c.companyIds ?? null,
      }});
      // Fix 9: also enqueue the building channel when offline
      enqueueOperation({ table: 'channels', op: 'insert', data: {
        id: buildingChannel.id, name: c.name, description: c.description ?? '',
        icon: 'business', color: '#3B82F6', type: 'building',
        members: user?.name ? [user.name] : [],
        created_by: user?.name || null, organization_id: orgId,
      }});
      return;
    }
    if (isSupabaseConfigured) {
      const chantierPayload = {
        id: c.id, name: c.name, address: c.address ?? null, description: c.description ?? null,
        start_date: c.startDate ?? null, end_date: c.endDate ?? null, status: c.status,
        created_by: c.createdBy ?? null, buildings: c.buildings ? JSON.stringify(c.buildings) : null,
        organization_id: orgId, company_ids: c.companyIds ?? null,
      };
      let { error } = await (supabase as any).from('chantiers').insert(chantierPayload);
      if (error) {
        await supabase.auth.refreshSession().catch(() => {});
        const { error: err2 } = await (supabase as any).from('chantiers').insert(chantierPayload);
        if (err2) {
          Alert.alert('Synchronisation incomplète', `Le chantier "${c.name}" a été créé localement mais n'a pas pu être synchronisé avec le serveur (${err2.message}).`, [{ text: 'OK' }]);
        }
      }
      // Fix 2: insert plans with full payload matching addSitePlan
      for (const p of plans) {
        const planPayload = {
          id: p.id, chantier_id: p.chantierId, name: p.name,
          building: p.building ?? null, level: p.level ?? null,
          building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
          uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
          uploaded_at: p.uploadedAt, size: p.size ?? null,
          revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
          parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
          revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
          pdf_page_count: p.pdfPageCount ?? null, organization_id: orgId,
        };
        const prep = await uploadLocalPhotosInPayload('site_plans', planPayload);
        if (!prep.allOk) {
          console.warn('[sync] addChantier: plan file upload failed, queuing for later sync');
          enqueueOperation({ table: 'site_plans', op: 'insert', data: planPayload });
          continue;
        }
        await (supabase as any).from('site_plans').insert(prep.data!);
      }
      await (supabase as any).from('channels').insert({
        id: buildingChannel.id, name: c.name, description: c.description ?? '',
        icon: 'business', color: '#3B82F6', type: 'building',
        members: user?.name ? [user.name] : [],
        created_by: user?.name || null, organization_id: orgId,
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.sitePlans() });
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation]);

  const updateChantier = useCallback(async (c: Chantier) => {
    queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), old =>
      (old ?? []).map(x => x.id === c.id ? c : x)
    );
    const updated = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers()) ?? [];
    writeCache(CHANTIERS_CACHE_KEY, updated, userId);
    const updatePayload = {
      name: c.name, address: c.address ?? null, description: c.description ?? null,
      start_date: c.startDate ?? null, end_date: c.endDate ?? null, status: c.status,
      buildings: c.buildings ? JSON.stringify(c.buildings) : null, company_ids: c.companyIds ?? null,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'chantiers', op: 'update', filter: { column: 'id', value: c.id }, data: updatePayload });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).from('chantiers').update(updatePayload).eq('id', c.id);
      if (error) {
        await supabase.auth.refreshSession().catch(() => {});
        const { error: err2 } = await (supabase as any).from('chantiers').update(updatePayload).eq('id', c.id);
        if (err2) Alert.alert('Synchronisation incomplète', `Le chantier "${c.name}" a été modifié localement mais n'a pas pu être synchronisé (${err2.message}).`, [{ text: 'OK' }]);
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation]);

  const deleteChantier = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers()) ?? [];
    const prevPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    // Optimistically remove from local cache
    const newChantiers = prev.filter(c => c.id !== id);
    queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), newChantiers);
    writeCache(CHANTIERS_CACHE_KEY, newChantiers, userId);
    const newPlans = prevPlans.filter(p => p.chantierId !== id);
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), newPlans);
    writeCache(SITE_PLANS_CACHE_KEY, newPlans, userId);
    queryClient.invalidateQueries({ queryKey: queryKeys.reserves() });
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
    queryClient.invalidateQueries({ queryKey: queryKeys.visites() });
    queryClient.invalidateQueries({ queryKey: queryKeys.lots() });
    queryClient.invalidateQueries({ queryKey: queryKeys.oprs() });
    queryClient.invalidateQueries({ queryKey: queryKeys.photos() });
    queryClient.invalidateQueries({ queryKey: queryKeys.documents() });
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'chantiers', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      try {
        const buildingChannelId = `building-${id}`;
        // Fix 15: try deleting chantier first (if DB has ON DELETE CASCADE it handles everything)
        const { data: deleted, error: delErr } = await (supabase as any).from('chantiers').delete().eq('id', id).select();
        if (!delErr && deleted?.length) {
          // Chantier deleted (possibly via cascade), clean up channel
          await (supabase as any).from('channels').delete().eq('id', buildingChannelId);
          return;
        }
        // Fallback: manual cascade delete if no DB-level cascade
        const { data: reserveRows } = await (supabase as any)
          .from('reserves').select('id').eq('chantier_id', id);
        const reserveIds = (reserveRows ?? []).map((r: any) => r.id);
        await Promise.all([
          reserveIds.length > 0
            ? (supabase as any).from('photos').delete().in('reserve_id', reserveIds)
            : Promise.resolve(),
          (supabase as any).from('reserves').delete().eq('chantier_id', id),
          (supabase as any).from('tasks').delete().eq('chantier_id', id),
          (supabase as any).from('visites').delete().eq('chantier_id', id),
          (supabase as any).from('lots').delete().eq('chantier_id', id),
          (supabase as any).from('oprs').delete().eq('chantier_id', id),
          (supabase as any).from('site_plans').delete().eq('chantier_id', id),
          (supabase as any).from('messages').delete().eq('channel_id', buildingChannelId),
          (supabase as any).from('documents').delete().eq('chantier_id', id),
          (supabase as any).from('incidents').delete().eq('chantier_id', id),
        ]);
        await (supabase as any).from('channels').delete().eq('id', buildingChannelId);
        const { data: deleted2, error } = await (supabase as any).from('chantiers').delete().eq('id', id).select();
        if (error) {
          console.warn('[sync] deleteChantier erreur serveur:', error.message);
          // Restore local cache on failure
          queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), [prev.find(c => c.id === id)!, ...newChantiers]);
          writeCache(CHANTIERS_CACHE_KEY, [prev.find(c => c.id === id)!, ...newChantiers], userId);
          Alert.alert('Suppression refusée', 'Le chantier n\'a pas pu être supprimé du serveur.');
        } else if (!deleted2?.length) {
          console.warn('[sync] deleteChantier: aucune ligne supprimée');
        }
      } catch (e: any) {
        console.error('[sync] deleteChantier exception:', e?.message ?? e);
        // Restore local cache on exception
        queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), [prev.find(c => c.id === id)!, ...newChantiers]);
        writeCache(CHANTIERS_CACHE_KEY, [prev.find(c => c.id === id)!, ...newChantiers], userId);
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation]);

  const addSitePlan = useCallback(async (p: SitePlan) => {
    const orgId = user?.organizationId ?? null;
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), old => {
      if ((old ?? []).some(x => x.id === p.id)) return old ?? [];
      return [...(old ?? []), p];
    });
    const allPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    writeCache(SITE_PLANS_CACHE_KEY, allPlans, userId);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'site_plans', op: 'insert', data: {
        id: p.id, chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, uploaded_at: p.uploadedAt, size: p.size ?? null,
        organization_id: orgId,
      }});
      return;
    }
    if (isSupabaseConfigured) {
      const insertPayload = {
        id: p.id, chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
        uploaded_at: p.uploadedAt, size: p.size ?? null,
        revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
        parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
        revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
        pdf_page_count: p.pdfPageCount ?? null, organization_id: orgId,
      };
      // If the plan file is still a local URI (camera cache, picker temp file),
      // upload it to Supabase Storage first; otherwise other devices won't be
      // able to display it. If the upload fails, queue the row for a later sync.
      const prep = await uploadLocalPhotosInPayload('site_plans', insertPayload);
      if (!prep.allOk) {
        console.warn('[sync] addSitePlan: file upload failed, queuing for later sync');
        enqueueOperation({ table: 'site_plans', op: 'insert', data: insertPayload });
        return;
      }
      const { error } = await (supabase as any).from('site_plans').insert(prep.data!);
      if (error) console.warn('[sync] addSitePlan server error:', error.message);
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation]);

  const updateSitePlan = useCallback(async (p: SitePlan) => {
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), old =>
      (old ?? []).map(x => x.id === p.id ? p : x)
    );
    const allPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    writeCache(SITE_PLANS_CACHE_KEY, allPlans, userId);
    // Fix 3: offline updateSitePlan includes all fields so nothing is overwritten to null on sync
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'site_plans', op: 'update', filter: { column: 'id', value: p.id }, data: {
        chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
        uploaded_at: p.uploadedAt, size: p.size ?? null,
        revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
        parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
        revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
        pdf_page_count: p.pdfPageCount ?? null,
      }});
      return;
    }
    if (isSupabaseConfigured) {
      const updatePayload = {
        chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
        uploaded_at: p.uploadedAt, size: p.size ?? null,
        revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
        parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
        revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
        pdf_page_count: p.pdfPageCount ?? null,
      };
      const prep = await uploadLocalPhotosInPayload('site_plans', updatePayload);
      if (!prep.allOk) {
        console.warn('[sync] updateSitePlan: file upload failed, queuing for later sync');
        enqueueOperation({ table: 'site_plans', op: 'update', filter: { column: 'id', value: p.id }, data: updatePayload });
        return;
      }
      (supabase as any).from('site_plans').update(prep.data!).eq('id', p.id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] updateSitePlan error:', error.message);
      });
    }
  }, [queryClient, isOnlineRef, enqueueOperation]);

  const deleteSitePlan = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    const previous = prev.find(p => p.id === id);
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), prev.filter(p => p.id !== id));
    writeCache(SITE_PLANS_CACHE_KEY, prev.filter(p => p.id !== id), userId);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'site_plans', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any).from('site_plans').delete().eq('id', id).select();
      if (error) {
        console.warn('[sync] deleteSitePlan erreur serveur:', error.message);
        if (previous) {
          queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), old => [...(old ?? []), previous]);
          Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer ce plan, ou il n\'existe plus sur le serveur.');
        }
      } else if (!deleted?.length) {
        console.warn('[sync] deleteSitePlan: aucune ligne supprimée');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation]);

  const addSitePlanVersion = useCallback(async (parentPlanId: string, newPlan: SitePlan) => {
    const orgId = user?.organizationId ?? null;
    const allPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    const parent = allPlans.find(p => p.id === parentPlanId);
    if (!parent) return;
    const parentRevNum = parent.revisionNumber ?? 1;
    const revNum = parentRevNum + 1;
    const autoRevCode = `R${String(revNum).padStart(2, '0')}`;
    const finalRevCode = newPlan.revisionCode?.trim() || autoRevCode;
    const updatedParent: SitePlan = { ...parent, revisionNumber: parentRevNum, isLatestRevision: false };
    const versionedNew: SitePlan = {
      ...newPlan, parentPlanId, revisionNumber: revNum, revisionCode: finalRevCode, isLatestRevision: true,
    };
    const updatedPlans = allPlans.map(p => p.id === parentPlanId ? updatedParent : p).concat([versionedNew]);
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), updatedPlans);
    writeCache(SITE_PLANS_CACHE_KEY, updatedPlans, userId);
    if (isSupabaseConfigured) {
      const { error: updateErr } = await (supabase as any).from('site_plans')
        .update({ is_latest_revision: false, revision_number: parentRevNum }).eq('id', parentPlanId);
      if (updateErr) console.error('[addSitePlanVersion] update parent error:', updateErr.message);
      const versionPayload = {
        id: versionedNew.id, chantier_id: versionedNew.chantierId, name: versionedNew.name,
        uri: versionedNew.uri ?? null, file_type: versionedNew.fileType ?? null,
        dxf_name: versionedNew.dxfName ?? null, size: versionedNew.size ?? null,
        building: versionedNew.building ?? null, level: versionedNew.level ?? null,
        building_id: versionedNew.buildingId ?? null, level_id: versionedNew.levelId ?? null,
        revision_code: finalRevCode, revision_number: revNum,
        parent_plan_id: parentPlanId, is_latest_revision: true,
        revision_note: versionedNew.revisionNote ?? null, organization_id: orgId,
      };
      const prep = await uploadLocalPhotosInPayload('site_plans', versionPayload);
      if (!prep.allOk) {
        console.warn('[sync] addSitePlanVersion: file upload failed, queuing for later sync');
        enqueueOperation({ table: 'site_plans', op: 'insert', data: versionPayload });
        return;
      }
      const { error: insertErr } = await (supabase as any).from('site_plans').insert(prep.data!);
      if (insertErr) console.warn('[sync] addSitePlanVersion insert error:', insertErr.message);
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation]);

  const migrateReservesToPlan = useCallback(async (fromPlanId: string, toPlanId: string): Promise<number> => {
    const reserves = queryClient.getQueryData<any[]>(queryKeys.reserves()) ?? [];
    const toMigrate = reserves.filter(r => r.planId === fromPlanId && r.status !== 'closed');
    if (toMigrate.length === 0) return 0;
    const migrated = toMigrate.map(r => ({ ...r, planId: toPlanId }));
    queryClient.setQueryData<any[]>(queryKeys.reserves(), old =>
      (old ?? []).map(r => { const m = migrated.find(x => x.id === r.id); return m ?? r; })
    );
    if (isSupabaseConfigured) {
      Promise.all(migrated.map(r =>
        (supabase as any).from('reserves').update({ plan_id: toPlanId }).eq('id', r.id)
      )).then(results => {
        if (results.some((res: any) => res.error)) console.warn('[sync] migrateReservesToPlan some errors');
      });
    }
    return migrated.length;
  }, [queryClient]);

  // Synchronisation temps réel : rechargement automatique quand un chantier change
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    const channel = (supabase as any)
      .channel('realtime-chantiers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chantiers' },
        (_payload: any) => {
          queryClient.invalidateQueries({ queryKey: queryKeys.chantiers() });
        }
      )
      .subscribe();
    return () => {
      (supabase as any).removeChannel(channel);
    };
  }, [userId, queryClient]);

  return {
    chantiers: chantiersQuery.data ?? [],
    sitePlans: sitePlansQuery.data ?? [],
    isLoadingChantiers: chantiersQuery.isLoading,
    isLoadingSitePlans: sitePlansQuery.isLoading,
    addChantier,
    updateChantier,
    deleteChantier,
    addSitePlan,
    updateSitePlan,
    deleteSitePlan,
    addSitePlanVersion,
    migrateReservesToPlan,
    invalidateChantiers: () => queryClient.invalidateQueries({ queryKey: queryKeys.chantiers() }),
    invalidateSitePlans: () => queryClient.invalidateQueries({ queryKey: queryKeys.sitePlans() }),
  };
}
