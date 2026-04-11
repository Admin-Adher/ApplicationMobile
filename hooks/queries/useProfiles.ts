import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { Profile } from '@/constants/types';
import { offlineQuery, writeCache } from '@/lib/offlineCache';

const MOCK_PROFILES: Profile[] = [
  { id: 'demo-0', name: 'Admin Système', role: 'admin', roleLabel: 'Administrateur', email: 'admin@buildtrack.fr' },
  { id: 'demo-1', name: 'Jean Dupont', role: 'conducteur', roleLabel: 'Conducteur de travaux', email: 'j.dupont@buildtrack.fr' },
  { id: 'demo-2', name: 'Marie Martin', role: 'chef_equipe', roleLabel: "Chef d'équipe", email: 'm.martin@buildtrack.fr' },
  { id: 'demo-3', name: 'Pierre Lambert', role: 'observateur', roleLabel: 'Observateur', email: 'p.lambert@buildtrack.fr' },
];

export function useProfiles() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.profiles(),
    queryFn: async (): Promise<Profile[]> => {
      const fetchFn = isSupabaseConfigured
        ? async () => {
            const q = user?.organizationId
              ? supabase.from('profiles').select('id, name, role, role_label, email').eq('organization_id', user.organizationId)
              : supabase.from('profiles').select('id, name, role, role_label, email');
            const { data, error } = await q;
            if (error) throw error;
            return (data ?? []).map((p: any) => ({
              id: p.id, name: p.name, role: p.role, roleLabel: p.role_label, email: p.email,
            }));
          }
        : null;
      const result = await offlineQuery<Profile>('buildtrack_profiles_cache_v1', fetchFn);
      return result.length > 0 ? result : MOCK_PROFILES;
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
