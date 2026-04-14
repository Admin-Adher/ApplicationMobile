import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/context/AuthContext';

const REALTIME_STARTUP_DELAY_MS = 1500;

// Tables that have organization_id and should be filtered per-org
const ORG_TABLES = [
  'reserves', 'tasks', 'chantiers', 'site_plans', 'visites',
  'lots', 'oprs', 'companies', 'photos', 'documents',
] as const;

// Tables without organization_id (global or user-scoped)
const GLOBAL_TABLES = ['profiles'] as const;

export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cleanupFn: (() => void) | null = null;

    const timer = setTimeout(() => {
      const uid = user?.id ?? 'anon';
      const orgId = user?.organizationId ?? null;
      const isSuperAdmin = user?.role === 'super_admin';

      // Helper: build a postgres_changes filter object, adding org filter for non-super_admin
      const orgFilter = (table: string) =>
        !isSuperAdmin && orgId
          ? { event: '*' as const, schema: 'public', table, filter: `organization_id=eq.${orgId}` }
          : { event: '*' as const, schema: 'public', table };

      const channels: ReturnType<typeof supabase.channel>[] = [];

      // Org-scoped table subscriptions
      const reserveSub = supabase
        .channel(`rq-reserves-v2-${uid}`)
        .on('postgres_changes', orgFilter('reserves'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.reserves() });
        })
        .subscribe();
      channels.push(reserveSub);

      const taskSub = supabase
        .channel(`rq-tasks-v2-${uid}`)
        .on('postgres_changes', orgFilter('tasks'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
        })
        .subscribe();
      channels.push(taskSub);

      const chantierSub = supabase
        .channel(`rq-chantiers-v2-${uid}`)
        .on('postgres_changes', orgFilter('chantiers'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.chantiers() });
        })
        .subscribe();
      channels.push(chantierSub);

      const sitePlanSub = supabase
        .channel(`rq-site-plans-v2-${uid}`)
        .on('postgres_changes', orgFilter('site_plans'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.sitePlans() });
        })
        .subscribe();
      channels.push(sitePlanSub);

      const visiteSub = supabase
        .channel(`rq-visites-v2-${uid}`)
        .on('postgres_changes', orgFilter('visites'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.visites() });
        })
        .subscribe();
      channels.push(visiteSub);

      const lotSub = supabase
        .channel(`rq-lots-v2-${uid}`)
        .on('postgres_changes', orgFilter('lots'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.lots() });
        })
        .subscribe();
      channels.push(lotSub);

      const oprSub = supabase
        .channel(`rq-oprs-v2-${uid}`)
        .on('postgres_changes', orgFilter('oprs'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.oprs() });
        })
        .subscribe();
      channels.push(oprSub);

      const companySub = supabase
        .channel(`rq-companies-v2-${uid}`)
        .on('postgres_changes', orgFilter('companies'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.companies() });
        })
        .subscribe();
      channels.push(companySub);

      const photoSub = supabase
        .channel(`rq-photos-v2-${uid}`)
        .on('postgres_changes', orgFilter('photos'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.photos() });
        })
        .subscribe();
      channels.push(photoSub);

      const documentSub = supabase
        .channel(`rq-documents-v2-${uid}`)
        .on('postgres_changes', orgFilter('documents'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.documents() });
        })
        .subscribe();
      channels.push(documentSub);

      // Global tables (no org filter)
      const profileSub = supabase
        .channel(`rq-profiles-v2-${uid}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.profiles() });
        })
        .subscribe();
      channels.push(profileSub);

      cleanupFn = () => {
        channels.forEach(ch => supabase.removeChannel(ch));
      };
    }, REALTIME_STARTUP_DELAY_MS);

    return () => {
      clearTimeout(timer);
      cleanupFn?.();
    };
  }, [queryClient, user?.id, user?.organizationId, user?.role]);
}
