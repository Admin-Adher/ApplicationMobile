import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback,
} from 'react';
import { Platform, AppState, AppStateStatus, InteractionManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured, resetAuthLock, SUPABASE_KEY, SUPABASE_URL } from '@/lib/supabase';
import { isLocalUri, uploadLocalPhotosInPayload, purgeOrphanedPhotoFiles } from '@/lib/storage';
import { getSupabaseRestAccessToken, supabaseRestMutation, supabaseRestRpc, supabaseRestSelect } from '@/lib/supabaseRest';
import { isSessionExpired } from '@/lib/sessionExpiry';
import {
  commitCachePairWithJournalStrict,
  forceRefreshSession,
  getSessionFromStorage,
  readCacheStrict,
  writeCache,
} from '@/lib/offlineCache';
import { normalizeVisitePayloadForSupabase } from '@/lib/mappers';
import { useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { RESERVES_CACHE_KEY } from '@/lib/cacheKeys';
import { triggerMessagePush, triggerReserveCreatedPush } from '@/lib/push/client';
import type { Comment, InventoryMovement, InventoryProduct, Reserve } from '@/constants/types';
import {
  applyReservePatchOperation,
  buildRequestHash,
  firstReserveMutationResult,
  isReserveMutationRpcUnavailable,
  newOperationId,
  type ReserveMutationResult,
} from '@/lib/reserveOutbox';
import i18n from '@/lib/i18n';
import {
  getSyncQueueCounts,
  hasReplayableQueuedOperations,
  inventoryOutcomeTranslationKey,
  isReplayableQueuedOperation,
  type SyncQueueTerminalOutcome,
} from '@/lib/syncQueuePolicy';
import {
  coalesceQueuedOperations,
  migrateAndCoalesceSitePlanSnapshots,
} from '@/lib/offlineQueueCoalescing';
import {
  inventoryMovementsCacheKey,
  inventoryOutcomeContextFromQueuedOperation,
  inventoryProductsCacheKey,
  isTerminalInventoryMovementOutcome,
  normalizeInventoryMovementOutcome,
  reconcileTerminalInventoryMovementCache,
  type InventoryMovementOutcome,
} from '@/lib/inventoryMovementOutcome';

const OFFLINE_QUEUE_PREFIX = 'buildtrack_offline_queue_v3_';
const OFFLINE_QUEUE_BACKUP_PREFIX = 'buildtrack_offline_queue_backup_v1_';

// Délai max pour l'étape d'upload de fichiers (photos / plan) d'UNE opération.
// Chaque fichier a déjà sa propre borne (120 s photo/document) côté storage.ts,
// mais une opération peut enchaîner plusieurs fichiers : on borne l'étape
// complète pour qu'un upload gelé fasse échouer proprement l'opération
// (réessayée au passage suivant) au lieu de figer toute la file.
const UPLOAD_STEP_TIMEOUT_MS = 150_000;
const SYNC_KICK_DELAY_MS = 250;
const SYNC_AUTH_RETRY_DELAY_MS = 5_000;
const SYNC_INFRA_BACKOFF_BASE_MS = 30_000;
const SYNC_INFRA_BACKOFF_MAX_MS = 5 * 60_000;

// Borne pour le rafraîchissement du token et le refetch post-sync, afin qu'un
// appel réseau bloqué en fin de passe ne laisse pas la file verrouillée.
const TOKEN_REFRESH_TIMEOUT_MS = 20_000;
const REFETCH_TIMEOUT_MS = 30_000;

// Si une passe de synchronisation ne fait AUCUN progrès pendant ce délai, on la
// considère « zombie » (await réseau/fichier resté bloqué malgré les bornes) et
// on autorise une nouvelle passe à la préempter. Filet de sécurité ultime
// contre le blocage définitif observé (« opérations en attente » figées des
// jours, bouton de sync gelé sur « 0/1 »). Largement supérieur à la durée d'une
// passe légitime, donc jamais déclenché en fonctionnement normal.
const SYNC_STUCK_RECOVERY_MS = 10 * 60 * 1000;

function syncErrorStatus(error: any): number {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const explicitStatus = Number(error?.status);
  const messageStatus = Number(message.match(/\bhttp\s+(\d{3})/)?.[1]);
  return Number.isFinite(explicitStatus) && explicitStatus > 0
    ? explicitStatus
    : messageStatus;
}

function isAuthenticationSyncFailure(error: any): boolean {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  return (
    syncErrorStatus(error) === 401
    || code === 'PGRST301'
    || /jwt.*(?:expired|invalid)/.test(message)
    || /invalid.*jwt/.test(message)
  );
}

function isInfrastructureSyncFailure(error: any): boolean {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  const status = syncErrorStatus(error);

  return (
    code === 'REST_TIMEOUT'
    || status === 429
    || status === 544
    || status === 502
    || status === 503
    || status === 504
    || status === 520
    || status === 522
    || status === 524
    || status === 530
    || /database.*tim(?:ed|e)\s*out/.test(message)
    || /statement timeout/.test(message)
    || /connection.*timeout/.test(message)
    || /connection terminated/.test(message)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StatusConflict {
  id: string;
  reserveId: string;
  reserveTitle: string;
  serverStatus: string;
  localStatus: string;
  author: string;
  history: any[];
  closedAt?: string;
  closedBy?: string;
}

/**
 * A comment-level delta for task comment mutations.
 *
 * Stored in the queue instead of a full `comments` array snapshot so the sync
 * engine can fetch the server state and apply each delta by comment ID — making
 * comment ops safe in the face of concurrent writes from other devices.
 *
 * - `add`    : insert `comment` if its `id` is not already in the server array.
 * - `edit`   : find the comment by `commentId`, update `content` and `editedAt`.
 * - `delete` : remove the comment by `commentId`.
 */
export interface CommentPatch {
  action: 'add' | 'edit' | 'delete';
  /** Full comment object — required for `add`. */
  comment?: Comment;
  /** Target comment ID — required for `edit` and `delete`. */
  commentId?: string;
  /** New text — required for `edit`. */
  newContent?: string;
  /** ISO timestamp — set for `edit`. */
  editedAt?: string;
}

export interface PhotoPatch {
  action: 'upsert' | 'delete';
  /** Photos to merge by ID into the reserve gallery. */
  photos?: any[];
  /** Legacy first-photo field kept in sync with the gallery. */
  photoUri?: string | null;
  /** Photo IDs to remove when action === 'delete'. */
  photoIds?: string[];
}

/**
 * A single queued offline mutation.
 *
 * Generic operations: table + op + filter + data → replayed verbatim against Supabase.
 * Status-change operations also carry a conflictCheck so we can detect concurrent edits.
 * Comment/photo operations carry patches so each delta is merged server-side by ID.
 */
export interface QueuedOperation {
  id: string;
  queuedAt: string;
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  filter?: { column: string; value: string };
  data?: Record<string, any>;
  /** Opt-in key for full snapshots where only the newest queued value matters. */
  coalesceKey?: string;
  /** Present for atomic Postgres functions replayed through PostgREST RPC. */
  rpc?: { fn: string; args?: Record<string, any> };
  /** Present only for reserve-status mutations. */
  conflictCheck?: {
    entityId: string;
    previousStatus: string;
    newStatus: string;
    author: string;
    history: any[];
    closedAt?: string;
    closedBy?: string;
  };
  /**
   * Present only for task comment mutations (add / edit / delete a single comment).
   * When set, `data` is ignored — the engine fetches the server's `comments` array
   * and applies the patch by comment ID before writing back.
   */
  commentPatch?: CommentPatch;
  /**
   * Present only for reserve photo-only retries. The engine fetches the live
   * server gallery and merges/removes by photo ID instead of overwriting the
   * whole `photos` array with a stale offline snapshot.
   */
  photoPatch?: PhotoPatch;
  /** Last server error captured during a failed sync attempt (set by processSyncQueue). */
  lastError?: string;
  /** Number of failed sync attempts. */
  attemptCount?: number;
  /** Server row version observed when the user made this mutation. */
  baseVersion?: number | null;
  /** Terminal failures stay visible but are not replayed automatically. */
  terminal?: boolean;
  terminalStatus?: string;
  /** Structured server result persisted for domain-aware acknowledgement UX. */
  terminalOutcome?: SyncQueueTerminalOutcome;
}

/**
 * Roll back a terminal inventory movement in both React Query and the durable
 * offline snapshots. This runs inside the queue engine, so acknowledgement in
 * Settings cannot discard the only reconciliation evidence before an inventory
 * screen happens to mount.
 */
async function reconcileTerminalInventoryOperationCache(
  operation: QueuedOperation,
  outcome: SyncQueueTerminalOutcome,
  userId: string | undefined,
): Promise<boolean> {
  if (operation.rpc?.fn !== 'record_inventory_movement' || outcome.domain !== 'inventory') return false;
  if (!userId) throw new Error('Authenticated user required for inventory cache reconciliation.');

  const context = inventoryOutcomeContextFromQueuedOperation(operation);
  const chantierId = outcome.chantierId ?? context.chantierId;
  if (!chantierId) throw new Error('Chantier required for inventory cache reconciliation.');

  const productsStorageKey = inventoryProductsCacheKey(chantierId);
  const movementsStorageKey = inventoryMovementsCacheKey(chantierId);
  const reconciliationJournalKey = [
    'buildtrack_inventory_terminal_reconciliation_v1',
    chantierId,
    outcome.operationId ?? operation.id,
  ].join('_');
  const productsQueryKey = queryKeys.inventoryProducts(chantierId);
  const movementsQueryKey = queryKeys.inventoryMovements(chantierId);
  const typedOutcome = outcome as InventoryMovementOutcome;

  const [storedProducts, storedMovements] = await Promise.all([
    readCacheStrict<InventoryProduct>(productsStorageKey, userId),
    readCacheStrict<InventoryMovement>(movementsStorageKey, userId),
  ]);
  const persisted = reconcileTerminalInventoryMovementCache({
    currentProducts: storedProducts ?? [],
    currentMovements: storedMovements ?? [],
    outcome: typedOutcome,
  });

  const queryProducts = queryClient.getQueryData<InventoryProduct[]>(productsQueryKey);
  const queryMovements = queryClient.getQueryData<InventoryMovement[]>(movementsQueryKey);
  const queried = reconcileTerminalInventoryMovementCache({
    currentProducts: queryProducts ?? storedProducts ?? [],
    currentMovements: queryMovements ?? storedMovements ?? [],
    outcome: typedOutcome,
  });

  if (queried.changed || persisted.changed) {
    const hasQuerySnapshot = queryProducts !== undefined || queryMovements !== undefined;
    if (queried.changed || !hasQuerySnapshot) {
      const visible = queried.changed ? queried : persisted;
      queryClient.setQueryData(productsQueryKey, visible.products);
      queryClient.setQueryData(movementsQueryKey, visible.movements);
    }
  }

  const hasCompleteQuerySnapshot = queryProducts !== undefined && queryMovements !== undefined;
  const durable = hasCompleteQuerySnapshot && !queried.changed
    ? queried
    : persisted.changed
      ? persisted
      : queried;
  const committed = await commitCachePairWithJournalStrict({
    journalKey: reconciliationJournalKey,
    firstKey: productsStorageKey,
    firstData: durable.products,
    secondKey: movementsStorageKey,
    secondData: durable.movements,
    userId,
  });

  // A resumed journal is the authoritative target for the interrupted commit.
  // Replace the potentially half-hydrated visible pair with that same atomic
  // target; the normal post-sync refetch then brings in any newer server data.
  if (committed.resumed) {
    queryClient.setQueryData(productsQueryKey, committed.firstData);
    queryClient.setQueryData(movementsQueryKey, committed.secondData);
  }

  return queried.changed || persisted.changed || committed.resumed;
}

export type SyncStatus = 'idle' | 'syncing' | 'conflict' | 'done' | 'error';

interface NetworkContextValue {
  isOnline: boolean;
  queue: QueuedOperation[];
  /** Number of operations that can still be replayed. */
  queueCount: number;
  /** Number of deterministic server rejections kept only for user acknowledgement. */
  rejectedCount: number;
  /** Rejected plus non-terminal stuck operations, without double-counting. */
  attentionCount: number;
  /**
   * Number of queued operations that have failed ≥ 3 times and are considered
   * "stuck" — they need manual attention (retry or clear) in Settings.
   */
  stuckCount: number;
  /**
   * `true` once the offline queue has been hydrated from AsyncStorage for the
   * current user. Read-side hooks (useReserves, usePhotos, …) MUST gate any
   * cache-overwriting fetch on this — fetching before the queue is loaded can
   * miss pending mutations and let an empty server response wipe the cache.
   */
  queueLoaded: boolean;
  syncStatus: SyncStatus;
  /**
   * Live progress while `syncStatus === 'syncing'`. `total` is the number of
   * operations the current pass started with, `done` is how many have been
   * processed (success or failure) so far. Both are 0 outside an active sync.
   */
  syncProgress: { done: number; total: number };
  /**
   * `true` when the last sync pass was skipped because no authenticated
   * session is available (expired/revoked refresh token). Replaying would go
   * out with the read-only anon key and every op would burn a `42501` failure,
   * so the queue is held intact until the user logs in again.
   */
  syncAuthBlocked: boolean;
  conflicts: StatusConflict[];
  enqueueOperation: (op: Omit<QueuedOperation, 'id' | 'queuedAt'>) => void;
  resolveConflict: (conflictId: string, chosenStatus: string) => Promise<void>;
  dismissConflicts: () => void;
  registerReloadHandler: (fn: () => void) => void;
  clearQueue: () => Promise<void>;
  dismissRejectedOperations: () => Promise<void>;
  retrySync: () => Promise<void>;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  queue: [],
  queueCount: 0,
  rejectedCount: 0,
  attentionCount: 0,
  stuckCount: 0,
  queueLoaded: true,
  syncStatus: 'idle',
  syncProgress: { done: 0, total: 0 },
  syncAuthBlocked: false,
  conflicts: [],
  enqueueOperation: () => {},
  resolveConflict: async () => {},
  dismissConflicts: () => {},
  registerReloadHandler: () => {},
  clearQueue: async () => {},
  dismissRejectedOperations: async () => {},
  retrySync: async () => {},
});

export function useNetwork() {
  return useContext(NetworkContext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function genQueueId() {
  return newOperationId();
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert',
  in_progress: 'En cours',
  waiting: 'En attente',
  verification: 'Vérification',
  closed: 'Clôturé',
};

// Ping URLs for native connectivity detection
const PING_URLS = [
  'https://clients3.google.com/generate_204',
  'https://connectivitycheck.gstatic.com/generate_204',
];
const OFFLINE_CONFIRMATION_FAILURES = 2;

// Reusable promise timeout helper (does not need a label in this context)
function withTimeoutMs<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

async function checkInternetReachable(): Promise<boolean> {
  for (const url of PING_URLS) {
    try {
      const res = await withTimeoutMs(fetch(url, { method: 'GET', cache: 'no-cache' }), 8000);
      if (res.ok || res.status === 204 || res.status === 404) return true;
    } catch {}
  }
  return false;
}

async function checkSupabaseReachable(): Promise<boolean> {
  if (!isSupabaseConfigured || !SUPABASE_URL || !SUPABASE_KEY) return true;
  try {
    const res = await withTimeoutMs(fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      cache: 'no-cache',
      headers: {
        apikey: SUPABASE_KEY,
      },
    }), 12000);
    return res.ok;
  } catch {
    return false;
  }
}

async function checkAppOnline(navigatorOnline = true): Promise<boolean> {
  if (!navigatorOnline) return false;
  if (isSupabaseConfigured) {
    if (await checkSupabaseReachable()) return true;
    if (await checkInternetReachable()) return true;
    // A cached Supabase JWT keeps the user authenticated offline, but it is
    // not a connectivity signal. Returning false here lets the UI communicate
    // "hors connexion" while AuthContext continues to serve the cached session.
    return false;
  }
  if (Platform.OS !== 'web') {
    return checkInternetReachable();
  }
  return true;
}

async function healSupabaseSessionAfterWake(longSleep: boolean): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try { resetAuthLock(); } catch {}
  try { (supabase as any).auth?.startAutoRefresh?.(); } catch {}

  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const { data } = await withTimeoutMs(
      (supabase as any).auth.getSession(),
      longSleep ? 5000 : 3000,
    ) as any;
    const session = data?.session;
    if (session?.access_token && (!session.expires_at || session.expires_at - 30 > nowSec)) {
      return true;
    }
  } catch {}

  try {
    const { data } = await withTimeoutMs(
      (supabase as any).auth.refreshSession(),
      longSleep ? 8000 : 5000,
    ) as any;
    const session = data?.session;
    if (session?.access_token) return true;
  } catch (err) {
    console.log('[wake] refreshSession failed:', (err as any)?.message ?? err);
  }

  try {
    const cached = await getSessionFromStorage();
    if (cached?.access_token && typeof cached.expires_at === 'number' && cached.expires_at - 30 > nowSec) {
      return true;
    }
    const token = await forceRefreshSession();
    return !!token;
  } catch {
    return false;
  }
}

