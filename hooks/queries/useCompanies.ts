import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { toCompany } from '@/lib/mappers';
import { Company } from '@/constants/types';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const COMPANIES_CACHE_KEY = 'buildtrack_companies_cache_v1';

export function useCompanies() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    if (!userId) return;
    readCache<Company>(COMPANIES_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Company[]>(queryKeys.companies());
      if (!rqCurrent?.length) return;
      const manualIds = new Set(manualCached.map(c => c.id));
      if (rqCurrent.some(c => !manualIds.has(c.id))) {
        queryClient.setQueryData<Company[]>(queryKeys.companies(), rqCurrent.filter(c => manualIds.has(c.id)));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const query = useQuery({
    queryKey: queryKeys.companies(),
    queryFn: async (): Promise<Company[]> => {
      let cached = await readCache<Company>(COMPANIES_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Company[]>(queryKeys.companies());
      if (!cached && rqCached?.length) cached = rqCached;

      // No backend (mock mode)
      if (!isSupabaseConfigured) {
        return cached ?? [];
      }
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];

      // Try online fetch; merge with cache to keep local-only (offline-created) items.
      try {
        let q = (supabase.from('companies') as any).select('*');
        // Non-super_admin users should only see their own org's companies.
        // Super_admin sees all (filtered client-side by organizationId).
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const raw = data ?? [];
        const seenIds = new Set<string>();
        const seenNames = new Set<string>();
        const fresh = raw.map(toCompany).filter((c: Company) => {
          const nameKey = c.name.trim().toLowerCase();
          if (seenIds.has(c.id) || seenNames.has(nameKey)) return false;
          seenIds.add(c.id); seenNames.add(nameKey); return true;
        });
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], 'companies');
        const merged = mergeWithCache<Company>(fresh, cached, pendingIds, { queueLoaded });
        await writeCache(COMPANIES_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn(`[useCompanies] fetch failed, using cache`, err);
        return cached ?? [];
      }
    },
    enabled: !!user,
  });

  const persist = useCallback((companies: Company[]) => {
    writeCache(COMPANIES_CACHE_KEY, companies, userId);
  }, [userId]);

  const addCompany = useCallback(async (c: Company) => {
    const orgId = user?.organizationId ?? null;
    const existing = queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? [];
    const nameKey = c.name.trim().toLowerCase();
    if (existing.some(x => x.id === c.id || x.name.trim().toLowerCase() === nameKey)) return;
    // Ensure organizationId is set before first cache write to avoid stale cache on restart.
    const companyWithOrg = c.organizationId ? c : { ...c, organizationId: orgId ?? undefined };
    const newList = [...existing, companyWithOrg];
    queryClient.setQueryData<Company[]>(queryKeys.companies(), newList);
    persist(newList);
    const payload = {
      id: c.id, name: c.name, short_name: c.shortName ?? '', color: c.color,
      planned_workers: c.plannedWorkers ?? 0, actual_workers: c.actualWorkers ?? 0,
      hours_worked: c.hoursWorked ?? 0, zone: c.zone ?? '', contact: c.phone ?? '',
      email: c.email ?? null, lots: c.lots ?? null, siret: c.siret ?? null,
      insurance: c.insurance ?? null, qualifications: c.qualifications ?? null,
      organization_id: orgId,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'companies', op: 'insert', data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await (supabase.from('companies') as any).insert(payload);
      if (error) {
        console.warn('[sync] addCompany error:', error.message);
        Alert.alert(
          'Synchronisation incomplète',
          `L'entreprise a été créée localement mais n'a pas pu être synchronisée (${error.message}).`
        );
      }
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const updateCompanyFull = useCallback(async (c: Company) => {
    queryClient.setQueryData<Company[]>(queryKeys.companies(), old =>
      (old ?? []).map(x => x.id === c.id ? c : x)
    );
    persist(queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? []);
    const payload = {
      name: c.name, short_name: c.shortName ?? '', color: c.color,
      planned_workers: c.plannedWorkers ?? 0, actual_workers: c.actualWorkers ?? 0,
      hours_worked: c.hoursWorked ?? 0, zone: c.zone ?? '', contact: c.phone ?? '',
      email: c.email ?? null, lots: c.lots ?? null, siret: c.siret ?? null,
      insurance: c.insurance ?? null, qualifications: c.qualifications ?? null,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'companies', op: 'update', filter: { column: 'id', value: c.id }, data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      (supabase.from('companies') as any).update(payload).eq('id', c.id).then(({ error }: { error: any }) => {
        if (error) console.warn('[sync] updateCompanyFull error:', error.message);
      });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  const deleteCompany = useCallback(async (id: string) => {
    const prev = queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? [];
    const previous = prev.find(c => c.id === id);
    queryClient.setQueryData<Company[]>(queryKeys.companies(), prev.filter(c => c.id !== id));
    persist(prev.filter(c => c.id !== id));
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'companies', op: 'delete', filter: { column: 'id', value: id } });
      return;
    }
    if (isSupabaseConfigured) {
      const { data: deleted, error } = await (supabase.from('companies') as any).delete().eq('id', id).select();
      if (error) {
        console.warn('[sync] deleteCompany erreur serveur:', error.message);
        if (previous) {
          queryClient.setQueryData<Company[]>(queryKeys.companies(), old => [...(old ?? []), previous]);
          Alert.alert('Suppression refusée', 'Vous n\'avez pas les droits pour supprimer cette entreprise, ou elle n\'existe plus sur le serveur.');
        }
      } else if (!deleted?.length) {
        console.warn('[sync] deleteCompany: aucune ligne supprimée');
      }
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  const updateCompanyWorkers = useCallback(async (id: string, actual: number) => {
    const companies = queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? [];
    const company = companies.find(c => c.id === id);
    if (!company) return;
    const updated = { ...company, actualWorkers: actual };
    queryClient.setQueryData<Company[]>(queryKeys.companies(), old =>
      (old ?? []).map(c => c.id === id ? updated : c)
    );
    persist(queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? []);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'companies', op: 'update', filter: { column: 'id', value: id }, data: { actual_workers: actual } });
      return;
    }
    if (isSupabaseConfigured) {
      (supabase.from('companies') as any).update({ actual_workers: actual }).eq('id', id)
        .then(({ error }: { error: any }) => {
          if (error) console.warn('[sync] updateCompanyWorkers error:', error.message);
        });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  const updateCompanyHours = useCallback(async (id: string, hours: number) => {
    queryClient.setQueryData<Company[]>(queryKeys.companies(), old =>
      (old ?? []).map(c => c.id === id ? { ...c, hoursWorked: hours } : c)
    );
    persist(queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? []);
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'companies', op: 'update', filter: { column: 'id', value: id }, data: { hours_worked: hours } });
      return;
    }
    if (isSupabaseConfigured) {
      (supabase.from('companies') as any).update({ hours_worked: hours }).eq('id', id)
        .then(({ error }: { error: any }) => {
          if (error) console.warn('[sync] updateCompanyHours error:', error.message);
        });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

  // Synchronisation temps réel : rechargement automatique quand une entreprise change
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    const channel = (supabase as any)
      .channel('realtime-companies')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'companies' },
        (_payload: any) => {
          queryClient.invalidateQueries({ queryKey: queryKeys.companies() });
        }
      )
      .subscribe();
    return () => {
      (supabase as any).removeChannel(channel);
    };
  }, [userId, queryClient]);

  return {
    companies: query.data ?? [],
    isLoadingCompanies: query.isLoading,
    addCompany,
    updateCompanyFull,
    deleteCompany,
    updateCompanyWorkers,
    updateCompanyHours,
    invalidateCompanies: () => queryClient.invalidateQueries({ queryKey: queryKeys.companies() }),
  };
}
