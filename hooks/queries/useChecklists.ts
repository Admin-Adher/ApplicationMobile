import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { Checklist, ChecklistItem } from '@/constants/types';
import { formatDateFR } from '@/lib/utils';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import { frTimestampToISO } from '@/hooks/queries/useJournal';
import {
  mergeWithCache,
  readCache,
  writeCache,
  pendingIdsForTable,
  isSupabaseSessionValid,
} from '@/lib/offlineCache';

/**
 * Checklists de chantier — persistance Supabase (table `checklists`).
 *
 * Même pattern offline-first que useJournal / useVisites :
 *  1. cache AsyncStorage lu en premier (affichage instantané + mode offline)
 *  2. fetch Supabase scoppé par organization_id quand la session est valide
 *  3. écritures optimistes + file offline (NetworkContext.enqueueOperation)
 *  4. migration one-shot des anciennes données locales (buildtrack_checklists_v1)
 *
 * Schéma serveur : items jsonb [{ id, label, done }] — le mobile utilise
 * `checked` ; le mapping done ↔ checked est fait ici. Les champs purement
 * client (type, building, zone, level, status, completedAt) ne sont pas en
 * base : status est re-dérivé des items à la lecture.
 */

const CHECKLISTS_TABLE = 'checklists';
const CHECKLISTS_CACHE_KEY = 'buildtrack_checklists_cache_v1';
const CHECKLISTS_MIGRATED_KEY = 'buildtrack_checklists_migrated_v1';
const LEGACY_CHECKLISTS_KEY = 'buildtrack_checklists_v1';
const CHECKLISTS_QUERY_KEY = ['checklists'] as const;

export interface ChecklistWithChantier extends Checklist {
  chantierId?: string | null;
}

function deriveStatus(items: ChecklistItem[]): Checklist['status'] {
  if (items.length > 0 && items.every(it => it.checked)) return 'completed';
  if (items.some(it => it.checked)) return 'in_progress';
  return 'draft';
}

function toChecklist(row: any): ChecklistWithChantier {
  const rawItems = Array.isArray(row.items) ? row.items : [];
  const items: ChecklistItem[] = rawItems.map((it: any, idx: number) => ({
    id: String(it?.id ?? `${row.id}-item-${idx}`),
    label: String(it?.label ?? ''),
    // Schéma contractuel : `done` ; tolère `checked` (anciennes lignes éventuelles).
    checked: !!(it?.done ?? it?.checked),
    ...(it?.note ? { note: String(it.note) } : {}),
  }));
  return {
    id: String(row.id),
    title: row.title ?? '',
    type: 'custom',
    building: '',
    zone: '',
    level: '',
    status: deriveStatus(items),
    items,
    createdAt: row.created_at ? formatDateFR(new Date(row.created_at)) : '',
    createdBy: row.author ?? '',
    chantierId: row.chantier_id ?? null,
  };
}

function fromChecklist(
  cl: ChecklistWithChantier,
  orgId: string | null,
  authorId: string | null,
): Record<string, any> {
  const createdAtISO = frTimestampToISO(cl.createdAt);
  return {
    id: cl.id,
    organization_id: orgId,
    chantier_id: cl.chantierId ?? null,
    title: cl.title ?? '',
    items: (cl.items ?? []).map(it => ({
      id: it.id,
      label: it.label,
      done: !!it.checked,
      ...(it.note ? { note: it.note } : {}),
    })),
    author: cl.createdBy ?? '',
    author_id: authorId,
    ...(createdAtISO ? { created_at: createdAtISO } : {}),
  };
}

async function readLegacyChecklists(): Promise<Checklist[]> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_CHECKLISTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [];
}

/**
 * Migration one-shot : pousse vers Supabase les checklists encore uniquement
 * locales (ids absents du serveur), puis pose un drapeau. Les données locales
 * ne sont PAS supprimées (filet de sécurité).
 */
async function migrateLegacyChecklists(
  serverIds: Set<string>,
  orgId: string | null,
  authorId: string | null,
): Promise<ChecklistWithChantier[]> {
  try {
    const done = await AsyncStorage.getItem(CHECKLISTS_MIGRATED_KEY);
    if (done) return [];
    const legacy = await readLegacyChecklists();
    if (legacy.length === 0) {
      await AsyncStorage.setItem(CHECKLISTS_MIGRATED_KEY, 'done').catch(() => {});
      return [];
    }
    const toUpload = legacy.filter(cl => cl?.id && !serverIds.has(String(cl.id)));
    if (toUpload.length === 0) {
      await AsyncStorage.setItem(CHECKLISTS_MIGRATED_KEY, 'done').catch(() => {});
      return [];
    }
    const payloads = toUpload.map(cl =>
      fromChecklist({ ...cl, chantierId: null }, orgId, authorId),
    );
    const { error } = await (supabase as any)
      .from(CHECKLISTS_TABLE)
      .upsert(payloads, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      console.warn('[useChecklists] migration locale → Supabase échouée (retentera plus tard):', error.message);
      return [];
    }
    await AsyncStorage.setItem(CHECKLISTS_MIGRATED_KEY, 'done').catch(() => {});
    console.warn(`[useChecklists] migration one-shot : ${toUpload.length} checklist(s) locale(s) envoyée(s) vers Supabase`);
    return toUpload.map(cl => ({ ...cl, chantierId: null }));
  } catch (err) {
    console.warn('[useChecklists] migration locale échouée:', err);
    return [];
  }
}