async function refetchActiveQueries(reason: string): Promise<void> {
  try {
    if (Platform.OS !== 'web') {
      await new Promise<void>(resolve => {
        InteractionManager.runAfterInteractions(() => resolve());
      });
    }
    await queryClient.invalidateQueries({ refetchType: 'none' });
    await queryClient.refetchQueries({ type: 'active' });
  } catch (err) {
    console.warn(`[query] foreground refetch failed (${reason}):`, (err as any)?.message ?? err);
  }
}

const QUEUE_ORG_SCOPED_INSERT_TABLES = new Set(['reserves', 'photos', 'site_plans', 'chantiers']);

const CRITICAL_SOFT_DELETE_RPCS: Record<string, { fn: string; idArg: string; reason: string }> = {
  photos: { fn: 'soft_delete_photo', idArg: 'p_photo_id', reason: 'offline_queue_soft_delete_photo' },
  site_plans: { fn: 'soft_delete_site_plan', idArg: 'p_plan_id', reason: 'offline_queue_soft_delete_site_plan' },
  chantiers: { fn: 'soft_delete_chantier', idArg: 'p_chantier_id', reason: 'offline_queue_soft_delete_chantier' },
};

function hydrateQueuedOrganizationId(
  table: string,
  data: Record<string, any> | null | undefined,
  organizationId: string | null | undefined,
  role: string | null | undefined,
): Record<string, any> | undefined {
  if (!data || !organizationId || !QUEUE_ORG_SCOPED_INSERT_TABLES.has(table)) return data ?? undefined;

  const currentOrg = data.organization_id;
  if (!currentOrg || (role !== 'super_admin' && currentOrg !== organizationId)) {
    return { ...data, organization_id: organizationId };
  }

  return data;
}

function reservePhotoRowsForRpcPayload(source: Record<string, any>, author?: string | null): any[] {
  const rows = new Map<string, any>();
  const seenUris = new Set<string>();
  const reserveId = String(source.id ?? '');
  const location = [source.building, source.level, source.zone].filter(Boolean).join(' - ');
  const takenAt = source.created_at ?? new Date().toISOString().split('T')[0];
  const takenBy = author || 'BuildTrack';

  const add = (photo: any, index: number) => {
    const uri = typeof photo?.uri === 'string' ? photo.uri : '';
    if (!uri) return;
    const id = String(photo?.id ?? `${reserveId}-photo-${index + 1}`);
    if (seenUris.has(uri) || rows.has(id)) return;
    seenUris.add(uri);
    rows.set(id, {
      id,
      uri,
      comment: photo?.comment ?? `Photo reserve ${reserveId}`,
      location: photo?.location ?? location,
      taken_at: photo?.takenAt ?? photo?.taken_at ?? takenAt,
      taken_by: photo?.takenBy ?? photo?.taken_by ?? takenBy,
      color_code: photo?.colorCode ?? photo?.color_code ?? (source.kind === 'observation' ? '#0EA5E9' : '#EF4444'),
    });
  };

  if (Array.isArray(source.photos)) {
    source.photos.forEach(add);
  }
  if (typeof source.photo_uri === 'string' && source.photo_uri) {
    add({ id: `${reserveId}-cover`, uri: source.photo_uri }, rows.size);
  }

  return Array.from(rows.values());
}

async function applySyncedReservePhotoPayloadToCache(
  userId: string | undefined,
  reserveId: string,
  uploadedData: Record<string, any>,
): Promise<void> {
  const hasPhotoUri = Object.prototype.hasOwnProperty.call(uploadedData, 'photo_uri');
  const hasPhotos = Object.prototype.hasOwnProperty.call(uploadedData, 'photos');
  if (!hasPhotoUri && !hasPhotos) return;

  let nextReserves: Reserve[] | null = null;
  queryClient.setQueryData<Reserve[]>(queryKeys.reserves(), old => {
    if (!old?.length) return old;
    let changed = false;
    const next = old.map(reserve => {
      if (reserve.id !== reserveId) return reserve;
      changed = true;
      return {
        ...reserve,
        photoUri: hasPhotoUri ? (uploadedData.photo_uri ?? undefined) : reserve.photoUri,
        photos: hasPhotos
          ? (Array.isArray(uploadedData.photos) && uploadedData.photos.length > 0 ? uploadedData.photos : undefined)
          : reserve.photos,
      };
    });
    if (!changed) return old;
    nextReserves = next;
    return next;
  });

  if (nextReserves) {
    await writeCache<Reserve>(RESERVES_CACHE_KEY, nextReserves, userId);
  }
}

function countLocalPhotoUris(data: Record<string, any> | null | undefined): number {
  if (!data) return 0;
  let n = 0;
  if (typeof data.photo_uri === 'string' && isLocalUri(data.photo_uri)) n += 1;
  if (typeof data.photo_url === 'string' && isLocalUri(data.photo_url)) n += 1;
  if (Array.isArray(data.photos)) {
    for (const p of data.photos) {
      if (p && typeof p.uri === 'string' && isLocalUri(p.uri)) n += 1;
    }
  }
  if (typeof data.uri === 'string' && isLocalUri(data.uri)) n += 1;
  return n;
}

/**
 * Plafond de temps pour l'étape d'upload d'une opération, proportionnel au
 * nombre de photos locales restant à envoyer : les uploads sont séquentiels et
 * chacun peut légitimement prendre jusqu'à ~120 s sur une connexion de
 * chantier. Un plafond fixe de 150 s condamnait toute réserve à 2-3 photos à
 * expirer en boucle (« timeout after 150000ms ») en perdant son progrès.
 */
function uploadStepTimeoutMs(data: Record<string, any> | null | undefined): number {
  return UPLOAD_STEP_TIMEOUT_MS * Math.max(1, countLocalPhotoUris(data));
}

function queueReplayPriority(op: QueuedOperation): number {
  if (op.op === 'rpc' && op.rpc?.fn === 'create_reserve_with_photos') return 10;
  if (op.op === 'rpc' && op.rpc?.fn === 'record_inventory_movement') return 12;
  if (op.op === 'rpc' && op.rpc?.fn === 'update_inventory_product') return 13;
  if (op.op === 'rpc' && op.rpc?.fn === 'create_site_plan_revision_with_reserve_migration') return 15;
  if (op.table === 'reserves' && op.op === 'insert') return 10;
  if (op.table === 'photos' && op.op === 'insert') return 20;
  return 30;
}

type ReserveRebaseResult =
  | { kind: 'applied'; outcome: ReserveMutationResult }
  // À ré-enfiler : nouvel operation_id + base_version rafraîchie pour réessayer.
  | { kind: 'retry'; baseVersion: number | null; operationId: string; reason: string }
  | { kind: 'terminal'; status: string; message?: string };

