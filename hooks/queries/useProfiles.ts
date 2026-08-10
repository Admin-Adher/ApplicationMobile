import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { Profile } from '@/constants/types';
import { ROLE_LABELS } from '@/constants/roles';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const MOCK_PROFILES: Profile[] = [
  { id: 'demo-0', name: 'System Admin', role: 'admin', roleLabel: ROLE_LABELS.admin, email: 'admin@buildtrack.fr' },
  { id: 'demo-1', name: 'Jean Dupont', role: 'conducteur', roleLabel: ROLE_LABELS.conducteur, email: 'j.dupont@buildtrack.fr' },
  { id: 'demo-2', name: 'Marie Martin', role: 'chef_equipe', roleLabel: ROLE_LABELS.chef_equipe, email: 'm.martin@buildtrack.fr' },
  { id: 'demo-3', name: 'Pierre Lambert', role: 'observateur', roleLabel: ROLE_LABELS.observateur, email: 'p.lambert@buildtrack.fr' },
];

export function useProfiles() {
  const { user } = useAuth();
  const { queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const PROFILES_CACHE_KEY = 'buildtrack_profiles_cache_v1';

  useEffect(() => {
    if (!userId) return;
    readCache<Profile>(PROFILES_CACHE_KEY, userId).then(manualCached => {
      if (!manualCached?.length) return;
      const rqCurrent = queryClient.getQueryData<Profile[]>(queryKeys.profiles());
      if (!rqCurrent?.length) return;
      const manualIds = new Set(manualCached.map(p => p.id));
      if (rqCurrent.some(p => !manualIds.has(p.id))) {
        queryClient.setQueryData<Profile[]>(queryKeys.profiles(), rqCurrent.filter(p => manualIds.has(p.id)));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const query = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: async (): Promise<Profile[]> => {
      let cached = await readCache<Profile>(PROFILES_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Profile[]>(queryKeys.profiles());
      if (!cached && rqCached?.length) cached = rqCached;
      if (!isSupabaseConfigured) return (cached?.length ? cached : MOCK_PROFILES);
      if (!(await isSupabaseSessionValid())) return (cached?.length ? cached : MOCK_PROFILES);
      if (!queueLoaded) return (cached?.length ? cached : MOCK_PROFILES);
      try {
        const q = user?.organizationId
          ? (supabase as any).from('profiles').select('id, name, role, role_label, email, company_id, organization_id, preferred_language').eq('organization_id', user.organizationId)
          : (supabase as any).from('profiles').select('id, name, role, role_label, email, company_id, organization_id, preferred_language');
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map((p: any) => ({
          id: p.id, name: p.name, role: p.role, roleLabel: p.role_label, email: p.email,
          companyId: p.company_id ?? undefined,
          organizationId: p.organization_id ?? undefined,
          preferredLanguage: p.preferred_language ?? undefined,
        }));
        const merged = mergeWithCache<Profile>(fresh, cached, new Set<string>(), { queueLoaded });
        // Note: profiles aren't mutated through the offline queue, so no
        // pendingIds are needed — the server is always the source of truth.
        await writeCache(PROFILES_CACHE_KEY, merged, userId);
        return merged.length > 0 ? merged : MOCK_PROFILES;
      } catch (err) {
        console.warn('[useProfiles] fetch failed, using cache', err);
        return (cached?.length ? cached : MOCK_PROFILES);
      }
    },
    enabled: !!user && user.role !== 'magasinier',
  });

  return {
    profiles: query.data ?? MOCK_PROFILES,
    isLoadingProfiles: query.isLoading,
    invalidateProfiles: () => queryClient.invalidateQueries({ queryKey: queryKeys.profiles() }),
  };
}
