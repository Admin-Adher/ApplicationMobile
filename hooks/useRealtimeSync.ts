import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

const REALTIME_STARTUP_DELAY_MS = 1500;

export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let cleanupFn: (() => void) | null = null;

    const timer = setTimeout(() => {
      const reserveSub = supabase
        .channel('rq-reserves-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reserves' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.reserves() });
        })
        .subscribe();

      const taskSub = supabase
        .channel('rq-tasks-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.tasks() });
        })
        .subscribe();

      const chantierSub = supabase
        .channel('rq-chantiers-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chantiers' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.chantiers() });
        })
        .subscribe();

      const sitePlanSub = supabase
        .channel('rq-site-plans-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_plans' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.sitePlans() });
        })
        .subscribe();

      const visiteSub = supabase
        .channel('rq-visites-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'visites' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.visites() });
        })
        .subscribe();

      const lotSub = supabase
        .channel('rq-lots-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'lots' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.lots() });
        })
        .subscribe();

      const oprSub = supabase
        .channel('rq-oprs-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'oprs' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.oprs() });
        })
        .subscribe();

      const companySub = supabase
        .channel('rq-companies-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'companies' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.companies() });
        })
        .subscribe();

      const photoSub = supabase
        .channel('rq-photos-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.photos() });
        })
        .subscribe();

      const documentSub = supabase
        .channel('rq-documents-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.documents() });
        })
        .subscribe();

      const profileSub = supabase
        .channel('rq-profiles-v1')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.profiles() });
        })
        .subscribe();

      cleanupFn = () => {
        supabase.removeChannel(reserveSub);
        supabase.removeChannel(taskSub);
        supabase.removeChannel(chantierSub);
        supabase.removeChannel(sitePlanSub);
        supabase.removeChannel(visiteSub);
        supabase.removeChannel(lotSub);
        supabase.removeChannel(oprSub);
        supabase.removeChannel(companySub);
        supabase.removeChannel(photoSub);
        supabase.removeChannel(documentSub);
        supabase.removeChannel(profileSub);
      };
    }, REALTIME_STARTUP_DELAY_MS);

    return () => {
      clearTimeout(timer);
      cleanupFn?.();
    };
  }, [queryClient]);
}