/**
 * Résout un `version_conflict` sur une réserve.
 *
 * Pourquoi c'est nécessaire : `apply_reserve_patch` mémorise son résultat (y
 * compris un `version_conflict`) dans `reserve_outbox_operations`, indexé par
 * `operation_id`. Rejouer la MÊME opération (même id + même hash, donc même
 * `base_version`) renvoie indéfiniment le conflit mémorisé — l'opération reste
 * coincée pour toujours (« 5 fallos · version_conflict »).
 *
 * La seule issue est de REBASER : on ré-applique le patch sur la version
 * courante du serveur avec un NOUVEL `operation_id` (donc un nouveau hash →
 * réévaluation fraîche). Comme ce chemin ne touche qu'à des champs « simples »
 * (statut, photos, commentaires ont leurs propres mutations dédiées et sont
 * refusés ici), appliquer l'édition locale par-dessus la dernière version est
 * le comportement attendu : l'édition de l'utilisateur prend effet (dernier
 * écrivain gagne, par champ), au lieu d'être bloquée ou perdue.
 */
async function rebaseReservePatchOnConflict(
  reserveId: string,
  patch: Record<string, any>,
  conflict: ReserveMutationResult,
): Promise<ReserveRebaseResult> {
  // Version courante la plus fraîche connue : celle renvoyée par le conflit,
  // sinon un SELECT direct (le conflit peut être un résultat mémorisé, donc
  // potentiellement périmé).
  let currentVersion: number | null =
    typeof conflict.current_version === 'number' ? conflict.current_version : null;
  if (currentVersion === null) {
    try {
      const { data: rows } = await supabaseRestSelect<any>(
        'reserves',
        'version',
        { column: 'id', value: reserveId },
      );
      const v = rows?.[0]?.version;
      currentVersion = typeof v === 'number' ? v : null;
    } catch {}
  }

  const operationId = newOperationId();
  const rpc = await applyReservePatchOperation({ operationId, reserveId, baseVersion: currentVersion, patch });

  if (rpc.error) {
    // Erreur réseau : on réessaie au prochain passage. On réutilise le même
    // operation_id (idempotent : si l'écriture a en fait abouti, le serveur
    // renverra le résultat mémorisé).
    return { kind: 'retry', baseVersion: currentVersion, operationId, reason: rpc.error?.message ?? 'network' };
  }

  const outcome = firstReserveMutationResult(rpc.data);
  if (!outcome || outcome.status === 'ok') {
    return { kind: 'applied', outcome: outcome ?? { status: 'ok', reserve_id: reserveId } };
  }
  if (outcome.status === 'version_conflict') {
    // Écriture concurrente entre le SELECT et l'apply : on réessaie au prochain
    // passage avec la nouvelle version et un NOUVEL operation_id (l'actuel est
    // désormais mémorisé avec un conflit).
    return {
      kind: 'retry',
      baseVersion: typeof outcome.current_version === 'number' ? outcome.current_version : currentVersion,
      operationId: newOperationId(),
      reason: 'version_conflict',
    };
  }
  return { kind: 'terminal', status: outcome.status, message: outcome.message };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const offlineQueueKey = OFFLINE_QUEUE_PREFIX + (userId ?? 'anon');
  const offlineQueueBackupKey = OFFLINE_QUEUE_BACKUP_PREFIX + (userId ?? 'anon');
  const [isOnline, setIsOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [syncAuthBlocked, setSyncAuthBlocked] = useState(false);
  const [conflicts, setConflicts] = useState<StatusConflict[]>([]);

  const prevOnlineRef = useRef(true);
  const syncingRef = useRef(false);
  // Jeton de génération : chaque passe de sync capture le sien. Si une passe
  // « zombie » est préemptée, sa génération devient obsolète et elle n'a plus
  // le droit d'écrire l'état de la file ni de relâcher le verrou (évite qu'une
  // passe gelée, en se réveillant tardivement, écrase le travail de la passe
  // qui l'a remplacée).
  const syncGenerationRef = useRef(0);
  // Horodatage du dernier progrès (incrément d'opération traitée). Sert à
  // détecter une passe gelée sans pénaliser une passe lente mais qui avance.
  const syncProgressAtRef = useRef(0);
  const reloadHandlerRef = useRef<(() => void) | null>(null);
  const lastLoadedKeyRef = useRef<string | null>(null);
  const wakeInFlightRef = useRef(false);
  const wakeAgainRef = useRef(false);
  const offlineProbeFailuresRef = useRef(0);

  // ── Stable refs so any closure (including stale ones in AppState) can always
  // access the CURRENT queue and the CURRENT processSyncQueue implementation.
  // This is the fix for the "stale closure" bug where AppState and ping
  // handlers captured the initial empty queue and never saw later updates.
  const queueRef = useRef<QueuedOperation[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  const queueLoadedRef = useRef(false);
  useEffect(() => { queueLoadedRef.current = queueLoaded; }, [queueLoaded]);

  const isOnlineRef = useRef(true);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  const applyOnlineReading = useCallback((online: boolean) => {
    if (online) {
      offlineProbeFailuresRef.current = 0;
      isOnlineRef.current = true;
      setIsOnline(true);
      return true;
    }

    offlineProbeFailuresRef.current += 1;
    if (offlineProbeFailuresRef.current >= OFFLINE_CONFIRMATION_FAILURES) {
      isOnlineRef.current = false;
      setIsOnline(false);
      return false;
    }

    return isOnlineRef.current;
  }, []);

  // processSyncQueueRef is always updated to point to the latest version of
  // processSyncQueue on every render, so stale closures can safely call
  // processSyncQueueRef.current() and get the correct behaviour.
  const processSyncQueueRef = useRef<() => Promise<void>>(async () => {});
  const syncKickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const queueHydrationGenerationRef = useRef(0);

  // Throttle: track when the last sync attempt started so ping-driven retries
  // don't hammer the server (max one attempt per 20 seconds).
  const lastSyncAttemptRef = useRef<number>(0);
  const syncBackoffUntilRef = useRef<number>(0);
  const syncInfrastructureFailureCountRef = useRef<number>(0);

  const scheduleSync = useCallback((delayMs = SYNC_KICK_DELAY_MS) => {
    if (!isSupabaseConfigured) return;
    if (syncKickTimerRef.current) clearTimeout(syncKickTimerRef.current);
    syncKickTimerRef.current = setTimeout(() => {
      syncKickTimerRef.current = null;
      if (
        queueLoadedRef.current &&
        isOnlineRef.current &&
        hasReplayableQueuedOperations(queueRef.current)
      ) {
        void processSyncQueueRef.current();
      }
    }, delayMs);
  }, []);

  useEffect(() => () => {
    if (syncKickTimerRef.current) clearTimeout(syncKickTimerRef.current);
  }, []);

  // ── Queue persistence ──────────────────────────────────────────────────────

  const backupQueue = useCallback(async (q: QueuedOperation[], reason: string) => {
    if (q.length === 0) return;
    try {
      await AsyncStorage.setItem(
        offlineQueueBackupKey,
        JSON.stringify({ backedUpAt: new Date().toISOString(), reason, queue: q }),
      );
    } catch (err) {
      console.warn('[queue] failed to write recovery backup:', (err as any)?.message ?? err);
    }
  }, [offlineQueueBackupKey]);

  const saveQueue = useCallback((q: QueuedOperation[]) => {
    const key = offlineQueueKey;
    const serialized = JSON.stringify(q);
    // Serialiser les écritures : deux enqueue rapprochés ne doivent jamais
    // permettre à une ancienne version de la file de finir après la plus récente.
    queueWriteChainRef.current = queueWriteChainRef.current
      .catch(() => {})
      .then(() => AsyncStorage.setItem(key, serialized))
      .catch((err) => {
        console.warn('[queue] failed to persist offline queue:', (err as any)?.message ?? err);
      });
    return queueWriteChainRef.current;
  }, [offlineQueueKey]);

  // Load the queue for the *current* user. We defer hydration until we know
  // user.id to avoid the catastrophic race where the queue is initially loaded
  // under the `..._anon` key (empty) and then never re-merged once user.id
  // arrives — losing every offline mutation made before login finished
  // restoring. We also migrate any orphan `..._anon` queue (mutations enqueued
  // before authentication completed) into the per-user key so they can sync.
  const loadQueue = useCallback(async () => {
    const myHydrationGeneration = ++queueHydrationGenerationRef.current;
    setQueueLoaded(false);
    queueLoadedRef.current = false;
    const userKey = userId ? OFFLINE_QUEUE_PREFIX + userId : null;
    const anonKey = OFFLINE_QUEUE_PREFIX + 'anon';
    try {
      let merged: QueuedOperation[] = [];
      const seen = new Set<string>();

      // Read user-scoped queue if available
      if (userKey) {
        try {
          const rawUser = await AsyncStorage.getItem(userKey);
          if (rawUser) {
            const parsed = JSON.parse(rawUser);
            if (Array.isArray(parsed)) {
              for (const op of parsed) {
                if (op?.id && !seen.has(op.id)) { seen.add(op.id); merged.push(op); }
              }
            }
          }
        } catch {}

        // Migrate any orphan anonymous queue (mutations made before login finished)
        try {
          const rawAnon = await AsyncStorage.getItem(anonKey);
          if (rawAnon) {
            const parsedAnon = JSON.parse(rawAnon);
            if (Array.isArray(parsedAnon) && parsedAnon.length > 0) {
              for (const op of parsedAnon) {
                if (op?.id && !seen.has(op.id)) { seen.add(op.id); merged.push(op); }
              }
              await AsyncStorage.setItem(userKey, JSON.stringify(merged));
              await AsyncStorage.removeItem(anonKey);
              console.warn(`[NetworkContext] migrated ${parsedAnon.length} anon queue items to ${userKey}`);
            }
          }
        } catch {}
      } else {
        // No user yet — read anon-only queue (rare; usually we just wait for user.id)
        try {
          const rawAnon = await AsyncStorage.getItem(anonKey);
          if (rawAnon) {
            const parsed = JSON.parse(rawAnon);
            if (Array.isArray(parsed)) merged = parsed;
          }
        } catch {}
      }

      if (queueHydrationGenerationRef.current !== myHydrationGeneration) return;
      // Des opérations peuvent être créées pendant la lecture AsyncStorage.
      // Les fusionner avec l'instantané chargé évite qu'une hydratation lente ne
      // remplace puis perde une saisie terrain toute fraîche.
      const combined = [...merged];
      for (const op of queueRef.current) {
        if (op?.id && !seen.has(op.id)) {
          seen.add(op.id);
          combined.push(op);
        }
      }
      const coalesced = migrateAndCoalesceSitePlanSnapshots(combined, userId);
      queueRef.current = coalesced;
      setQueue(coalesced);
      await saveQueue(coalesced);
      lastLoadedKeyRef.current = userKey ?? anonKey;
    } catch {
      // Conserver les opérations éventuellement créées pendant l'hydratation.
      if (queueHydrationGenerationRef.current === myHydrationGeneration) {
        setQueue([...queueRef.current]);
      }
    } finally {
      if (queueHydrationGenerationRef.current === myHydrationGeneration) {
        queueLoadedRef.current = true;
        setQueueLoaded(true);
        if (hasReplayableQueuedOperations(queueRef.current)) scheduleSync();
      }
    }
  }, [userId, saveQueue, scheduleSync]);

  // ── Hydrate queue when user.id changes (cold start, login, switch) ─────────
  useEffect(() => {
    const targetKey = userId ? OFFLINE_QUEUE_PREFIX + userId : OFFLINE_QUEUE_PREFIX + 'anon';
    if (lastLoadedKeyRef.current === targetKey) return;
    // Une passe lancée pour le compte précédent ne doit jamais repeupler l'état
    // React du compte suivant lorsqu'un upload réseau se termine en retard.
    syncGenerationRef.current += 1;
    syncingRef.current = false;
    queueHydrationGenerationRef.current += 1;
    queueLoadedRef.current = false;
    setQueueLoaded(false);
    queueRef.current = [];
    setQueue([]);
    void loadQueue();
  }, [userId, loadQueue]);

  // Changement d'utilisateur (déconnexion / re-connexion) : repartir d'un état
  // « non bloqué ». Sans cela le drapeau ne serait réinitialisé que par une
  // passe de sync réussie — inaccessible quand la file est vide — et la
  // bannière « se reconnecter » resterait affichée après le re-login.
  useEffect(() => {
    setSyncAuthBlocked(false);
    syncBackoffUntilRef.current = 0;
    syncInfrastructureFailureCountRef.current = 0;
    if (syncKickTimerRef.current) {
      clearTimeout(syncKickTimerRef.current);
      syncKickTimerRef.current = null;
    }
  }, [userId]);

  // Once the queue finishes loading, force every gated query to re-evaluate
  // its queryFn so they can finally fetch from the server safely.
  useEffect(() => {
    if (queueLoaded) {
      void refetchActiveQueries('queue-loaded');
    }
  }, [queueLoaded]);

  // ── Network detection ──────────────────────────────────────────────────────
  //
  // Native: active pinging every 10 s. After each ping we also check whether
  // there are pending ops that need syncing — this handles the case where
  // isOnline was ALREADY true when the app woke up (no state change → the
  // isOnline-change effect below wouldn't fire).

  useEffect(() => {
    if (Platform.OS === 'web') {
      const refresh = async () => {
        const current = typeof navigator !== 'undefined' ? navigator.onLine : true;
        setIsOnline(await checkAppOnline(current));
      };
      const up = () => { refresh(); };
      const dn = () => setIsOnline(false);
      refresh();
      window.addEventListener('online', up);
      window.addEventListener('offline', dn);
      const interval = setInterval(refresh, 10_000);
      return () => {
        window.removeEventListener('online', up);
        window.removeEventListener('offline', dn);
        clearInterval(interval);
      };
    }

    const check = async () => {
      const online = applyOnlineReading(await checkAppOnline());

      // Safety-net: if we are online with pending ops, trigger a sync attempt —
      // but no more than once every 20 seconds. This covers the case where the
      // app woke up with isOnline already true (no state transition) so the
      // isOnline-change effect below never fired.
      //
      // On ne conditionne PLUS à `!syncingRef.current` : processSyncQueue se
      // protège lui-même (early-return si une passe progresse, préemption si
      // elle est gelée). L'ancienne condition empêchait toute relance dès qu'une
      // passe restait coincée avec `syncingRef = true` → file bloquée à vie.
      if (
        online &&
        isSupabaseConfigured &&
        hasReplayableQueuedOperations(queueRef.current) &&
        Date.now() - lastSyncAttemptRef.current > 20_000
      ) {
        processSyncQueueRef.current();
      }
    };

    check();
    const interval = setInterval(check, 10_000);
    return () => clearInterval(interval);
  }, [applyOnlineReading]);

  // ── Trigger sync + refetch when coming back online ─────────────────────────

  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      if (isSupabaseConfigured) {
        if (hasReplayableQueuedOperations(queueRef.current)) processSyncQueueRef.current();
        void refetchActiveQueries('online-transition');
      }
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  // ── Cold-start sync trigger ────────────────────────────────────────────────
  //
  // Once the offline queue has been hydrated AND we are online AND the user
  // is authenticated, immediately attempt to flush any pending mutations.

  useEffect(() => {
    if (!queueLoaded) return;
    if (!isOnline) return;
    if (!isSupabaseConfigured) return;
    if (!userId) return;
    if (!hasReplayableQueuedOperations(queue)) return;
    // Pas de court-circuit sur `syncingRef` : processSyncQueue gère lui-même le
    // verrou (et la préemption d'une passe gelée).
    const t = setTimeout(() => {
      processSyncQueueRef.current();
    }, 800);
    return () => clearTimeout(t);
  }, [queueLoaded, isOnline, userId, queue.length]);

  // ── Foreground wake-up: session heal + sync (native only) ──────────────────
  //
  // This is the fix for the long-standing "sync doesn't happen after a long
  // background sleep" bug. Root causes addressed here:
  //
  //   1. Stale closure: AppState listener was created once at mount, capturing
  //      processSyncQueue with queue=[] (initial state). Now we call via ref.
  //
  //   2. Frozen Supabase client: after a long sleep the auth lock can be stuck
  //      (a refresh was in-flight when JS was frozen). We use refreshSession()
  //      with a strict timeout to break the lock and get a fresh token.
  //
  //   3. isOnline already true: if the device had connectivity before and after
  //      the sleep, isOnline never changes state, so the isOnline effect above
  //      never fires. We explicitly re-ping here and trigger sync if online.
  //
  //   4. Realtime WebSocket zombie: the WS connection can become a ghost after
  //      a long sleep. We force-reconnect here.

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!isSupabaseConfigured) return;

    // Track when the app last went to background so we know if a long sleep occurred.
    let backgroundAt = 0;

    const runWakeUpPass = async () => {
      const sleptMs = backgroundAt > 0 ? Date.now() - backgroundAt : 0;
      backgroundAt = 0;
      if (sleptMs <= 0) return;
      const longSleep = sleptMs > 30_000; // more than 30 s in background

      // ── 1. Heal the Supabase auth client ──────────────────────────────────
      // After a long sleep the access token is likely expired and/or the
      // internal auth lock is frozen. Calling refreshSession() with a short
      // timeout forces a new token AND breaks any stuck lock (our safeLock
      // implementation in lib/supabase.ts will time out and release the lock).
      // We heal even after a short return because Android can freeze JS while
      // Supabase is mid-refresh. The helper uses short timeouts plus an
      // AsyncStorage/raw-refresh fallback, so this never blocks forever.
      await healSupabaseSessionAfterWake(longSleep);

      // ── 2. Reconnect the Realtime WebSocket ───────────────────────────────
      try { (supabase as any).realtime?.disconnect?.(); } catch {}
      try { (supabase as any).realtime?.connect?.(); } catch {}

      // ── 3. Re-ping to get a fresh connectivity reading ───────────────────
      // We can't rely on the stale isOnline state: if the network was already
      // active before sleep, isOnline is still true and the change-based effect
      // won't fire. We ping explicitly and act on the result.
      const online = applyOnlineReading(await checkAppOnline());

      // ── 4. Refresh active screens immediately ────────────────────────────
      // invalidateQueries alone can be lazy. Refetch active queries now so
      // another user's changes appear without needing a full app restart.
      await refetchActiveQueries('foreground');
      try { reloadHandlerRef.current?.(); } catch {}

      // ── 5. Trigger sync if we have pending operations ─────────────────────
      // Pas de garde `!syncingRef.current` : processSyncQueue early-return si
      // une passe progresse, ou préempte une passe gelée.
      if (online && hasReplayableQueuedOperations(queueRef.current)) {
        await processSyncQueueRef.current();
        await refetchActiveQueries('foreground-after-queue-sync');
        try { reloadHandlerRef.current?.(); } catch {}
      }

      // Some devices report `active` before the network stack has fully
      // resumed. A short follow-up fetch catches the second-wave readiness
      // without requiring the user to kill and relaunch the app.
      setTimeout(() => {
        if (isOnlineRef.current) {
          void refetchActiveQueries('foreground-follow-up');
          try { reloadHandlerRef.current?.(); } catch {}
        }
      }, 2500);
    };

    const wakeUp = async () => {
      if (wakeInFlightRef.current) {
        wakeAgainRef.current = true;
        return;
      }
      wakeInFlightRef.current = true;
      try {
        do {
          wakeAgainRef.current = false;
          await runWakeUpPass();
        } while (wakeAgainRef.current);
      } finally {
        wakeInFlightRef.current = false;
      }
    };

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        if (backgroundAt <= 0) return;
        wakeUp();
      } else if (next === 'background' || next === 'inactive') {
        backgroundAt = Date.now();
      }
    });

    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync logic ─────────────────────────────────────────────────────────────

  async function processSyncQueue() {
    // IMPORTANT: use queueRef.current (not queue from closure) so this function
    // works correctly even when called from a stale closure (AppState listener,
    // ping interval, etc.).
    if (!hasReplayableQueuedOperations(queueRef.current) || !isSupabaseConfigured) return;

    const backoffRemainingMs = syncBackoffUntilRef.current - Date.now();
    if (backoffRemainingMs > 0) {
      scheduleSync(Math.max(backoffRemainingMs, SYNC_KICK_DELAY_MS));
      return;
    }
    if (isSessionExpired()) {
      // A rejected refresh token requires an explicit login. Keep the queue
      // untouched and do not probe one 401 every few seconds indefinitely.
      setSyncAuthBlocked(true);
      setSyncStatus('idle');
      return;
    }

    // ── Garde-fou anti-blocage définitif ──────────────────────────────────────
    // On ne lance pas de passe concurrente TANT QUE la passe en cours progresse.
    // Mais si elle n'a fait aucun progrès depuis trop longtemps, c'est qu'un
    // await réseau/fichier est resté bloqué (malgré toutes les bornes) : on la
    // considère gelée et on la préempte, sinon la file reste verrouillée pour
    // toujours (`syncingRef` jamais relâché → toutes les relances ignorées,
    // bouton « Réessayer » désactivé). C'est exactement le symptôme observé :
    // « Sync 0/1 » figé et opérations en attente bloquées pendant des jours.
    if (syncingRef.current) {
      const sinceProgress = Date.now() - syncProgressAtRef.current;
      if (sinceProgress < SYNC_STUCK_RECOVERY_MS) return;
      console.warn(`[queue] passe de sync gelée depuis ${Math.round(sinceProgress / 1000)}s — préemption forcée`);
    }

    const myGeneration = ++syncGenerationRef.current;
    const isCurrentGeneration = () => syncGenerationRef.current === myGeneration;
    syncingRef.current = true;
    syncProgressAtRef.current = Date.now();
    lastSyncAttemptRef.current = Date.now();
    setSyncStatus('syncing');

    // Tout le corps est encapsulé dans un try/finally : le verrou (`syncingRef`)
    // et l'indicateur de progression sont TOUJOURS relâchés en fin de passe,
    // même en cas d'exception inattendue, pour ne jamais laisser la file gelée.
    try {
    // ── Ensure the Supabase session is fresh before any upload ────────────────
    // A stale/expired JWT causes Storage uploads to fail with HTTP 401 under
    // RLS, resulting in the endless "32 échecs" cycle the user sees.
    // We always refresh here (cheap no-op if the token is still valid). Borné
    // pour qu'un rafraîchissement bloqué ne gèle pas la passe avant la boucle.
    let accessToken: string | null = null;
    try { accessToken = await withTimeoutMs(getSupabaseRestAccessToken(), TOKEN_REFRESH_TIMEOUT_MS); } catch {}

    // Le diagnostic peut encore voir une session persistée valide alors que le
    // client auth en mémoire est resté gelé après une veille Android. Dans ce
    // cas, ne pas simplement reporter la file indéfiniment : réparer la session
    // puis relire immédiatement le jeton stocké avant d'abandonner cette passe.
    if (!accessToken || accessToken === SUPABASE_KEY) {
      try {
        const healed = await withTimeoutMs(
          healSupabaseSessionAfterWake(true),
          TOKEN_REFRESH_TIMEOUT_MS,
        );
        if (healed) {
          accessToken = await withTimeoutMs(
            getSupabaseRestAccessToken(),
            TOKEN_REFRESH_TIMEOUT_MS,
          );
        }
      } catch {}
    }

    // ── Session-validity gate ──────────────────────────────────────────────────
    // getSupabaseRestAccessToken degrades to the ANON key when no user session
    // can be obtained (expired/revoked refresh token, dead cached session after
    // an app restart…). Replaying the queue in that state is worse than useless:
    // every write goes out as role `anon`, RLS/grants reject it with
    // `42501 permission denied` (e.g. create_reserve_with_photos), photo uploads
    // may still land in storage while their reserve row never materialises, and
    // each op accumulates scary failures the user is then tempted to « Vider ».
    // Hold the queue intact instead — the pass is retried by the ping/foreground
    // triggers, and the cold-start effect replays automatically after re-login.
    // Un jeton utilisateur VALIDE passe outre un éventuel verrou d'expiration
    // périmé (latch posé puis session rétablie sans notifySessionRecovered).
    if (!accessToken || accessToken === SUPABASE_KEY) {
      const terminal = isSessionExpired();
      console.warn(`[queue] jeton utilisateur indisponible (${terminal ? 'session expirée' : 'échec transitoire'}) — passe de sync reportée`);
      // Bannière « se reconnecter » uniquement sur expiration terminale avérée :
      // un raté transitoire (timeout, 5xx, cooldown de refresh) ne doit pas
      // pousser l'utilisateur vers une déconnexion inutile.
      setSyncAuthBlocked(terminal);
      setSyncStatus('idle');
      if (!terminal) scheduleSync(SYNC_AUTH_RETRY_DELAY_MS);
      return;
    }
    setSyncAuthBlocked(false);

    const pendingConflicts: StatusConflict[] = [];
    const failedOps: QueuedOperation[] = [];
    let circuitOpened = false;
    let circuitDelayMs = 0;
    // Snapshot the queue from the ref (always current, not a stale closure)
    const currentQueue = queueRef.current.filter(isReplayableQueuedOperation).sort((a, b) => {
      const priorityDiff = queueReplayPriority(a) - queueReplayPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.queuedAt ?? '').localeCompare(b.queuedAt ?? '');
    });
    setSyncProgress({ done: 0, total: currentQueue.length });

    // Helper: re-queue an op while attaching the latest error message and
    // bumping its attempt counter so the user can see in the UI why it stays
    // stuck after each retry.
    const fail = (
      op: QueuedOperation,
      err: any,
      options?: { terminalStatus?: string; terminalOutcome?: SyncQueueTerminalOutcome },
    ) => {
      let msg: string;
      if (!err) msg = i18n.t('networkQueue.unknownError');
      else if (typeof err === 'string') msg = err;
      else if (err.message) {
        msg = err.message;
        if (err.code) msg = `[${err.code}] ${msg}`;
        if (err.details) msg += ` — ${err.details}`;
        if (err.hint) msg += ` (${err.hint})`;
      } else {
        try { msg = JSON.stringify(err); } catch { msg = String(err); }
      }
      console.warn(`[queue] ${op.op} ${op.table} failed:`, msg);
      failedOps.push({
        ...op,
        lastError: msg,
        attemptCount: (op.attemptCount ?? 0) + 1,
        terminal: Boolean(options?.terminalStatus || options?.terminalOutcome) || op.terminal,
        terminalStatus: options?.terminalOutcome?.status ?? options?.terminalStatus ?? op.terminalStatus,
        terminalOutcome: options?.terminalOutcome ?? op.terminalOutcome,
      });

      if (!circuitOpened && isAuthenticationSyncFailure(err)) {
        // Stop after the first rejected authenticated request. Replaying every
        // queued operation with the same unusable JWT only burns retries and
        // can trigger one refresh attempt per row.
        circuitOpened = true;
        circuitDelayMs = SYNC_AUTH_RETRY_DELAY_MS;
        syncBackoffUntilRef.current = Date.now() + circuitDelayMs;
        setSyncAuthBlocked(isSessionExpired());
      } else if (!circuitOpened && isInfrastructureSyncFailure(err)) {
        circuitOpened = true;
        const failures = syncInfrastructureFailureCountRef.current + 1;
        syncInfrastructureFailureCountRef.current = failures;
        const exponential = Math.min(
          SYNC_INFRA_BACKOFF_MAX_MS,
          SYNC_INFRA_BACKOFF_BASE_MS * (2 ** Math.min(failures - 1, 4)),
        );
        circuitDelayMs = Math.round(exponential * (0.8 + Math.random() * 0.4));
        syncBackoffUntilRef.current = Date.now() + circuitDelayMs;
      }
    };

    let processed = 0;
    for (const op of currentQueue) {
      // A project-wide timeout means all remaining operations would fail for
      // the same reason. Leave them untouched for the delayed retry.
      if (circuitOpened) break;
      // Si une passe plus récente nous a préemptés (nous étions gelés puis
      // réveillés), on cesse immédiatement tout travail : la passe courante
      // possède la file et a déjà rejoué (ou est en train de rejouer) ces ops.
      if (!isCurrentGeneration()) break;
      let retryOpForCatch: QueuedOperation = op;
      try {
        // ── Status-change conflict detection ───────────────────────────────
        if (op.op === 'rpc') {
          if (!op.rpc?.fn) {
            fail(op, i18n.t('networkQueue.missingRpc'));
            continue;
          }
          let args = { ...(op.rpc.args ?? {}) };
          let retryRpcOp = op;

          if (op.rpc.fn === 'create_reserve_with_photos') {
            const rawReserve = hydrateQueuedOrganizationId(
              'reserves',
              (args.p_reserve ?? op.data) as Record<string, any> | undefined,
              user?.organizationId ?? null,
              user?.role ?? null,
            );
            if (!rawReserve?.id) {
              fail(op, i18n.t('networkQueue.createReserveMissingPayload'));
              continue;
            }
            if (rawReserve.deadline === 'â€”' || rawReserve.deadline === '') {
              rawReserve.deadline = null;
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('reserves', rawReserve, {
                onProgress: async (partialReserve) => {
                  if (!isCurrentGeneration()) return;
                  const progressOp: QueuedOperation = {
                    ...op,
                    data: partialReserve,
                    rpc: {
                      ...op.rpc,
                      fn: op.rpc!.fn,
                      args: { ...args, p_reserve: partialReserve },
                    },
                  };
                  retryRpcOp = progressOp;
                  retryOpForCatch = progressOp;
                  const index = queueRef.current.findIndex(item => item.id === op.id);
                  if (index < 0) return;
                  const next = [...queueRef.current];
                  next[index] = progressOp;
                  queueRef.current = next;
                  setQueue(next);
                  await saveQueue(next);
                  // Une photo terminée est un vrai progrès : le watchdog ne doit
                  // pas préempter une opération multi-photo qui converge.
                  syncProgressAtRef.current = Date.now();
                },
              }),
              uploadStepTimeoutMs(rawReserve),
            );
            if (!prep.allOk) {
              // Conserver le progrès partiel : les photos déjà uploadées gardent
              // leur URL distante dans l'op ré-enfilée ET dans le cache. Sans
              // cela, chaque passe ré-uploade TOUTES les photos depuis zéro —
              // sur une connexion de chantier lente la file ne converge jamais
              // (« Délai dépassé (upload photo native > 30s) » en boucle).
              const partialReserve = prep.data ?? rawReserve;
              let partialRetryOp = op;
              if (partialReserve?.id) {
                partialRetryOp = {
                  ...op,
                  data: partialReserve,
                  rpc: { ...op.rpc, args: { ...args, p_reserve: partialReserve } },
                };
                if (prep.hadLocal) {
                  await applySyncedReservePhotoPayloadToCache(
                    userId,
                    String(partialReserve.id),
                    partialReserve,
                  );
                }
              }
              fail(partialRetryOp, prep.uploadErrors?.join(' | ') || i18n.t('networkQueue.uploadReservePhotosFailed'));
              continue;
            }
            const preparedReserve = prep.data ?? rawReserve;
            args = {
              ...args,
              p_reserve: preparedReserve,
              p_photo_rows: reservePhotoRowsForRpcPayload(
                preparedReserve,
                user?.name ?? user?.email ?? null,
              ),
            };
            retryRpcOp = { ...op, data: preparedReserve, rpc: { ...op.rpc, args } };
            // Bascule le cache sur les URLs distantes DÈS que l'upload a réussi,
            // sans attendre le succès du RPC. Si le RPC échoue ensuite (session
            // expirée, RLS…), l'UI continuerait sinon d'afficher des URIs
            // locales potentiellement mortes → photos blanches / « disparues ».
            if (prep.hadLocal && preparedReserve?.id) {
              await applySyncedReservePhotoPayloadToCache(
                userId,
                String(preparedReserve.id),
                preparedReserve,
              );
            }
          } else if (op.rpc.fn === 'record_inventory_movement') {
            const rawProduct = (args.p_product ?? op.data) as Record<string, any> | undefined;
            if (!args.p_operation_id || !args.p_movement || !rawProduct?.id) {
              const terminalOutcome = normalizeInventoryMovementOutcome(
                { status: 'invalid_payload', message: 'Mouvement de stock invalide : opération, mouvement ou produit manquant.' },
                inventoryOutcomeContextFromQueuedOperation(op),
              );
              await reconcileTerminalInventoryOperationCache(op, terminalOutcome, userId).catch(error => {
                console.warn('[inventory] terminal cache reconciliation failed:', (error as any)?.message ?? error);
              });
              fail(op, terminalOutcome.message, { terminalOutcome });
              continue;
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('inventory_products', rawProduct),
              uploadStepTimeoutMs(rawProduct),
            );
            if (!prep.allOk) {
              fail(op, prep.uploadErrors?.join(' | ') || 'Échec upload de la photo produit.');
              continue;
            }
            const preparedProduct = prep.data ?? rawProduct;
            args = { ...args, p_product: preparedProduct };
            retryRpcOp = { ...op, data: preparedProduct, rpc: { ...op.rpc, args } };
            retryOpForCatch = retryRpcOp;
          } else if (op.rpc.fn === 'update_inventory_product') {
            const rawPatch = (args.p_patch ?? op.data) as Record<string, any> | undefined;
            if (!args.p_product_id || !rawPatch) {
              const terminalOutcome = normalizeInventoryMovementOutcome(
                { status: 'invalid_payload', message: 'Modification produit invalide : produit ou données manquantes.' },
                inventoryOutcomeContextFromQueuedOperation(op),
              );
              fail(op, terminalOutcome.message, { terminalOutcome });
              continue;
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('inventory_products', rawPatch),
              uploadStepTimeoutMs(rawPatch),
            );
            if (!prep.allOk) {
              fail(op, prep.uploadErrors?.join(' | ') || 'Échec upload de la photo produit.');
              continue;
            }
            const preparedPatch = prep.data ?? rawPatch;
            args = { ...args, p_patch: preparedPatch };
            retryRpcOp = { ...op, data: preparedPatch, rpc: { ...op.rpc, args } };
            retryOpForCatch = retryRpcOp;
          } else if (op.rpc.fn === 'create_site_plan_revision_with_reserve_migration') {
            const rawPlan = hydrateQueuedOrganizationId(
              'site_plans',
              (args.p_new_plan ?? op.data) as Record<string, any> | undefined,
              user?.organizationId ?? null,
              user?.role ?? null,
            );
            if (!args.p_parent_plan_id || !rawPlan?.id) {
              fail(op, 'RPC create_site_plan_revision_with_reserve_migration refusee: plan parent ou nouvelle revision manquant.');
              continue;
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('site_plans', rawPlan),
              UPLOAD_STEP_TIMEOUT_MS,
            );
            if (!prep.allOk) {
              fail(op, prep.uploadErrors?.join(' | ') || 'Echec upload fichier plan avant creation revision controlee.');
              continue;
            }
            const preparedPlan = prep.data ?? rawPlan;
            args = { ...args, p_new_plan: preparedPlan };
            retryRpcOp = { ...op, data: preparedPlan, rpc: { ...op.rpc, args } };
          } else if (op.rpc.fn === 'replace_site_plan_file_safely') {
            const rawPatch = (args.p_patch ?? op.data) as Record<string, any> | undefined;
            if (!args.p_plan_id || !rawPatch) {
              fail(op, i18n.t('networkQueue.replacePlanMissingPatch'));
              continue;
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('site_plans', rawPatch),
              UPLOAD_STEP_TIMEOUT_MS,
            );
            if (!prep.allOk) {
              fail(op, prep.uploadErrors?.join(' | ') || i18n.t('networkQueue.uploadPlanFileFailed'));
              continue;
            }
            const preparedPatch = { ...(prep.data ?? rawPatch) };
            delete preparedPatch.__replace_file_safely;
            args = { ...args, p_patch: preparedPatch };
            retryRpcOp = { ...op, data: preparedPatch, rpc: { ...op.rpc, args } };
          } else if (op.rpc.fn === 'append_reserve_status_event') {
            const event = args.p_event ?? op.data;
            if (!event?.reserve_id || !event?.to_status) {
              fail(op, i18n.t('networkQueue.reserveStatusEventMissing'));
              continue;
            }
            args = {
              ...args,
              p_operation_id: args.p_operation_id ?? op.id,
              p_request_hash: args.p_request_hash ?? await buildRequestHash({
                fn: 'append_reserve_status_event',
                event,
              }),
              p_event: event,
            };
            retryRpcOp = { ...op, rpc: { ...op.rpc, args } };
          }

          const { data: rpcData, error } = await supabaseRestRpc(op.rpc.fn, args);
          if (!error && op.rpc.fn === 'replace_site_plan_file_safely') {
            // The RPC protects the binary transition but deliberately touches
            // only file columns. Persist the latest coalesced full snapshot
            // afterwards so annotations and plan metadata cannot be dropped.
            const snapshotPatch = (args.p_patch ?? retryRpcOp.data) as Record<string, any> | undefined;
            const planId = args.p_plan_id;
            if (!snapshotPatch || !planId) {
              fail(retryRpcOp, i18n.t('networkQueue.replacePlanMissingPatch'));
              continue;
            }
            const { error: metadataError } = await supabaseRestMutation(
              'site_plans',
              'update',
              snapshotPatch,
              { column: 'id', value: String(planId) },
            );
            if (metadataError) {
              fail(retryRpcOp, metadataError);
              continue;
            }
          }
          if (error && op.rpc.fn === 'append_reserve_status_event' && isReserveMutationRpcUnavailable(error)) {
            if (op.filter?.column === 'id' && op.data) {
              const { error: fallbackErr } = await supabaseRestMutation(
                'reserves',
                'update',
                op.data,
                op.filter,
              );
              if (fallbackErr) fail({ ...retryRpcOp, data: op.data }, fallbackErr);
            } else {
              fail(retryRpcOp, error);
            }
          } else if (error) fail(retryRpcOp, error);
          else if (op.rpc.fn === 'append_reserve_status_event') {
            const outcome = firstReserveMutationResult(rpcData);
            if (outcome && outcome.status !== 'ok') {
              const terminal = ['deleted', 'forbidden', 'not_found', 'duplicate_operation_mismatch', 'invalid_payload'].includes(outcome.status);
              fail(retryRpcOp, outcome.message ?? outcome.status, terminal ? { terminalStatus: outcome.status } : undefined);
            }
          }
          else if (op.rpc.fn === 'create_reserve_with_photos' && args.p_reserve?.id) {
            const reserveId = String(args.p_reserve.id);
            await applySyncedReservePhotoPayloadToCache(userId, reserveId, retryRpcOp.data ?? args.p_reserve);
            await queryClient.invalidateQueries({ queryKey: queryKeys.photos(), refetchType: 'active' });
            triggerReserveCreatedPush(reserveId);
          }
          else if (op.rpc.fn === 'record_inventory_movement' || op.rpc.fn === 'update_inventory_product') {
            const terminalOutcome = normalizeInventoryMovementOutcome(
              rpcData,
              inventoryOutcomeContextFromQueuedOperation(retryRpcOp),
            );
            if (isTerminalInventoryMovementOutcome(terminalOutcome)) {
              const fallbackMessage = terminalOutcome.message ?? terminalOutcome.status ?? 'Opération de stock refusée.';
              const translationKey = inventoryOutcomeTranslationKey({
                ...retryRpcOp,
                terminal: true,
                terminalStatus: terminalOutcome.status,
                terminalOutcome,
              });
              await reconcileTerminalInventoryOperationCache(retryRpcOp, terminalOutcome, userId).catch(error => {
                console.warn('[inventory] terminal cache reconciliation failed:', (error as any)?.message ?? error);
              });
              fail(
                retryRpcOp,
                translationKey
                  ? i18n.t(translationKey as any, { defaultValue: fallbackMessage })
                  : fallbackMessage,
                { terminalOutcome },
              );
            } else {
              const chantierId = args.p_movement?.chantier_id;
              if (op.rpc.fn === 'record_inventory_movement') {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: queryKeys.inventoryProducts(chantierId), refetchType: 'active' }),
                  queryClient.invalidateQueries({ queryKey: queryKeys.inventoryMovements(chantierId), refetchType: 'active' }),
                ]);
              } else {
                await queryClient.invalidateQueries({ queryKey: ['inventory', 'products'], refetchType: 'active' });
              }
            }
          }
          continue;
        }

        if (op.conflictCheck) {
          const { entityId, previousStatus, newStatus, author, history, closedAt, closedBy } = op.conflictCheck;

          const { data: serverRows, error: fetchErr } = await supabaseRestSelect<any>(
            'reserves',
            'status,title',
            { column: 'id', value: entityId },
          );
          const serverData = serverRows?.[0] ?? null;

          if (fetchErr) { fail(op, fetchErr); continue; }
          if (!serverData) continue;

          if (serverData && serverData.status !== previousStatus && serverData.status !== newStatus) {
            pendingConflicts.push({
              id: op.id,
              reserveId: entityId,
              reserveTitle: serverData.title ?? entityId,
              serverStatus: serverData.status,
              localStatus: newStatus,
              author,
              history,
              closedAt,
              closedBy,
            });
            continue;
          }

          const { error: applyErr } = await supabaseRestMutation('reserves', 'update', {
            status: newStatus,
            history,
            closed_at: closedAt ?? null,
            closed_by: closedBy ?? null,
          }, { column: 'id', value: entityId });

          if (applyErr) fail(op, applyErr);
          continue;
        }

        // ── Comment patch (CRDT-lite merge by comment ID) ─────────────────
        // Replaces the old "store full comments array" approach.  Each comment
        // op carries only the delta (add/edit/delete a single comment). The
        // engine fetches the live server array and merges by ID so concurrent
        // writes from other devices are never silently overwritten.
        if (op.commentPatch && (op.table === 'tasks' || op.table === 'reserves') && op.filter?.column === 'id') {
          const rowId = op.filter.value;
          const patch  = op.commentPatch;

          const { data: taskRows, error: fetchErr } = await supabaseRestSelect<any>(
            op.table,
            'comments',
            { column: 'id', value: rowId },
          );
          const serverTask = taskRows?.[0] ?? null;

          if (fetchErr) { fail(op, fetchErr); continue; }

          // Row is gone — treat as success (nothing to patch)
          if (!serverTask) continue;

          const serverComments: Comment[] = Array.isArray(serverTask.comments)
            ? serverTask.comments
            : [];

          let merged: Comment[];
          if (patch.action === 'add' && patch.comment) {
            // Idempotent: skip if the comment ID is already present
            merged = serverComments.some(c => c.id === patch.comment!.id)
              ? serverComments
              : [...serverComments, patch.comment];
          } else if (patch.action === 'edit' && patch.commentId) {
            merged = serverComments.map(c =>
              c.id === patch.commentId
                ? { ...c, content: patch.newContent ?? c.content, editedAt: patch.editedAt }
                : c
            );
          } else if (patch.action === 'delete' && patch.commentId) {
            merged = serverComments.filter(c => c.id !== patch.commentId);
          } else {
            // Malformed patch — drop silently
            console.warn('[queue] commentPatch malformed, dropping:', JSON.stringify(patch));
            continue;
          }

          const { error: writeErr } = await supabaseRestMutation(
            op.table,
            'update',
            { comments: merged },
            { column: 'id', value: rowId },
          );

          if (writeErr) fail(op, writeErr);
          continue;
        }

        // ── Upload local photos / files before replaying insert/update ───────
        let data = op.data ? { ...op.data } : op.data;
        data = hydrateQueuedOrganizationId(op.table, data, user?.organizationId ?? null, user?.role ?? null);
        let retryData = data;
        let deferredPhotoPatch: QueuedOperation | null = null;
        if (data) {
          if (op.table === 'visites') {
            data = normalizeVisitePayloadForSupabase(data);
            retryData = data;
          }
          if (op.table === 'reserves') {
            if (data.deadline === '—' || data.deadline === '') {
              data.deadline = null;
            }
          }
          // ── Logs détaillés pour site_plans ──────────────────────────────
          if (op.table === 'site_plans') {
            const hasLocalUri = typeof data.uri === 'string' && data.uri.startsWith('file://');
            console.log(`[SYNC:site_plans] ── op ${op.id} (tentative #${(op.attemptCount ?? 0) + 1}) ──`);
            console.log(`[SYNC:site_plans] op     : ${op.op}`);
            console.log(`[SYNC:site_plans] name   : ${data.name ?? '(sans nom)'}`);
            console.log(`[SYNC:site_plans] uri    : ${typeof data.uri === 'string' ? (data.uri.slice(0, 100)) : '(absent)'}`);
            console.log(`[SYNC:site_plans] uri locale : ${hasLocalUri ? 'OUI → upload requis' : 'NON (déjà remote ou null)'}`);
          }
          try {
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload(op.table, data),
              uploadStepTimeoutMs(data),
            );
            if (op.table === 'site_plans') {
              console.log(`[SYNC:site_plans] upload résultat — allOk:${prep.allOk} hadLocal:${prep.hadLocal}`);
              if (!prep.allOk) {
                console.error(`[SYNC:site_plans] ECHEC upload — erreurs: ${(prep.uploadErrors ?? []).join(' | ')}`);
              }
              if (prep.data?.uri && prep.data.uri !== op.data?.uri) {
                console.log(`[SYNC:site_plans] uri transformée → ${String(prep.data.uri).slice(0, 100)}`);
              }
            }
            if (prep.data === null && prep.allOk && op.table === 'photos') {
              console.warn(`[queue] dropping photos op ${op.id}: local file missing on disk`);
              // La progression est incrémentée par le `finally` de l'opération
              // (ne pas la compter ici aussi, sous peine de double comptage).
              continue;
            }
            if (prep.data) {
              data = prep.data;
              retryData = prep.data;
            }
            // Même logique que pour le RPC de création : dès que des photos
            // locales d'une réserve sont uploadées, refléter les URLs distantes
            // dans le cache sans attendre le succès de la mutation. Exclut les
            // photoPatch, dont le payload ne contient qu'une liste partielle qui
            // écraserait la galerie complète en cache.
            if (op.table === 'reserves' && !op.photoPatch && prep.hadLocal && prep.allOk) {
              const reserveId = data?.id ?? op.filter?.value;
              if (reserveId) {
                await applySyncedReservePhotoPayloadToCache(userId, String(reserveId), data ?? {});
              }
            }
            if (!prep.allOk) {
              const errDetail = prep.uploadErrors?.join(' | ') ?? '';
              if (op.photoPatch) {
                // Ré-enfiler avec le progrès partiel (photos déjà uploadées en
                // URL distante) plutôt que le payload d'origine, sinon chaque
                // passe ré-uploade tout depuis zéro.
                fail(retryData ? { ...op, data: retryData } : op, errDetail || 'Échec upload photo. Nouvelle tentative au prochain passage.');
                continue;
              }

              if (op.table === 'reserves') {
                // ── Partial photo failure for a reserve ───────────────────────
                // The photo upload failed but the reserve's text data (title,
                // description, status, lot, company, etc.) must not be held
                // hostage by it. Strategy:
                //   1. Strip the local photo URIs from the payload.
                //   2. Proceed with the insert/update so the reserve is saved.
                //   3. Re-queue a photo-only merge after the reserve row succeeds.
                const safeData = { ...(data ?? {}) };
                const pendingPhotoData: Record<string, any> = {};

                if (typeof safeData.photo_uri === 'string' && isLocalUri(safeData.photo_uri)) {
                  pendingPhotoData.photo_uri = safeData.photo_uri;
                  safeData.photo_uri = null;
                }
                if (Array.isArray(safeData.photos)) {
                  const localOnes = safeData.photos.filter(
                    (p: any) => p?.uri && isLocalUri(p.uri),
                  );
                  if (localOnes.length > 0) {
                    pendingPhotoData.photos = localOnes;
                    safeData.photos = safeData.photos.filter(
                      (p: any) => !p?.uri || !isLocalUri(p.uri),
                    );
                  }
                }

                data = safeData;
                retryData = { ...safeData };
                if (Object.prototype.hasOwnProperty.call(pendingPhotoData, 'photo_uri')) {
                  retryData.photo_uri = pendingPhotoData.photo_uri;
                }
                if (Array.isArray(pendingPhotoData.photos)) {
                  retryData.photos = [
                    ...(Array.isArray(safeData.photos) ? safeData.photos : []),
                    ...pendingPhotoData.photos,
                  ];
                }

                // Defer the photo-only retry until the generic reserve op succeeds.
                // Otherwise an INSERT followed by a photo UPDATE can replay in the
                // wrong order and the photo patch will hit a row that does not exist.
                const reserveId = safeData.id ?? op.filter?.value;
                if (Object.keys(pendingPhotoData).length > 0 && reserveId) {
                  console.warn(
                    `[queue] reserve ${reserveId}: syncing text data without photos. Upload errors: ${errDetail}`,
                  );
                  deferredPhotoPatch = {
                    id: genQueueId(),
                    queuedAt: new Date().toISOString(),
                    table: 'reserves',
                    op: 'update',
                    filter: { column: 'id', value: reserveId },
                    data: pendingPhotoData,
                    photoPatch: {
                      action: 'upsert',
                      photos: Array.isArray(pendingPhotoData.photos) ? pendingPhotoData.photos : undefined,
                      photoUri: typeof pendingPhotoData.photo_uri === 'string' ? pendingPhotoData.photo_uri : null,
                    },
                    lastError: errDetail || 'Échec upload photo. Nouvelle tentative au prochain passage.',
                    attemptCount: (op.attemptCount ?? 0) + 1,
                  };
                }
                // Fall through to the generic replay below with safeData
              } else {
                fail(op, errDetail || 'Échec upload de fichiers locaux (photos/plans). Nouvelle tentative au prochain passage.');
                continue;
              }
            }
          } catch (e) {
            fail(op, e);
            continue;
          }
        }
        retryOpForCatch = retryData ? { ...op, data: retryData } : op;

        // ── Reserve photo patch (merge by photo ID) ─────────────────────────
        // A photo-only retry must not write a stale `photos` snapshot. Fetch the
        // live gallery, merge/delete by photo ID, then write the merged result.
        if (op.photoPatch && op.table === 'reserves' && op.filter?.column === 'id') {
          const reserveId = op.filter.value;
          const { data: reserveRows, error: fetchErr } = await supabaseRestSelect<any>(
            'reserves',
            'photos,photo_uri',
            { column: 'id', value: reserveId },
          );
          if (fetchErr) { fail(op, fetchErr); continue; }

          const serverReserve = reserveRows?.[0] ?? null;
          if (!serverReserve) continue;

          let mergedPhotos: any[] = Array.isArray(serverReserve.photos)
            ? [...serverReserve.photos]
            : [];

          if (op.photoPatch.action === 'delete') {
            const ids = new Set((op.photoPatch.photoIds ?? []).map(String));
            mergedPhotos = mergedPhotos.filter((p: any) => !ids.has(String(p?.id)));
          } else {
            const incomingPhotos = Array.isArray(data?.photos)
              ? data.photos
              : (op.photoPatch.photos ?? []);
            const byId = new Map<string, any>();
            for (const photo of mergedPhotos) {
              if (photo?.id) byId.set(String(photo.id), photo);
            }
            for (const photo of incomingPhotos) {
              if (photo?.id) byId.set(String(photo.id), photo);
            }
            mergedPhotos = Array.from(byId.values());
          }

          const incomingPhotoUri =
            typeof data?.photo_uri === 'string'
              ? data.photo_uri
              : typeof op.photoPatch.photoUri === 'string'
              ? op.photoPatch.photoUri
              : undefined;
          const nextPhotoUri = op.photoPatch.action === 'delete' && mergedPhotos.length === 0
            ? null
            : incomingPhotoUri ?? mergedPhotos[0]?.uri ?? serverReserve.photo_uri ?? null;
          const nextPayload = {
            photos: mergedPhotos.length > 0 ? mergedPhotos : null,
            photo_uri: nextPhotoUri,
          };
          const { error: writeErr } = await supabaseRestMutation(
            'reserves',
            'update',
            nextPayload,
            { column: 'id', value: reserveId },
          );
          if (writeErr) fail({ ...op, data: nextPayload }, writeErr);
          continue;
        }

        // ── Generic table/op replay ────────────────────────────────────────
        let result: { error: any; data?: any[] | null };

        if (op.table === 'site_plans') {
          console.log(`[SYNC:site_plans] ── INSERT Supabase (table site_plans) ──`);
          console.log(`[SYNC:site_plans] payload uri   : ${typeof data?.uri === 'string' ? data.uri.slice(0, 100) : '(null)'}`);
          console.log(`[SYNC:site_plans] payload name  : ${data?.name ?? '(absent)'}`);
          console.log(`[SYNC:site_plans] payload org_id: ${data?.organization_id ?? '(absent)'}`);
        }

        if (op.op === 'insert') {
          result = await supabaseRestMutation(op.table, 'insert', data!);
          if (op.table === 'site_plans') {
            if (result.error) {
              console.error(`[SYNC:site_plans] ECHEC INSERT — code:${result.error.code} msg:${result.error.message} details:${result.error.details ?? ''} hint:${result.error.hint ?? ''}`);
            } else {
              console.log(`[SYNC:site_plans] SUCCÈS INSERT ✓`);
            }
          }
          if (result.error?.code === '23505') result = { error: null };
        } else if (op.op === 'upsert') {
          result = await supabaseRestMutation(op.table, 'upsert', data!);
        } else if (op.op === 'update') {
          if (!op.filter) {
            fail(op, `UPDATE ${op.table} refusé: filtre manquant.`);
            continue;
          }
          if (op.table === 'site_plans' && data?.__replace_file_safely && op.filter.column === 'id') {
            const patch = { ...data };
            delete patch.__replace_file_safely;
            result = await supabaseRestRpc('replace_site_plan_file_safely', {
              p_plan_id: op.filter.value,
              p_patch: patch,
              p_reason: 'offline_queue_replace_site_plan_file',
            });
          } else if (op.table === 'reserves' && op.filter.column === 'id' && typeof op.baseVersion === 'number') {
            const rpcResult = await applyReservePatchOperation({
              operationId: op.id,
              reserveId: String(op.filter.value),
              baseVersion: op.baseVersion,
              patch: data!,
            });
            const outcome = firstReserveMutationResult(rpcResult.data);
            if (rpcResult.error && isReserveMutationRpcUnavailable(rpcResult.error)) {
              result = await supabaseRestMutation(op.table, 'update', data!, op.filter);
            } else if (rpcResult.error) {
              result = rpcResult;
            } else if (!outcome || outcome.status === 'ok') {
              result = { error: null, data: outcome ? [outcome] : null };
            } else if (outcome.status === 'version_conflict') {
              // Conflit de version : rebaser le patch sur la version courante du
              // serveur avec un nouvel operation_id (sinon le serveur renvoie le
              // conflit mémorisé à l'infini → opération coincée pour toujours).
              const rebase = await rebaseReservePatchOnConflict(String(op.filter.value), data!, outcome);
              if (rebase.kind === 'applied') {
                result = { error: null, data: [rebase.outcome] };
              } else if (rebase.kind === 'retry') {
                // Ré-enfiler avec la version rebasée + un nouvel id pour
                // réessayer proprement (et non rejouer le conflit mémorisé).
                failedOps.push({
                  ...op,
                  id: rebase.operationId,
                  baseVersion: rebase.baseVersion,
                  lastError: `version_conflict — rebasé sur v${rebase.baseVersion ?? '?'}, réessai au prochain passage`,
                  attemptCount: (op.attemptCount ?? 0) + 1,
                });
                continue;
              } else {
                fail(retryOpForCatch, rebase.message ?? rebase.status, { terminalStatus: rebase.status });
                continue;
              }
            } else {
              const terminal = ['deleted', 'forbidden', 'not_found', 'duplicate_operation_mismatch', 'invalid_payload'].includes(outcome.status);
              fail(retryOpForCatch, outcome.message ?? outcome.status, terminal ? { terminalStatus: outcome.status } : undefined);
              continue;
            }
          } else {
            result = await supabaseRestMutation(op.table, 'update', data!, op.filter);
          }
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            if (op.filter?.column === 'id') {
              try {
                const { data: exists, error: existsErr } = await supabaseRestSelect(
                  op.table,
                  'id',
                  { column: 'id', value: op.filter.value },
                );
                if (!existsErr && !exists?.[0]) {
                  continue;
                }
              } catch {}
            }
            fail(retryOpForCatch, `UPDATE sur ${op.table} a affecté 0 ligne. Probablement bloqué par une policy RLS, ou l'élément ne vous appartient plus.`);
            continue;
          }
        } else if (op.op === 'delete') {
          if (!op.filter) {
            fail(op, `DELETE ${op.table} refusé: filtre manquant.`);
            continue;
          }
          const criticalDeleteRpc = CRITICAL_SOFT_DELETE_RPCS[op.table];
          if (criticalDeleteRpc && op.filter.column === 'id') {
            result = await supabaseRestRpc(criticalDeleteRpc.fn, {
              [criticalDeleteRpc.idArg]: op.filter.value,
              p_reason: op.data?.deleted_reason ?? criticalDeleteRpc.reason,
            });
          } else {
          if (op.table === 'chantiers' && op.filter.column === 'id') {
            const { data: linkedReserves, error: linkedErr } = await supabaseRestSelect(
              'reserves',
              'id',
              { column: 'chantier_id', value: op.filter.value },
            );
            if (linkedErr) {
              fail(op, linkedErr);
              continue;
            }
            if (linkedReserves?.[0]) {
              fail(op, i18n.t('networkQueue.deleteProjectHasReserves'));
              continue;
            }
          }
          if (op.table === 'reserves') {
            const softDeletePayload = {
              deleted_at: op.data?.deleted_at ?? new Date().toISOString(),
              deleted_by: op.data?.deleted_by ?? user?.name ?? user?.email ?? 'Sync offline',
              ...(Array.isArray(op.data?.history) ? { history: op.data.history } : {}),
            };
            result = await supabaseRestMutation(op.table, 'update', softDeletePayload, op.filter);
          } else {
            result = await supabaseRestMutation(op.table, 'delete', undefined, op.filter);
          }
          }
          if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
            if (op.filter?.column === 'id') {
              try {
                const { data: exists, error: existsErr } = await supabaseRestSelect(
                  op.table,
                  'id',
                  { column: 'id', value: op.filter.value },
                );
                if (!existsErr && !exists?.[0]) {
                  // Row is already gone server-side — consider the delete successful
                  continue;
                }
              } catch {}
            }
            fail(op, `DELETE sur ${op.table} bloqué par une policy RLS (0 ligne supprimée).`);
            continue;
          }
        } else {
          fail(op, `Opération inconnue: ${(op as any).op}`);
          continue;
        }

        if (result.error) fail(retryOpForCatch, result.error);
        else {
          if (op.op === 'insert' && op.table === 'messages' && data?.id && data?.channel_id) {
            triggerMessagePush(String(data.id), String(data.channel_id));
          }
          if (op.op === 'insert' && op.table === 'reserves' && data?.id) {
            triggerReserveCreatedPush(String(data.id));
          }
          if (deferredPhotoPatch) failedOps.push(deferredPhotoPatch);
        }
      } catch (e) {
        fail(retryOpForCatch, e);
      } finally {
        processed += 1;
        // Marque le progrès : tant qu'une opération est traitée régulièrement,
        // la passe n'est jamais considérée comme gelée par le garde-fou.
        syncProgressAtRef.current = Date.now();
        setSyncProgress({ done: processed, total: currentQueue.length });
      }
    }

    // Si une passe plus récente nous a préemptés (cette passe était gelée puis
    // a fini par se réveiller), on n'écrit RIEN : la passe courante est
    // désormais propriétaire de la file. Écraser l'état ici ferait revivre des
    // opérations déjà rejouées ou supprimerait celles enfilées entre-temps.
    if (!isCurrentGeneration()) return;

    // Keep only unresolved items in the queue
    const remaining = [
      ...pendingConflicts.map(c => currentQueue.find(o => o.id === c.id)!),
      ...failedOps,
    ].filter(Boolean);

    await backupQueue(currentQueue, 'before-sync-prune');

    // Ne pas écraser la file avec le seul instantané traité : des opérations ont
    // pu être enfilées PENDANT la passe (ex. une réserve modifiée pendant
    // l'upload d'une autre). On préserve donc, en plus des opérations restantes,
    // toute opération ajoutée depuis le début de la passe — sinon elles seraient
    // perdues silencieusement (et jamais synchronisées). queueRef est mis à jour
    // avant React et AsyncStorage pour rester insensible au batching et aux
    // courses avec un enqueue concurrent.
    const processedIds = new Set(currentQueue.slice(0, processed).map(o => o.id));
    const nextQueue = coalesceQueuedOperations([
      ...remaining,
      ...queueRef.current.filter(o => !processedIds.has(o.id)),
    ]);
    queueRef.current = nextQueue;
    setQueue(nextQueue);
    await saveQueue(nextQueue);

    // Décision de statut / purge : basée sur l'état le plus récent connu.
    const leftover = nextQueue;

    // Borné : un refetch bloqué ne doit pas laisser le verrou pris.
    if (!circuitOpened) {
      await withTimeoutMs(refetchActiveQueries('queue-processed'), REFETCH_TIMEOUT_MS).catch(() => {});
      syncInfrastructureFailureCountRef.current = 0;
      syncBackoffUntilRef.current = 0;
    }

    if (circuitOpened) {
      setSyncStatus('error');
      reloadHandlerRef.current?.();
      scheduleSync(circuitDelayMs);
    } else if (pendingConflicts.length > 0) {
      setConflicts(pendingConflicts);
      setSyncStatus('conflict');
    } else if (failedOps.length > 0) {
      setSyncStatus('error');
      reloadHandlerRef.current?.();
    } else if (hasReplayableQueuedOperations(leftover)) {
      // Tout l'instantané est passé, mais des opérations enfilées pendant la
      // passe restent à synchroniser : on n'affiche pas « terminé », une
      // nouvelle passe (cold-start / ping) les prendra en charge.
      setSyncStatus('idle');
      reloadHandlerRef.current?.();
      scheduleSync();
    } else if (leftover.length > 0) {
      // Les refus métier terminaux sont conservés uniquement pour informer
      // l'utilisateur. Ils ne sont ni « en attente » ni rejouables.
      setSyncStatus('error');
      reloadHandlerRef.current?.();
    } else {
      setSyncStatus('done');
      reloadHandlerRef.current?.();
      setTimeout(() => { if (isCurrentGeneration()) setSyncStatus('idle'); }, 4000);
    }

    // ── Purge des fichiers photo locaux orphelins ──────────────────────────
    // S'exécute après CHAQUE passe — plus seulement les passes 100 % propres,
    // sinon une file durablement en échec (op terminale, session expirée…)
    // empêche toute récupération d'espace, d'autant que les fichiers uploadés
    // ne sont plus supprimés immédiatement après upload. Sans risque pour les
    // données : seuls les fichiers de plus de 7 jours ET non référencés sont
    // supprimés. Sont protégées les URIs des opérations restantes de la file
    // courante, mais aussi celles des files persistées des AUTRES comptes de
    // l'appareil et des sauvegardes de file (« Vider ») — le dossier
    // documentDirectory/photos/ est partagé entre tous les comptes.
    void (async () => {
      try {
        const referencedUris = new Set<string>();
        const collect = (d: Record<string, any> | null | undefined) => {
          if (!d) return;
          if (typeof d.photo_uri === 'string' && isLocalUri(d.photo_uri)) referencedUris.add(d.photo_uri);
          if (Array.isArray(d.photos)) {
            for (const p of d.photos) {
              if (p && typeof p.uri === 'string' && isLocalUri(p.uri)) referencedUris.add(p.uri);
            }
          }
          if (typeof d.uri === 'string' && isLocalUri(d.uri)) referencedUris.add(d.uri);
        };
        const collectOps = (ops: any[] | null | undefined) => {
          if (!Array.isArray(ops)) return;
          for (const op of ops) {
            collect(op?.data);
            collect(op?.rpc?.args?.p_reserve);
          }
        };
        collectOps(leftover);
        const allKeys = await AsyncStorage.getAllKeys();
        for (const key of allKeys) {
          const isQueueKey = key.startsWith(OFFLINE_QUEUE_PREFIX) && key !== offlineQueueKey;
          const isBackupKey = key.startsWith(OFFLINE_QUEUE_BACKUP_PREFIX);
          if (!isQueueKey && !isBackupKey) continue;
          try {
            const raw = await AsyncStorage.getItem(key);
            if (!raw) continue;
            const parsed = JSON.parse(raw);
            collectOps(Array.isArray(parsed) ? parsed : parsed?.queue);
          } catch {}
        }
        await purgeOrphanedPhotoFiles(referencedUris);
      } catch {}
    })();
    } finally {
      // Ne relâcher le verrou / réinitialiser la progression que si nous sommes
      // toujours la passe courante (une passe préemptée ne doit pas toucher
      // l'état de la passe qui l'a remplacée).
      if (isCurrentGeneration()) {
        setSyncProgress({ done: 0, total: 0 });
        syncingRef.current = false;
      }
    }
  }

  // Keep processSyncQueueRef always pointing at the latest implementation so
  // stale closures (AppState listener, ping interval) call the right version.
  // This is intentionally assigned during render (not in a useEffect) so the
  // ref is always current before any async callback fires.
  processSyncQueueRef.current = processSyncQueue;

  // ── Conflict resolution ────────────────────────────────────────────────────

  const resolveConflict = useCallback(async (conflictId: string, chosenStatus: string) => {
    const conflict = conflicts.find(c => c.id === conflictId);
    if (!conflict) return;

    const now = new Date().toISOString().split('T')[0];
    const history = [
      ...conflict.history,
      {
        id: `r_${Date.now()}`,
        action: 'Conflit résolu',
        author: conflict.author,
        createdAt: now,
        newValue: STATUS_LABELS[chosenStatus] ?? chosenStatus,
      },
    ];

    const { error: resolveErr } = await supabaseRestMutation('reserves', 'update', {
      status: chosenStatus,
      history,
      closed_at: chosenStatus === 'closed' ? (conflict.closedAt ?? now) : null,
      closed_by: chosenStatus === 'closed' ? conflict.closedBy ?? null : null,
    }, { column: 'id', value: conflict.reserveId });

    if (resolveErr) {
      console.warn('[resolveConflict] server error — conflict kept in queue:', resolveErr.message);
      setSyncStatus('error');
      return;
    }

    const remaining = conflicts.filter(c => c.id !== conflictId);
    setConflicts(remaining);

    if (remaining.length === 0) {
      setSyncStatus('done');
      reloadHandlerRef.current?.();
      setTimeout(() => setSyncStatus('idle'), 4000);
    }
  }, [conflicts]);

  const dismissConflicts = useCallback(() => {
    setConflicts([]);
    setSyncStatus('idle');
  }, []);

  // ── Queue management ───────────────────────────────────────────────────────

  const enqueueOperation = useCallback((op: Omit<QueuedOperation, 'id' | 'queuedAt'>) => {
    const allowedOps = new Set(['insert', 'update', 'upsert', 'delete', 'rpc']);
    if (!allowedOps.has((op as any).op)) {
      console.warn('[queue] operation ignored: op inconnue', (op as any).op, op.table);
      return;
    }
    if ((op.op === 'update' || op.op === 'delete') && !op.filter) {
      console.warn(`[queue] ${op.op} ${op.table} ignored: filtre manquant`);
      return;
    }
    const newOp: QueuedOperation = {
      ...op,
      id: genQueueId(),
      queuedAt: new Date().toISOString(),
    };
    // queueRef est la source atomique : React peut différer le state updater et
    // l'effet qui recopient la file. Sans cette mise à jour synchrone, le moteur
    // lancé juste après l'enqueue voit encore [] et l'opération attend le prochain
    // ping — voire indéfiniment après certaines reprises Android.
    const updated = coalesceQueuedOperations([...queueRef.current, newOp]);
    queueRef.current = updated;
    setQueue(updated);
    void saveQueue(updated);
    scheduleSync();
  }, [saveQueue, scheduleSync]);

  const clearQueue = useCallback(async () => {
    await backupQueue(queueRef.current, 'manual-clear');
    if (syncKickTimerRef.current) {
      clearTimeout(syncKickTimerRef.current);
      syncKickTimerRef.current = null;
    }
    queueRef.current = [];
    setQueue([]);
    // Plus d'opérations en attente → plus rien n'est « bloqué par la session ».
    setSyncAuthBlocked(false);
    queueWriteChainRef.current = queueWriteChainRef.current
      .catch(() => {})
      .then(() => AsyncStorage.removeItem(offlineQueueKey))
      .catch(() => {});
    await queueWriteChainRef.current;
    try { await AsyncStorage.removeItem(OFFLINE_QUEUE_PREFIX + 'anon'); } catch {}
  }, [backupQueue, offlineQueueKey]);

  const dismissRejectedOperations = useCallback(async () => {
    const rejected = queueRef.current.filter(operation => operation.terminal);
    if (rejected.length === 0) return;

    // Final safeguard for outcomes created by an older app session: reconcile
    // the durable inventory cache before removing the acknowledgement record.
    for (const operation of rejected) {
      if (operation.rpc?.fn !== 'record_inventory_movement') continue;
      const terminalOutcome = operation.terminalOutcome?.domain === 'inventory'
        ? operation.terminalOutcome
        : normalizeInventoryMovementOutcome(
            {
              status: operation.terminalStatus ?? 'server_rejected',
              message: operation.lastError,
            },
            inventoryOutcomeContextFromQueuedOperation(operation),
          );
      try {
        await reconcileTerminalInventoryOperationCache(operation, terminalOutcome, userId);
      } catch (error) {
        console.warn('[inventory] acknowledgement cache reconciliation failed:', (error as any)?.message ?? error);
        // Keep the terminal outcome visible. Removing it here would discard the
        // only automatic repair evidence while the durable cache is still stale.
        throw error;
      }
    }

    await backupQueue(rejected, 'dismiss-rejected');
    const next = queueRef.current.filter(operation => !operation.terminal);
    queueRef.current = next;
    setQueue(next);
    await saveQueue(next);
    setSyncStatus('idle');
    void refetchActiveQueries('rejected-operations-dismissed');
    if (hasReplayableQueuedOperations(next)) scheduleSync();
  }, [backupQueue, saveQueue, scheduleSync, userId]);

  const registerReloadHandler = useCallback((fn: () => void) => {
    reloadHandlerRef.current = fn;
  }, []);

  const retrySync = useCallback(async () => {
    // An explicit user retry is a fresh health probe and must not be swallowed
    // by the automatic circuit-breaker delay.
    syncBackoffUntilRef.current = 0;
    syncInfrastructureFailureCountRef.current = 0;
    if (syncKickTimerRef.current) {
      clearTimeout(syncKickTimerRef.current);
      syncKickTimerRef.current = null;
    }
    await processSyncQueueRef.current();
  }, []);

  const queueCounts = getSyncQueueCounts(queue);

  return (
    <NetworkContext.Provider value={{
      isOnline,
      queue,
      queueCount: queueCounts.pending,
      rejectedCount: queueCounts.rejected,
      attentionCount: queueCounts.attention,
      stuckCount: queueCounts.stuck,
      queueLoaded,
      syncStatus,
      syncProgress,
      syncAuthBlocked,
      conflicts,
      enqueueOperation,
      resolveConflict,
      dismissConflicts,
      registerReloadHandler,
      clearQueue,
      dismissRejectedOperations,
      retrySync,
    }}>
      {children}
    </NetworkContext.Provider>
  );
}
