import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { JournalEntry } from '@/constants/types';
import { useStartupDelay } from '@/hooks/useStartupDelay';
import {
  mergeWithCache,
  readCache,
  writeCache,
  pendingIdsForTable,
  isSupabaseSessionValid,
} from '@/lib/offlineCache';

/**
 * Journal de chantier — persistance Supabase (table `journal_entries`).
 *
 * Reprend le pattern offline-first de useVisites / PointageContext :
 *  1. cache AsyncStorage lu en premier (affichage instantané + mode offline)
 *  2. fetch Supabase scoppé par organization_id quand la session est valide
 *  3. écritures optimistes + file offline (NetworkContext.enqueueOperation)
 *  4. migration one-shot des anciennes données locales (buildtrack_journal_v2/v1)
 */

const JOURNAL_TABLE = 'journal_entries';
const JOURNAL_CACHE_KEY = 'buildtrack_journal_cache_v1';
const JOURNAL_MIGRATED_KEY = 'buildtrack_journal_migrated_v1';
const LEGACY_JOURNAL_KEYS = ['buildtrack_journal_v2', 'buildtrack_journal_v1'];
const JOURNAL_QUERY_KEY = ['journal_entries'] as const;

export interface JournalEntryWithChantier extends JournalEntry {
  chantierId?: string | null;
}

