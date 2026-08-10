import { useEffect, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
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
  const [reconnectSeq, setReconnectSeq] = useState(0);

  useEffect(() => {
    if (!isSupabaseConfigured || Platform.OS === 'web') return;
    let backgroundAt = 0;
    let lastReconnectAt = 0;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
        if (sleptMs > 5000 && Date.now() - lastReconnectAt > 2000) {
          lastReconnectAt = Date.now();
          setReconnectSeq(seq => seq + 1);
        }
      } else if (state === 'background' || state === 'inactive') {
        backgroundAt = Date.now();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!user?.id) return;

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

      if (user?.role === 'magasinier') {
        const warehouseTables = [
          { table: 'chantiers', queryKey: queryKeys.chantiers() },
          { table: 'companies', queryKey: queryKeys.companies() },
          { table: 'inventory_products', queryKey: ['inventory', 'products'] as const },
          { table: 'inventory_movements', queryKey: ['inventory', 'movements'] as const },
        ];
        for (const item of warehouseTables) {
          const channel = supabase
            .channel(`rq-warehouse-${item.table}-v1-${uid}`)
            .on('postgres_changes', orgFilter(item.table), () => {
              queryClient.invalidateQueries({ queryKey: item.queryKey });
              if (item.table === 'inventory_movements') {
                queryClient.invalidateQueries({ queryKey: ['inventory', 'products'] });
              }
            })
            .subscribe();
          channels.push(channel);
        }
        cleanupFn = () => channels.forEach(channel => supabase.removeChannel(channel));
        return;
      }

      // Org-scoped table subscriptions
      const reserveSub = supabase
        .channel(`rq-reserves-v2-${uid}`)
        .on('postgres_changes', orgFilter('reserves'), () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.reserves() });
        })
        .subscribe(status => {
          if (status !== 'SUBSCRIBED') return;
          // Realtime does not replay changes missed while its database
          // connection was down. Reconcile the full server snapshot whenever
          // the channel (re)subscribes so delayed offline inserts cannot remain
          // hidden behind an older local cache.
          void queryClient.refetchQueries({
            queryKey: queryKeys.reserves(),
            type: 'active',
          });
        });
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

      const inventoryProductSub = supabase
        .channel(`rq-inventory-products-v1-${uid}`)
        .on('postgres_changes', orgFilter('inventory_products'), () => {
          queryClient.invalidateQueries({ queryKey: ['inventory', 'products'] });
        })
        .subscribe();
      channels.push(inventoryProductSub);

      const inventoryMovementSub = supabase
        .channel(`rq-inventory-movements-v1-${uid}`)
        .on('postgres_changes', orgFilter('inventory_movements'), () => {
          queryClient.invalidateQueries({ queryKey: ['inventory', 'movements'] });
          queryClient.invalidateQueries({ queryKey: ['inventory', 'products'] });
        })
        .subscribe();
      channels.push(inventoryMovementSub);

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
  }, [queryClient, user?.id, user?.organizationId, user?.role, reconnectSeq]);
}
