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

const MOCK_CHANTIERS_KEY = 'buildtrack_mock_chantiers_v2';
const MOCK_SITE_PLANS_KEY = 'buildtrack_mock_site_plans_v2';

export function useChantiers() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  const chantiersQuery = useQuery({
    queryKey: queryKeys.chantiers(),
    queryFn: async (): Promise<Chantier[]> => {
      if (!isSupabaseConfigured) {
        const stored = await AsyncStorage.getItem(MOCK_CHANTIERS_KEY).catch(() => null);
        return stored ? JSON.parse(stored) : [];
      }
      const { data, error } = await supabase
        .from('chantiers').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toChantier);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const sitePlansQuery = useQuery({
    queryKey: queryKeys.sitePlans(),
    queryFn: async (): Promise<SitePlan[]> => {
      if (!isSupabaseConfigured) {
        const stored = await AsyncStorage.getItem(MOCK_SITE_PLANS_KEY).catch(() => null);
        return stored ? JSON.parse(stored) : [];
      }
      const { data, error } = await supabase
        .from('site_plans').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map(toSitePlan);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const addChantier = useCallback(async (c: Chantier, plans: SitePlan[], onCreated?: (ch: Channel) => void) => {
    const existing = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers()) ?? [];
    if (existing.some(x => x.name.trim().toLowerCase() === c.name.trim().toLowerCase())) {
      Alert.alert('Chantier existant', `Un chantier nommé "${c.name}" existe déjà.`);
      return;
    }
    const newChantiers = [...existing, c];
    queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), newChantiers);
    AsyncStorage.setItem(MOCK_CHANTIERS_KEY, JSON.stringify(newChantiers)).catch(() => {});
    const existingPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), [...existingPlans, ...plans]);
    AsyncStorage.setItem(MOCK_SITE_PLANS_KEY, JSON.stringify([...existingPlans, ...plans])).catch(() => {});

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
      return;
    }
    if (isSupabaseConfigured) {
      const chantierPayload = {
        id: c.id, name: c.name, address: c.address ?? null, description: c.description ?? null,
        start_date: c.startDate ?? null, end_date: c.endDate ?? null, status: c.status,
        created_by: c.createdBy ?? null, buildings: c.buildings ? JSON.stringify(c.buildings) : null,
        organization_id: orgId, company_ids: c.companyIds ?? null,
      };
      let { error } = await supabase.from('chantiers').insert(chantierPayload);
      if (error) {
        await supabase.auth.refreshSession().catch(() => {});
        const { error: err2 } = await supabase.from('chantiers').insert(chantierPayload);
        if (err2) {
          Alert.alert('Synchronisation incomplète', `Le chantier "${c.name}" a été créé localement mais n'a pas pu être synchronisé avec le serveur (${err2.message}).`, [{ text: 'OK' }]);
        }
      }
      for (const p of plans) {
        await supabase.from('site_plans').insert({
          id: p.id, chantier_id: p.chantierId, name: p.name,
          building: p.building ?? null, level: p.level ?? null,
          building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
          uri: p.uri ?? null, file_type: p.fileType ?? null, uploaded_at: p.uploadedAt, size: p.size ?? null,
        });
      }
      await supabase.from('channels').insert({
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
    AsyncStorage.setItem(MOCK_CHANTIERS_KEY, JSON.stringify(updated)).catch(() => {});
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
      const { error } = await supabase.from('chantiers').update(updatePayload).eq('id', c.id);
      if (error) {
        await supabase.auth.refreshSession().catch(() => {});
        const { error: err2 } = await supabase.from('chantiers').update(updatePayload).eq('id', c.id);
        if (err2) Alert.alert('Synchronisation incomplète', `Le chantier "${c.name}" a été modifié localement mais n'a pas pu être synchronisé (${err2.message}).`, [{ text: 'OK' }]);
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation]);

  const deleteChantier = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Chantier[]>(queryKeys.chantiers()) ?? [];
    const newChantiers = prev.filter(c => c.id !== id);
    queryClient.setQueryData<Chantier[]>(queryKeys.chantiers(), newChantiers);
    AsyncStorage.setItem(MOCK_CHANTIERS_KEY, JSON.stringify(newChantiers)).catch(() => {});
    const prevPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    const newPlans = prevPlans.filter(p => p.chantierId !== id);
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), newPlans);
    AsyncStorage.setItem(MOCK_SITE_PLANS_KEY, JSON.stringify(newPlans)).catch(() => {});
    queryClient.invalidateQueries({ queryKey: queryKeys.reserves() });
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
    queryClient.invalidateQueries({ queryKey: queryKeys.visites() });
    queryClient.invalidateQueries({ queryKey: queryKeys.lots() });
    queryClient.invalidateQueries({ queryKey: queryKeys.oprs() });
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'chantiers', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      try {
        await Promise.all([
          supabase.from('reserves').delete().eq('chantier_id', id),
          supabase.from('tasks').delete().eq('chantier_id', id),
          supabase.from('visites').delete().eq('chantier_id', id),
          supabase.from('lots').delete().eq('chantier_id', id),
          supabase.from('oprs').delete().eq('chantier_id', id),
          supabase.from('site_plans').delete().eq('chantier_id', id),
        ]);
        const { data: deleted, error } = await supabase.from('chantiers').delete().eq('id', id).select();
        if (error) console.warn('[sync] deleteChantier erreur serveur:', error.message);
        else if (!deleted?.length) console.warn('[sync] deleteChantier: aucune ligne supprimée');
      } catch (e: any) {
        console.error('[sync] deleteChantier exception:', e?.message ?? e);
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
    AsyncStorage.setItem(MOCK_SITE_PLANS_KEY, JSON.stringify(allPlans)).catch(() => {});
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
      const { error } = await supabase.from('site_plans').insert({
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
      if (error) console.warn('[sync] addSitePlan server error:', error.message);
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation]);

  const updateSitePlan = useCallback(async (p: SitePlan) => {
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), old =>
      (old ?? []).map(x => x.id === p.id ? p : x)
    );
    const allPlans = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    AsyncStorage.setItem(MOCK_SITE_PLANS_KEY, JSON.stringify(allPlans)).catch(() => {});
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'site_plans', op: 'update', filter: { column: 'id', value: p.id }, data: {
        chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, uploaded_at: p.uploadedAt, size: p.size ?? null,
      }});
      return;
    }
    if (isSupabaseConfigured) {
      supabase.from('site_plans').update({
        chantier_id: p.chantierId, name: p.name,
        building: p.building ?? null, level: p.level ?? null,
        building_id: p.buildingId ?? null, level_id: p.levelId ?? null,
        uri: p.uri ?? null, file_type: p.fileType ?? null, dxf_name: p.dxfName ?? null,
        uploaded_at: p.uploadedAt, size: p.size ?? null,
        revision_code: p.revisionCode ?? null, revision_number: p.revisionNumber ?? null,
        parent_plan_id: p.parentPlanId ?? null, is_latest_revision: p.isLatestRevision ?? null,
        revision_note: p.revisionNote ?? null, annotations: p.annotations ?? null,
        pdf_page_count: p.pdfPageCount ?? null,
      }).eq('id', p.id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] updateSitePlan error:', error.message);
      });
    }
  }, [queryClient, isOnlineRef, enqueueOperation]);

  const deleteSitePlan = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<SitePlan[]>(queryKeys.sitePlans()) ?? [];
    const previous = prev.find(p => p.id === id);
    queryClient.setQueryData<SitePlan[]>(queryKeys.sitePlans(), prev.filter(p => p.id !== id));
    AsyncStorage.setItem(MOCK_SITE_PLANS_KEY, JSON.stringify(prev.filter(p => p.id !== id))).catch(() => {});
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'site_plans', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await supabase.from('site_plans').delete().eq('id', id).select();
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
    AsyncStorage.setItem(MOCK_SITE_PLANS_KEY, JSON.stringify(updatedPlans)).catch(() => {});
    if (isSupabaseConfigured) {
      const { error: updateErr } = await supabase.from('site_plans')
        .update({ is_latest_revision: false, revision_number: parentRevNum }).eq('id', parentPlanId);
      if (updateErr) console.error('[addSitePlanVersion] update parent error:', updateErr.message);
      const { error: insertErr } = await supabase.from('site_plans').insert({
        id: versionedNew.id, chantier_id: versionedNew.chantierId, name: versionedNew.name,
        uri: versionedNew.uri ?? null, file_type: versionedNew.fileType ?? null,
        dxf_name: versionedNew.dxfName ?? null, size: versionedNew.size ?? null,
        building: versionedNew.building ?? null, level: versionedNew.level ?? null,
        building_id: versionedNew.buildingId ?? null, level_id: versionedNew.levelId ?? null,
        revision_code: finalRevCode, revision_number: revNum,
        parent_plan_id: parentPlanId, is_latest_revision: true,
        revision_note: versionedNew.revisionNote ?? null, organization_id: orgId,
      });
      if (insertErr) console.warn('[sync] addSitePlanVersion insert error:', insertErr.message);
    }
  }, [queryClient, user, isOnlineRef]);

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
        supabase.from('reserves').update({ plan_id: toPlanId }).eq('id', r.id)
      )).then(results => {
        if (results.some((res: any) => res.error)) console.warn('[sync] migrateReservesToPlan some errors');
      });
    }
    return migrated.length;
  }, [queryClient]);

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
