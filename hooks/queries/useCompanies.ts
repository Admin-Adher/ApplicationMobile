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
import { offlineQuery, writeCache } from '@/lib/offlineCache';

const COMPANIES_CACHE_KEY = 'buildtrack_companies_cache_v1';

export function useCompanies() {
  const { user } = useAuth();
  const { isOnline, enqueueOperation } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  const query = useQuery({
    queryKey: queryKeys.companies(),
    queryFn: async (): Promise<Company[]> => {
      const fetchFn = isSupabaseConfigured
        ? async () => {
            const { data, error } = await supabase.from('companies').select('*');
            if (error) throw error;
            const raw = data ?? [];
            const seenIds = new Set<string>();
            const seenNames = new Set<string>();
            return raw.map(toCompany).filter(c => {
              const nameKey = c.name.trim().toLowerCase();
              if (seenIds.has(c.id) || seenNames.has(nameKey)) return false;
              seenIds.add(c.id); seenNames.add(nameKey); return true;
            });
          }
        : null;
      return offlineQuery<Company>(COMPANIES_CACHE_KEY, fetchFn);
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const persist = useCallback((companies: Company[]) => {
    writeCache(COMPANIES_CACHE_KEY, companies);
  }, []);

  const addCompany = useCallback(async (c: Company) => {
    const orgId = user?.organizationId ?? null;
    const existing = queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? [];
    const nameKey = c.name.trim().toLowerCase();
    if (existing.some(x => x.id === c.id || x.name.trim().toLowerCase() === nameKey)) return;
    const newList = [...existing, c];
    queryClient.setQueryData<Company[]>(queryKeys.companies(), newList);
    persist(newList);
    const payload = {
      id: c.id, name: c.name, short_name: c.shortName ?? null, color: c.color,
      planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
      hours_worked: c.hoursWorked, zone: c.zone ?? null, contact: c.phone ?? null,
      email: c.email ?? null, lots: c.lots ?? null, siret: c.siret ?? null,
      insurance: c.insurance ?? null, qualifications: c.qualifications ?? null,
      organization_id: orgId,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'companies', op: 'insert', data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('companies').insert(payload);
      if (error) console.warn('[sync] addCompany error:', error.message);
    }
  }, [queryClient, user, isOnlineRef, enqueueOperation, persist]);

  const updateCompanyFull = useCallback(async (c: Company) => {
    queryClient.setQueryData<Company[]>(queryKeys.companies(), old =>
      (old ?? []).map(x => x.id === c.id ? c : x)
    );
    persist(queryClient.getQueryData<Company[]>(queryKeys.companies()) ?? []);
    const payload = {
      name: c.name, short_name: c.shortName ?? null, color: c.color,
      planned_workers: c.plannedWorkers, actual_workers: c.actualWorkers,
      hours_worked: c.hoursWorked, zone: c.zone ?? null, contact: c.phone ?? null,
      email: c.email ?? null, lots: c.lots ?? null, siret: c.siret ?? null,
      insurance: c.insurance ?? null, qualifications: c.qualifications ?? null,
    };
    if (!isOnlineRef.current && isSupabaseConfigured) {
      enqueueOperation({ table: 'companies', op: 'update', filter: { column: 'id', value: c.id }, data: payload });
      return;
    }
    if (isSupabaseConfigured) {
      supabase.from('companies').update(payload).eq('id', c.id).then(({ error }: { error: any }) => {
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
      const { data: deleted, error } = await supabase.from('companies').delete().eq('id', id).select();
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
      supabase.from('companies').update({ actual_workers: actual }).eq('id', id)
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
      supabase.from('companies').update({ hours_worked: hours }).eq('id', id)
        .then(({ error }: { error: any }) => {
          if (error) console.warn('[sync] updateCompanyHours error:', error.message);
        });
    }
  }, [queryClient, isOnlineRef, enqueueOperation, persist]);

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
