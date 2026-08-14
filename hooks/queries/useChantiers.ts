import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toChantier, toSitePlan } from '@/lib/mappers';
import { Chantier, SitePlan, Channel, Reserve } from '@/constants/types';
import { uploadLocalPhotosInPayload } from '@/lib/storage';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';
import i18n from '@/lib/i18n';
import { LatestWriteQueue } from '@/lib/plan-annotations/latest-write-queue';
import {
  mergeSitePlanWriteSnapshots,
  queuedSitePlanSnapshotRequiresFileReplacement,
  sitePlanSnapshotCoalesceKey,
  sitePlanWriteKey,
  type SitePlanWriteSnapshot,
} from '@/lib/plan-annotations/site-plan-write-policy';

const CHANTIERS_CACHE_KEY = 'buildtrack_chantiers_cache_v1';
const SITE_PLANS_CACHE_KEY = 'buildtrack_site_plans_cache_v1';

export function useChantiers() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  const userId = user?.id;
  const activeUserIdRef = useRef<string | null>(userId ?? null);
  const sitePlanWriteQueueRef = useRef(new LatestWriteQueue<SitePlanWriteSnapshot>());
  const activeSitePlanWriteCountRef = useRef(new Map<string, number>());
  const latestSitePlanSnapshotRef = useRef(new Map<string, SitePlanWriteSnapshot>());
  const queuedSitePlanRetryKeysRef = useRef(new Set<string>());
  const pendingSitePlanFileReplacementKeysRef = useRef(new Set<string>());

  useEffect(() => {
    queueRef.current = queue;
    const queuedKeys = new Set(
      queue
        .map(operation => String(operation.coalesceKey ?? '').trim())
        .filter(Boolean),
    );
    for (const operation of queue) {
      const key = String(operation.coalesceKey ?? '').trim();
      if (!key || !key.startsWith('site-plan-snapshot:')) continue;
      queuedSitePlanRetryKeysRef.current.add(key);
      if (operation.rpc?.fn === 'replace_site_plan_file_safely') {
        pendingSitePlanFileReplacementKeysRef.current.add(key);
      }
    }
    for (const key of queuedSitePlanRetryKeysRef.current) {
      if (!queuedKeys.has(key) && !activeSitePlanWriteCountRef.current.get(key)) {
        queuedSitePlanRetryKeysRef.current.delete(key);
        pendingSitePlanFileReplacementKeysRef.current.delete(key);
        latestSitePlanSnapshotRef.current.delete(key);
      }
    }
  }, [queue]);

  useEffect(() => {
    const previousUserId = activeUserIdRef.current;
    activeUserIdRef.current = userId ?? null;
    if (previousUserId !== (userId ?? null)) {
      activeSitePlanWriteCountRef.current.clear();
      latestSitePlanSnapshotRef.current.clear();
      queuedSitePlanRetryKeysRef.current.clear();
      pendingSitePlanFileReplacementKeysRef.current.clear();
    }
    return () => {
      if (activeUserIdRef.current === userId) activeUserIdRef.current = null;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    readCache<Chantier>(CHANTIERS_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers());
      if (!rqCurrent?.length) {
        queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), manualCached);
        return;
      }
      const manualIds = new Set(manualCached.map(c => c.id));
      if (rqCurrent.some(c => !manualIds.has(c.id))) {
        queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), rqCurrent.filter(c => manualIds.has(c.id)));
      }
    });
    readCache<SitePlan>(SITE_PLANS_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans());
      if (!rqCurrent?.length) {
        queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), manualCached);
        return;
      }
      const manualIds = new Set(manualCached.map(p => p.id));
      if (rqCurrent.some(p => !manualIds.has(p.id))) {
        queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), rqCurrent.filter(p => manualIds.has(p.id)));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const chantiersQuery = useQuery({
    queryKey: queryKeys.chantiers(),
    queryFn: async (): Promise<Chantier[]> => {
      let cached = await readCache<Chantier>(CHANTIERS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers());
      if (!cached && rqCached?.length) cached = rqCached;
      if (!isSupabaseConfigured) return cached ?? [];
      // Avoid hitting Supabase without a usable JWT — RLS would silently
      // return [] and the empty array would overwrite the local cache,
      // making the user think every chantier was deleted (typical symptom
      // after a cold start following an APK auto-update).
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];
      try {
        let q = ((supabase as any).from('chantiers') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map(toChantier).filter((chantier: Chantier) => !chantier.deletedAt);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'chantiers');
        const merged = mergeWithCache<Chantier>(fresh, cached, pendingIds, { queueLoaded });
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
      if (!isSupabaseConfigured) return cached ?? [];
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];
      try {
        let spQ = ((supabase as any).from('site_plans') as any).select('*').order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          spQ = spQ.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await spQ;
        if (error) throw error;
        const fresh = (data ?? []).map(toSitePlan).filter((plan: SitePlan) => !plan.deletedAt);
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'site_plans');
        const merged = mergeWithCache<SitePlan>(fresh, cached, pendingIds, { queueLoaded });
        await writeCache(SITE_PLANS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn('[useChantiers/sitePlans] fetch failed, using cache', err);
        return cached ?? [];
      }
    },
    enabled: !!user && user.role !== 'magasinier',

  });

  const addChantier = useCallback(async (c: Chantier, plans: SitePlan[], onCreated?: (ch: Channel) => void) => {
    const existing = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers()) ?? [];
    if (existing.some(x => x.name.trim().toLowerCase() === c.name.trim().toLowerCase())) {
      Alert.alert(
        i18n.t('syncAlerts.duplicateProjectTitle'),
        i18n.t('syncAlerts.duplicateProjectMessage', { name: c.name }),
      );
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
    const chantierPayload = {
      id: c.id, name: c.name, address: c.address ?? null, description: c.description ?? null,
      start_date: c.startDate ?? null, end_date: c.endDate ?? null, status: c.status,
      created_by: c.createdBy ?? null, buildings: c.buildings ? JSON.stringify(c.buildings) : null,
      organization_id: orgId, company_ids: c.companyIds ?? null,
    };
    const channelPayload = {
      id: buildingChannel.id, name: c.name, description: c.description ?? '',
      icon: 'business', color: '#3B82F6', type: 'building',
      members: user?.name ? [user.name] : [],
      created_by: user?.name || null, organization_id: orgId,
    };
    const sitePlanPayloadFor = (p: SitePlan) => ({
      id: p.id, chantier_id: p.chantierId, name: p.name,
      building: p.building ?? null, level: p.level ?? null,
      building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
      uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
      uploaded_at: p.uploadedAt, size: p.size ?? null,
      revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
      parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
      revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
      pdf_page_count: p.pdfPageCount ?? null, organization_id: orgId,
    });
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'chantiers', op: 'insert', data: chantierPayload });
      // Fix 9: also enqueue the building channel when offline
      enqueueOperation({ table: 'channels', op: 'upsert', data: channelPayload });
      plans.forEach(p => enqueueOperation({ table: 'site_plans', op: 'insert', data: sitePlanPayloadFor(p) }));
      return;
    }
    if (isSupabaseConfigured) {
      let { error } = await (supabase as any).from('chantiers').insert(chantierPayload);
      if (error) {
        await supabase.auth.refreshSession().catch(() => {});
        const { error: err2 } = await (supabase as any).from('chantiers').insert(chantierPayload);
        if (err2) {
          enqueueOperation({ table: 'chantiers', op: 'insert', data: chantierPayload });
          Alert.alert(
            i18n.t('syncAlerts.incompleteSyncTitle'),
            i18n.t('syncAlerts.projectCreatedLocalMessage', { name: c.name, error: err2.message }),
            [{ text: i18n.t('common.ok') }],
          );
        }
      }
      // Fix 2: insert plans with full payload matching addSitePlan
      for (const p of plans) {
        const planPayload = sitePlanPayloadFor(p);
        const prep = await uploadLocalPhotosInPayload('site_plans', planPayload);
        if (!prep.allOk) {
          console.warn('[sync] addChantier: plan file upload failed, queuing for later sync');
          enqueueOperation({ table: 'site_plans', op: 'insert', data: planPayload });
          continue;
        }
        const { error: planErr } = await (supabase as any).from('site_plans').insert(prep.data!);
        if (planErr) {
          console.warn('[sync] addChantier: plan insert failed, queuing for retry:', planErr.message);
          enqueueOperation({ table: 'site_plans', op: 'insert', data: planPayload });
        }
      }
      const { error: channelErr } = await (supabase as any).from('channels').upsert(channelPayload);
      if (channelErr) {
        console.warn('[sync] addChantier: channel upsert failed, queuing for retry:', channelErr.message);
        enqueueOperation({ table: 'channels', op: 'upsert', data: channelPayload });
      }
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
        // Try refreshing the session once, then retry.
        await supabase.auth.refreshSession().catch(() => {});
        const { error: err2 } = await (supabase as any).from('chantiers').update(updatePayload).eq('id', c.id);
        if (err2) {
          // Both attempts failed — queue for retry instead of alerting the user.
          // Local cache already has the correct state; the server will catch up on reconnect.
          console.warn('[sync] updateChantier: both attempts failed, queuing for retry:', err2.message);
          enqueueOperation({ table: 'chantiers', op: 'update', filter: { column: 'id', value: c.id }, data: updatePayload });
        }
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, userId]);

  const deleteChantier = useCallback(async (id: string) => {
    const linkedLocalReserves = (queryClient.getQueryData<Reserve[]>(queryKeys.reserves()) ?? [])
      .filter(reserve => reserve.chantierId === id);
    if (linkedLocalReserves.length > 0) {
      Alert.alert(
        i18n.t('syncAlerts.deleteDeniedTitle'),
        i18n.t('syncAlerts.deleteProjectHasReservesDetailed'),
      );
      return;
    }
    if (!isOnlineRef.current && isSupabaseConfigured) {
      Alert.alert(
        i18n.t('syncAlerts.deleteDeniedTitle'),
        i18n.t('syncAlerts.deleteProjectOfflineUnavailable'),
      );
      return;
    }
    if (isSupabaseConfigured) {
      const { data: serverReserves, error: reserveCheckError } = await (supabase as any)
        .from('reserves')
        .select('id')
        .eq('chantier_id', id)
        .limit(1);
      if (reserveCheckError) {
        Alert.alert(
          i18n.t('syncAlerts.deleteDeniedTitle'),
          i18n.t('syncAlerts.deleteProjectReserveCheckFailed'),
        );
        return;
      }
      if (serverReserves?.length) {
        Alert.alert(
          i18n.t('syncAlerts.deleteDeniedTitle'),
          i18n.t('syncAlerts.deleteProjectHasReserves'),
        );
        return;
      }
    }

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
      enqueueOperation({ table: 'chantiers', op: 'delete', filter: { column: 'id', value: id }, data: { deleted_reason: 'mobile_offline_delete_chantier' } });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase as any).rpc('soft_delete_chantier', {
        p_chantier_id: id,
        p_reason: 'mobile_delete_chantier',
      });
      if (error) {
        const restored = prev.find(c => c.id === id);
        console.warn('[sync] deleteChantier erreur serveur:', error.message);
        if (restored) {
          queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), [restored, ...newChantiers]);
          writeCache(CHANTIERS_CACHE_KEY, [restored, ...newChantiers], userId);
        }
        queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), prevPlans);
        writeCache(SITE_PLANS_CACHE_KEY, prevPlans, userId);
        Alert.alert(i18n.t('syncAlerts.deleteDeniedTitle'), error.message ?? i18n.t('syncAlerts.deleteProjectDenied'));
        if (false) {
          console.warn('[sync] deleteChantier: aucune ligne supprimée');
        }
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, userId]);

  const addSitePlan = useCallback(async (p: SitePlan) => {
    const orgId = user?.organizationId ?? null;
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), old => {
      if ((old ?? []).some(x => x.id === p.id)) return old ?? [];
      return [...(old ?? []), p];
    });
    const allPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    writeCache(SITE_PLANS_CACHE_KEY, allPlans, userId);
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
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'site_plans', op: 'insert', data: insertPayload });
      return;
    }
    if (isSupabaseConfigured) {
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
      if (error) {
        console.warn('[sync] addSitePlan server error, queuing for retry:', error.message);
        enqueueOperation({ table: 'site_plans', op: 'insert', data: insertPayload });
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation]);

  const updateSitePlan = useCallback(async (p: SitePlan) => {
    const previousPlan = (queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? []).find(plan => plan.id === p.id);
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), old =>
      (old ?? []).map(x => x.id === p.id ? p : x)
    );
    const allPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    writeCache(SITE_PLANS_CACHE_KEY, allPlans, userId);
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
    const fileChanged = !!previousPlan && (
      previousPlan.uri !== p.uri ||
      previousPlan.fileType !== p.fileType ||
      previousPlan.dxfName !== p.dxfName ||
      previousPlan.size !== p.size ||
      previousPlan.pdfPageCount !== p.pdfPageCount
    );
    const ownerId = userId ?? null;
    const writeKey = sitePlanWriteKey(ownerId, p.id);
    const coalesceKey = sitePlanSnapshotCoalesceKey(ownerId, p.id);
    const queuedFileReplacement = queuedSitePlanSnapshotRequiresFileReplacement(queueRef.current, coalesceKey);
    const requiresFileReplacement = fileChanged
      || queuedFileReplacement
      || pendingSitePlanFileReplacementKeysRef.current.has(coalesceKey);
    if (requiresFileReplacement) {
      pendingSitePlanFileReplacementKeysRef.current.add(coalesceKey);
    }
    const snapshot: SitePlanWriteSnapshot = {
      ownerId,
      planId: p.id,
      updatePayload,
      retryPayload: updatePayload,
      fileChanged: requiresFileReplacement,
    };
    latestSitePlanSnapshotRef.current.set(coalesceKey, snapshot);

    const enqueueLatestSnapshotForRetry = (
      latest: SitePlanWriteSnapshot,
      reason: string,
    ) => {
      queuedSitePlanRetryKeysRef.current.add(coalesceKey);
      if (latest.fileChanged) {
        pendingSitePlanFileReplacementKeysRef.current.add(coalesceKey);
        enqueueOperation({
          table: 'site_plans',
          op: 'rpc',
          rpc: {
            fn: 'replace_site_plan_file_safely',
            args: {
              p_plan_id: latest.planId,
              p_patch: latest.retryPayload,
              p_reason: reason,
            },
          },
          data: latest.retryPayload,
          coalesceKey,
        });
        return;
      }
      enqueueOperation({
        table: 'site_plans',
        op: 'update',
        filter: { column: 'id', value: latest.planId },
        data: latest.retryPayload,
        coalesceKey,
      });
    };

    // Fix 3: offline updateSitePlan includes all fields so nothing is overwritten to null on sync
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueLatestSnapshotForRetry(
        snapshot,
        requiresFileReplacement
          ? 'mobile_offline_update_site_plan_file'
          : 'mobile_offline_update_site_plan',
      );
      return;
    }
    if (isSupabaseConfigured) {
      activeSitePlanWriteCountRef.current.set(
        coalesceKey,
        (activeSitePlanWriteCountRef.current.get(coalesceKey) ?? 0) + 1,
      );
      let succeeded = false;
      try {
        await sitePlanWriteQueueRef.current.enqueue(
          writeKey,
          snapshot,
          async latest => {
            latestSitePlanSnapshotRef.current.set(coalesceKey, latest);
            if (activeUserIdRef.current !== latest.ownerId) throw new Error('site_plan_owner_changed');
            const prep = await uploadLocalPhotosInPayload('site_plans', latest.updatePayload);
            if (!prep.allOk) throw new Error('site_plan_file_upload_failed');
            if (activeUserIdRef.current !== latest.ownerId) throw new Error('site_plan_owner_changed');
            latest.retryPayload = prep.data!;
            latestSitePlanSnapshotRef.current.set(coalesceKey, latest);
            if (latest.fileChanged) {
              const replacement = await (supabase as any).rpc('replace_site_plan_file_safely', {
                p_plan_id: latest.planId,
                p_patch: latest.retryPayload,
                p_reason: 'mobile_update_site_plan_file',
              });
              if (replacement.error) throw replacement.error;

              // The guarded RPC intentionally updates only file columns. Once
              // the file transition is accepted, persist the complete newest
              // snapshot (including annotations/building/revision metadata).
              // File values now match, so the anti-loss trigger permits it.
              const metadataUpdate = await (supabase as any)
                .from('site_plans')
                .update(latest.retryPayload)
                .eq('id', latest.planId);
              if (metadataUpdate.error) throw metadataUpdate.error;
            } else {
              const result = await (supabase as any)
                .from('site_plans')
                .update(latest.retryPayload)
                .eq('id', latest.planId);
              if (result.error) throw result.error;
            }
          },
          (writeError, latest) => {
            if (activeUserIdRef.current !== latest.ownerId) return;
            console.warn('[sync] updateSitePlan final write failed, queuing latest snapshot:', writeError instanceof Error ? writeError.message : writeError);
            enqueueLatestSnapshotForRetry(latest, latest.fileChanged
              ? 'mobile_update_site_plan_file_retry'
              : 'mobile_update_site_plan_retry');
          },
          mergeSitePlanWriteSnapshots,
        );
        succeeded = true;

        // A previous failed snapshot may already be persisted. Never leave it
        // behind after a newer online success: replace it with the newest full
        // snapshot so a later replay cannot resurrect stale annotations.
        const hasPersistedRetry = queuedSitePlanRetryKeysRef.current.has(coalesceKey)
          || queueRef.current.some(operation => operation.coalesceKey === coalesceKey);
        if (hasPersistedRetry) {
          const latest = latestSitePlanSnapshotRef.current.get(coalesceKey) ?? snapshot;
          enqueueLatestSnapshotForRetry(
            latest,
            latest.fileChanged
              ? 'mobile_update_site_plan_file_latest_snapshot'
              : 'mobile_update_site_plan_latest_snapshot',
          );
        }
      } catch {
        // The final-failure callback above owns durable retry publication.
      } finally {
        const remainingWrites = Math.max(
          0,
          (activeSitePlanWriteCountRef.current.get(coalesceKey) ?? 1) - 1,
        );
        if (remainingWrites > 0) activeSitePlanWriteCountRef.current.set(coalesceKey, remainingWrites);
        else activeSitePlanWriteCountRef.current.delete(coalesceKey);

        const hasPersistedRetry = queuedSitePlanRetryKeysRef.current.has(coalesceKey)
          || queueRef.current.some(operation => operation.coalesceKey === coalesceKey);
        if (succeeded && remainingWrites === 0 && !hasPersistedRetry) {
          pendingSitePlanFileReplacementKeysRef.current.delete(coalesceKey);
          latestSitePlanSnapshotRef.current.delete(coalesceKey);
        }
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, userId]);

  const deleteSitePlan = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    const previous = prev.find(p => p.id === id);
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), prev.filter(p => p.id !== id));
    writeCache(SITE_PLANS_CACHE_KEY, prev.filter(p => p.id !== id), userId);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'site_plans', op: 'delete', filter: { column: 'id', value: id }, data: { deleted_reason: 'mobile_offline_delete_site_plan' } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase as any).rpc('soft_delete_site_plan', {
        p_plan_id: id,
        p_reason: 'mobile_delete_site_plan',
      });
      if (error) {
        console.warn('[sync] deleteSitePlan erreur serveur:', error.code, error.message);
        const isPermissionDenied = error.code === '42501' || /row-level security|permission denied/i.test(error.message ?? '');
        if (isPermissionDenied && previous) {
          queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), old => [...(old ?? []), previous]);
          writeCache(SITE_PLANS_CACHE_KEY, queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [], userId);
          Alert.alert(i18n.t('syncAlerts.deleteDeniedTitle'), i18n.t('syncAlerts.deletePlanDenied'));
        } else {
          console.warn('[sync] deleteSitePlan: erreur réseau/session, opération enqueued pour retry');
          enqueueOperation({ table: 'site_plans', op: 'delete', filter: { column: 'id', value: id }, data: { deleted_reason: 'mobile_delete_site_plan' } });
        }
      } else if (Array.isArray(deleted) && !deleted.length) {
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
    const versionPayload = {
      id: versionedNew.id, chantier_id: versionedNew.chantierId, name: versionedNew.name,
      uri: versionedNew.uri ?? null, file_type: versionedNew.fileType ?? null,
      dxf_name: versionedNew.dxfName ?? null, size: versionedNew.size ?? null,
      building: versionedNew.building ?? null, level: versionedNew.level ?? null,
      building_id: versionedNew.buildingId ?? null, level_id: versionedNew.levelId ?? null,
      revision_code: finalRevCode, revision_number: revNum,
      parent_plan_id: parentPlanId, is_latest_revision: true,
      revision_note: versionedNew.revisionNote ?? null,
      uploaded_at: versionedNew.uploadedAt,
      annotations: versionedNew.annotations ?? [],
      pdf_page_count: versionedNew.pdfPageCount ?? null,
      organization_id: orgId,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({
        table: 'site_plans',
        op: 'rpc',
        rpc: {
          fn: 'create_site_plan_revision_with_reserve_migration',
          args: {
            p_parent_plan_id: parentPlanId,
            p_new_plan: versionPayload,
            p_migrate_reserves: false,
          },
        },
        data: versionPayload,
      });
      return;
    }
    if (isSupabaseConfigured) {
      const prep = await uploadLocalPhotosInPayload('site_plans', versionPayload);
      if (!prep.allOk) {
        console.warn('[sync] addSitePlanVersion: file upload failed, queuing for later sync');
        enqueueOperation({
          table: 'site_plans',
          op: 'rpc',
          rpc: {
            fn: 'create_site_plan_revision_with_reserve_migration',
            args: {
              p_parent_plan_id: parentPlanId,
              p_new_plan: versionPayload,
              p_migrate_reserves: false,
            },
          },
          data: versionPayload,
        });
        return;
      }
      const { error: revisionErr } = await (supabase as any).rpc('create_site_plan_revision_with_reserve_migration', {
        p_parent_plan_id: parentPlanId,
        p_new_plan: prep.data!,
        p_migrate_reserves: false,
      });
      if (revisionErr) {
        console.warn('[sync] addSitePlanVersion insert error:', revisionErr.message);
        enqueueOperation({
          table: 'site_plans',
          op: 'rpc',
          rpc: {
            fn: 'create_site_plan_revision_with_reserve_migration',
            args: {
              p_parent_plan_id: parentPlanId,
              p_new_plan: prep.data!,
              p_migrate_reserves: false,
            },
          },
          data: prep.data!,
        });
      }
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
    const queueReserveMove = (r: any) => enqueueOperation({
      table: 'reserves',
      op: 'update',
      filter: { column: 'id', value: r.id },
      data: { plan_id: toPlanId },
    });
    if (isSupabaseConfigured) {
      if (!isOnlineRef.current) {
        migrated.forEach(queueReserveMove);
        return migrated.length;
      }
      Promise.all(migrated.map(r =>
        (supabase as any).from('reserves').update({ plan_id: toPlanId }).eq('id', r.id)
      )).then(results => {
        const failed = results
          .map((res: any, index: number) => ({ error: res.error, reserve: migrated[index] }))
          .filter((res: any) => res.error);
        if (failed.length) {
          console.warn('[sync] migrateReservesToPlan errors:', failed.map((res: any) => res.error?.message).join('; '));
          failed.forEach((res: any) => queueReserveMove(res.reserve));
        }
      }).catch((error: any) => {
        console.warn('[sync] migrateReservesToPlan error:', error?.message ?? error);
        migrated.forEach(queueReserveMove);
      });
    }
    return migrated.length;
  }, [queryClient, isOnlineRef, enqueueOperation]);

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