/** dd/mm/yyyy → yyyy-mm-dd ('' si invalide) */
function frToISODate(frDate: string): string {
  const parts = (frDate ?? '').split('/');
  if (parts.length !== 3 || parts[2].length !== 4) return '';
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/** yyyy-mm-dd → dd/mm/yyyy (renvoie la valeur brute si non ISO) */
function isoToFRDate(isoDate: string): string {
  const parts = (isoDate ?? '').split('-');
  if (parts.length !== 3 || parts[0].length !== 4) return isoDate ?? '';
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Timestamp FR « dd/mm/yyyy[ hh:mm] » (ou déjà ISO) → ISO 8601.
 * Renvoie undefined quand la valeur n'est pas convertible : l'appelant omet
 * alors la colonne et laisse le `default now()` côté serveur.
 * Partagé avec useChecklists.
 */
export function frTimestampToISO(fr: string | null | undefined): string | undefined {
  if (!fr) return undefined;
  const m = fr.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    const d = new Date(
      Number(m[3]), Number(m[2]) - 1, Number(m[1]),
      Number(m[4] ?? 0), Number(m[5] ?? 0),
    );
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  // Pas au format FR — peut-être déjà ISO.
  const d = new Date(fr);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Tri affichage : entry_date desc puis created_at desc (comme le serveur). */
function sortJournalEntries(list: JournalEntryWithChantier[]): JournalEntryWithChantier[] {
  return [...list].sort((a, b) => {
    const da = frToISODate(a.date);
    const db = frToISODate(b.date);
    if (da !== db) return db.localeCompare(da);
    const ca = frTimestampToISO(a.createdAt) ?? '';
    const cb = frTimestampToISO(b.createdAt) ?? '';
    return cb.localeCompare(ca);
  });
}

function toJournalEntry(row: any): JournalEntryWithChantier {
  return {
    id: String(row.id),
    date: isoToFRDate(row.entry_date ?? ''),
    weather: row.weather ?? '',
    workerCount: typeof row.worker_count === 'number' ? row.worker_count : 0,
    workDone: row.work_done ?? '',
    materials: row.materials ?? '',
    incidents: row.incidents ?? '',
    observations: row.observations ?? '',
    visitors: row.visitors ?? '',
    author: row.author ?? '',
    createdAt: row.created_at ?? '',
    chantierId: row.chantier_id ?? null,
  };
}

function fromJournalEntry(
  e: JournalEntryWithChantier,
  orgId: string | null,
  authorId: string | null,
): Record<string, any> {
  // Conserver la date de création réelle (saisie offline, données migrées)
  // plutôt que la date de synchronisation. Omise si non convertible
  // (le serveur applique alors son default now()).
  const createdAtISO = frTimestampToISO(e.createdAt);
  return {
    id: e.id,
    organization_id: orgId,
    chantier_id: e.chantierId ?? null,
    entry_date: frToISODate(e.date),
    weather: e.weather ?? '',
    worker_count: e.workerCount ?? 0,
    work_done: e.workDone ?? '',
    materials: e.materials ?? '',
    incidents: e.incidents ?? '',
    observations: e.observations ?? '',
    visitors: e.visitors ?? '',
    author: e.author ?? '',
    author_id: authorId,
    ...(createdAtISO ? { created_at: createdAtISO } : {}),
  };
}

async function readLegacyJournal(): Promise<JournalEntry[]> {
  for (const key of LEGACY_JOURNAL_KEYS) {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
  }
  return [];
}

/**
 * Migration one-shot : pousse vers Supabase les entrées encore uniquement
 * locales (ids absents du serveur), puis pose un drapeau. Les données locales
 * ne sont PAS supprimées (filet de sécurité).
 */
async function migrateLegacyJournal(
  serverIds: Set<string>,
  orgId: string | null,
  authorId: string | null,
): Promise<JournalEntryWithChantier[]> {
  try {
    const done = await AsyncStorage.getItem(JOURNAL_MIGRATED_KEY);
    if (done) return [];
    const legacy = await readLegacyJournal();
    if (legacy.length === 0) {
      await AsyncStorage.setItem(JOURNAL_MIGRATED_KEY, 'done').catch(() => {});
      return [];
    }
    const toUpload = legacy.filter(e => e?.id && !serverIds.has(String(e.id)));
    if (toUpload.length === 0) {
      await AsyncStorage.setItem(JOURNAL_MIGRATED_KEY, 'done').catch(() => {});
      return [];
    }
    const payloads = toUpload.map(e =>
      fromJournalEntry({ ...e, chantierId: null }, orgId, authorId),
    );
    const { error } = await (supabase as any)
      .from(JOURNAL_TABLE)
      .upsert(payloads, { onConflict: 'id', ignoreDuplicates: true });
    if (error) {
      console.warn('[useJournal] migration locale → Supabase échouée (retentera plus tard):', error.message);
      return [];
    }
    await AsyncStorage.setItem(JOURNAL_MIGRATED_KEY, 'done').catch(() => {});
    console.warn(`[useJournal] migration one-shot : ${toUpload.length} entrée(s) locale(s) envoyée(s) vers Supabase`);
    return toUpload.map(e => ({ ...e, chantierId: null }));
  } catch (err) {
    console.warn('[useJournal] migration locale échouée:', err);
    return [];
  }
}

export function useJournal() {
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
    queryKey: JOURNAL_QUERY_KEY,
    queryFn: async (): Promise<JournalEntryWithChantier[]> => {
      let cached = await readCache<JournalEntryWithChantier>(JOURNAL_CACHE_KEY, userId);
      const rqCached = queryClient.getQueryData<JournalEntryWithChantier[]>(JOURNAL_QUERY_KEY);
      if (!cached && rqCached?.length) cached = rqCached;
      if (!isSupabaseConfigured) {
        // Mode local/démo : on continue de servir les données locales.
        if (cached?.length) return cached;
        return (await readLegacyJournal()) as JournalEntryWithChantier[];
      }
      if (!(await isSupabaseSessionValid())) return cached ?? [];
      if (!queueLoaded) return cached ?? [];
      try {
        let q = ((supabase as any).from(JOURNAL_TABLE) as any)
          .select('*')
          .order('entry_date', { ascending: false })
          .order('created_at', { ascending: false });
        if (user!.role !== 'super_admin' && user!.organizationId) {
          q = q.eq('organization_id', user!.organizationId);
        }
        const { data, error } = await q;
        if (error) throw error;
        let fresh = (data ?? []).map(toJournalEntry);
        // Migration one-shot des anciennes entrées AsyncStorage.
        const uploaded = await migrateLegacyJournal(
          new Set(fresh.map((f: JournalEntryWithChantier) => f.id)),
          user!.organizationId ?? null,
          user!.id ?? null,
        );
        if (uploaded.length > 0) fresh = [...uploaded, ...fresh];
        const pendingIds = pendingIdsForTable(queueRef.current ?? [], JOURNAL_TABLE);
        const merged = sortJournalEntries(
          mergeWithCache<JournalEntryWithChantier>(fresh, cached, pendingIds, { queueLoaded }),
        );
        await writeCache(JOURNAL_CACHE_KEY, merged, userId);
        return merged;
      } catch (err) {
        console.warn('[useJournal] fetch failed, using cache', err);
        return cached ?? [];
      }
    },
    enabled: !!user && startupReady,
  });

  const persist = useCallback((entries: JournalEntryWithChantier[]) => {
    writeCache(JOURNAL_CACHE_KEY, entries, userId);
  }, [userId]);

  const addEntry = useCallback(async (entry: JournalEntryWithChantier) => {
    const orgId = user?.organizationId ?? null;
    const authorId = user?.id ?? null;
    queryClient.setQueryData<JournalEntryWithChantier[]>(JOURNAL_QUERY_KEY, old => {
      if ((old ?? []).some(x => x.id === entry.id)) return old ?? [];
      return [entry, ...(old ?? [])];
    });
    persist(queryClient.getQueryData<JournalEntryWithChantier[]>(JOURNAL_QUERY_KEY) ?? []);
    if (!isSupabaseConfigured) return;
    const payload = fromJournalEntry(entry, orgId, authorId);
    if (!isOnlineRef.current) {
      enqueueOperation({ table: JOURNAL_TABLE, op: 'insert', data: payload });
      return;
    }
    const { error } = await (supabase as any).from(JOURNAL_TABLE).insert(payload);
    if (error) {
      console.warn('[sync] addJournalEntry error, queuing for retry:', error.message);
      enqueueOperation({ table: JOURNAL_TABLE, op: 'insert', data: payload });
    }
  }, [queryClient, user, enqueueOperation, persist]);

  return {
    entries: query.data ?? [],
    isLoadingJournal: query.isLoading,
    addEntry,
    invalidateJournal: () => queryClient.invalidateQueries({ queryKey: JOURNAL_QUERY_KEY }),
  };
}