export function useChecklists() {
  const { user } = useAuth();
  const userId = user?.id;
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const startupReady = useStartupDelay(!!user);

  const query = useQuery({
    queryKey: CHECKLISTS_QUERY_KEY,
    queryFn: async (): Promise<ChecklistWithChantier[]> => {
      let cached = await readCache<ChecklistWithChantier>(CHECKLISTS_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<ChecklistWithChantier[]>(CHECKLISTS_QUERY_KEY);
      if (!cached && rqCached?.length) cached = rqCached;
      if (!isSupabaseConfigured) {
        // Mode local/démo : on continue de servir les données locales.
        if (cached?.length) return cached;
        return (await readLegacyChecklists()) as ChecklistWithChantier[];
      }
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];
      try {
        let q = ((supabase as any).from(CHECKLISTS_TABLE) as any)
          .select('*')
          .order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        let fresh = (data ?? []).map(toChecklist);
        // Migration one-shot des anciennes checklists AsyncStorage.
        const uploaded = await migrateLegacyChecklists(
          new Set(fresh.map((f: ChecklistWithChantier) => f.id)),
          user!.organizationId ?? null,
          user!.id ?? null,
        );
        if (uploaded.length > 0) fresh = [...uploaded, ...fresh];
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], CHECKLISTS_TABLE);
        const merged = mergeWithCache<ChecklistWithChantier>(fresh, cached, pendingIds, { queueLoaded });
        await writeCache(CHECKLISTS_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn('[useChecklists] fetch failed, using cache', err);
        return cached ?? [];
      }
    },
    enabled: !!user && user.role !== 'magasinier' && startupReady,
  });

  const persist = useCallback((checklists: ChecklistWithChantier[]) => {
    writeCache(CHECKLISTS_CACHE_KEY, checklists, userId);
  }, [userId]);

  const addChecklist = useCallback(async (cl: ChecklistWithChantier) => {
    const orgId = user?.organizationId ?? null;
    const authorId = user?.id ?? null;
    queryClient.setQueryData<ChecklistWithChantier[]>(CHECKLISTS_QUERY_KEY, old => {
      if ((old ?? []).some(x => x.id === cl.id)) return old ?? [];
      return [cl, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<ChecklistWithChantier[]>(CHECKLISTS_QUERY_KEY) ?? []);
    if (!isSupabaseConfigured) return;
    const payload = fromChecklist(cl, orgId, authorId);
    if (!isOnlineRef.current) {
      enqueueOperation({ table: CHECKLISTS_TABLE, op: 'insert', data: payload });
      return;
    }
    const { error } = await (supabase as any).from(CHECKLISTS_TABLE).insert(payload);
    if (error) {
      console.warn('[sync] addChecklist error, queuing for retry:', error.message);
      enqueueOperation({ table: CHECKLISTS_TABLE, op: 'insert', data: payload });
    }
  }, [queryClient, user, enqueueOperation, persist]);

  const updateChecklist = useCallback(async (cl: ChecklistWithChantier) => {
    queryClient.setQueryData<ChecklistWithChantier[]>(CHECKLISTS_QUERY_KEY, old =>
      (old ?? []).map(x => x.id === cl.id ? cl : x)
    );
    persist(queryClient.getQueryData<ChecklistWithChantier[]>(CHECKLISTS_QUERY_KEY) ?? []);
    if (!isSupabaseConfigured) return;
    const orgId = user?.organizationId ?? null;
    // Ne pas réécrire id / organization_id / created_at sur un update.
    const { id, organization_id, created_at, ...fields } = fromChecklist(cl, orgId, user?.id ?? null);
    const payload = { ...fields, updated_at: new Date().toISOString() };
    if (!isOnlineRef.current) {
      enqueueOperation({ table: CHECKLISTS_TABLE, op: 'update', filter: { column: 'id', value: cl.id }, data: payload });
      return;
    }
    const { error } = await (supabase as any).from(CHECKLISTS_TABLE).update(payload).eq('id', cl.id);
    if (error) {
      console.warn('[sync] updateChecklist error, queuing for retry:', error.message);
      enqueueOperation({ table: CHECKLISTS_TABLE, op: 'update', filter: { column: 'id', value: cl.id }, data: payload });
    }
  }, [queryClient, user, enqueueOperation, persist]);

  return {
    checklists: query.data ?? [],
    isLoadingChecklists: query.isLoading,
    addChecklist,
    updateChecklist,
    invalidateChecklists: () => queryClient.invalidateQueries({ queryKey: CHECKLISTS_QUERY_KEY }),
  };
}
