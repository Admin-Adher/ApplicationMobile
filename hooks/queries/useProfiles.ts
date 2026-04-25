import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { Profile } from '@/constants/types';
import { mergeWithCache, readCache, writeCache, pendingIdsForTable, isSupabaseSessionValid } from '@/lib/offlineCache';

const MOCK_PROFILES: Profile[] = [
  { id: 'demo-0', name: 'Admin Système', role: 'admin', roleLabel: 'Administrateur', email: 'admin@buildtrack.fr' },
  { id: 'demo-1', name: 'Jean Dupont', role: 'conducteur', roleLabel: 'Conducteur de travaux', email: 'j.dupont@buildtrack.fr' },
  { id: 'demo-2', name: 'Marie Martin', role: 'chef_equipe', roleLabel: "Chef d'équipe", email: 'm.martin@buildtrack.fr' },
  { id: 'demo-3', name: 'Pierre Lambert', role: 'observateur', roleLabel: 'Observateur', email: 'p.lambert@buildtrack.fr' },
];

export function useProfiles() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  const PROFILES_CACHE_KEY = 'buildtrack_profiles_cache_v1';
  const query = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: async (): Promise<Profile[]> => {
      let cached = await readCache<Profile>(PROFILES_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<Profile[]>(queryKeys.profiles());
      if (!cached && rqCached?.length) cached = rqCached;
      else if (cached && rqCached?.length) {
        const cachedIds = new Set(cached.map(p => p.id));
        const extra = rqCached.filter(p => !cachedIds.has(p.id));
        if (extra.length) cached = [...cached, ...extra];
      }
      if (!isSupabaseConfigured) return (cached?.length ? cached : MOCK_PROFILES);
      if (!(await isSupabaseSessionValid())) return (cached?.length ? cached : MOCK_PROFILES);
      try {
        const q = user?.organizationId
          ? (supabase as any).from('profiles').select('id, name, role, role_label, email, company_id, organization_id').eq('organization_id', user.organizationId)
          : (supabase as any).from('profiles').select('id, name, role, role_label, email, company_id, organization_id');
        const { data, error } = await q;
        if (error) throw error;
        const fresh = (data ?? []).map((p: any) => ({
          id: p.id, name: p.name, role: p.role, roleLabel: p.role_label, email: p.email,
          companyId: p.company_id ?? undefined,
          organizationId: p.organization_id ?? undefined,
        }));
        const merged = mergeWithCache<Profile>(fresh, cached);
        // Note: profiles aren't mutated through the offline queue, so no
        // pendingIds are needed — the server is always the source of truth.
        await writeCache(PROFILES_CACHE_KEY, merged, userId);
        return merged.length > 0 ? merged : MOCK_PROFILES;
      } catch (err) {
        console.warn('[useProfiles] fetch failed, using cache', err);
        return (cached?.length ? cached : MOCK_PROFILES);
      }
    },
    enabled: !!user,
    staleTime: 10 * 60 * 1000,
  });

  return {
    profiles: query.data ?? MOCK_PROFILES,
    isLoadingProfiles: query.isLoading,
    invalidateProfiles: () => queryClient.invalidateQueries({ queryKey: queryKeys.profiles() }),
  };
}
