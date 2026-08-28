import React, {
  createContext, useContext, useEffect, useRef,
  useState, useCallback, useMemo,
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
  readCache,
  readCacheStrict,
  writeCache,
} from '@/lib/offlineCache';
import { normalizeVisitePayloadForSupabase } from '@/lib/mappers';
import { useAuth } from '@/context/AuthContext';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { RESERVES_CACHE_KEY, VISITES_CACHE_KEY } from '@/lib/cacheKeys';
import { triggerMessagePush, triggerReserveCreatedPush } from '@/lib/push/client';
import type { Comment, InventoryMovement, InventoryProduct, Reserve, Visite } from '@/constants/types';
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
  getSyncQueueOperationDomain,
  isInventoryMovementOperation,
  isInventoryQueuedOperation,
  isReplayableQueuedOperation,
  type SyncQueueTerminalOutcome,
} from '@/lib/syncQueuePolicy';
import { classifyFailureOutcome } from '@/lib/syncOutcomeClassifier';
import { computeTimerSlice, normalizeTimerTarget } from '@/lib/syncTimerSlice';
import { redactSensitiveText } from '@/lib/redactSensitiveText';
import { rebaseReservePatchOnConflict, type PreparedRebaseWrite } from '@/lib/reserveRebase';
import { ensureQueueEntryIdentities } from '@/lib/queueEntryIdentity';
import { createQueueWriteChain } from '@/lib/queueWriteChain';
import { publishAfterDurableWrite } from '@/lib/queuePublication';
import {
  prepareQueueForDispatch,
  type PreparedQueueForDispatch,
} from '@/lib/queueDispatchPreparation';
import {
  PURGE_PENDING_RECONCILIATION,
  isUnambiguouslyPurgeableOperation,
  resumePendingQueuePurge,
  runManualQueuePurge,
  type ManualQueuePurgeResult,
  type QueueDispatchState,
} from '@/lib/manualQueuePurge';
import { nextServiceFailureStreak } from '@/lib/syncServiceStreak';
import type { SupabaseRestMeta } from '@/lib/supabaseRest';
import type { PassOperationOutcome } from '@/lib/syncPassScheduler';
import { normalizeAttemptCount, type SyncFailureClass, type SyncRetrySource } from '@/lib/syncRetryPolicy';
import {
  coalesceQueuedOperations,
  migrateAndCoalesceSitePlanSnapshots,
} from '@/lib/offlineQueueCoalescing';
import { dismissAuthorizedTerminalQueueEntries } from '@/lib/authorizedQueueDismissal';
import {
  queueHydrationScopeKey,
  queueReplayPriority,
  queuedInsertMatchesPersistedRow,
} from '@/lib/syncQueueDependencies';
import {
  HISTORICAL_VISIT_RECOVERY_INTENT,
  planHistoricalVisitRecovery,
  prepareRecoveredVisitQueue,
  queueNeedsHistoricalVisitRecoveryEvaluation,
  recoveredVisitMatchesPersistedIdentity,
  releaseRecoveredVisitDependencies,
  summarizeHistoricalVisitRecovery,
  type HistoricalVisitRecoveryAudit,
} from '@/lib/historicalVisitRecovery';
import {
  inventoryMovementsCacheKey,
  inventoryOutcomeContextFromQueuedOperation,
  inventoryProductsCacheKey,
  isTerminalInventoryMovementOutcome,
  normalizeInventoryMovementOutcome,
  parseInventoryMovementOutcome,
  reconcileTerminalInventoryMovementCache,
  type InventoryMovementOutcome,
} from '@/lib/inventoryMovementOutcome';

const OFFLINE_QUEUE_PREFIX = 'buildtrack_offline_queue_v3_';
const OFFLINE_QUEUE_BACKUP_PREFIX = 'buildtrack_offline_queue_backup_v1_';

function emptyHistoricalVisitRecoveryAudit(): HistoricalVisitRecoveryAudit {
  return {
    evaluated: false,
    candidateCount: 0,
    plannedCount: 0,
    profileOrganizationAvailable: false,
    queuedOrganizationFallbackCount: 0,
    skippedReasons: {},
    evidence: {
      createReserveOperationCount: 0,
      linkOperationCount: 0,
      legacyVisitReferenceCount: 0,
      missingVisitFailureCount: 0,
      foreignKeyFailureCount: 0,
      terminalForeignKeyRecoveryCount: 0,
      foreignKeyContradictionCount: 0,
      reserveLinkCorrelationCount: 0,
      ambiguousReserveLinkCount: 0,
    },
  };
}

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

// Relance après une passe dont certaines opérations ont échoué sans ouvrir le
// disjoncteur (timeout d'upload, refus ponctuel…). Sans cette relance explicite,
// la file n'est reprise que par le ping natif de 10 s — jamais sur le web, où
// l'intervalle ne déclenche aucune passe.
const SYNC_FAILURE_RETRY_DELAY_MS = 30_000;


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
/**
 * Ce qu'un appelant fournit : ni identite, ni horodatage, ni etat d'envoi. Ces
 * trois-la appartiennent a la file, et laisser un appelant affirmer `started`
 * sans passer par la persistance stricte reintroduirait le defaut.
 */
export type EnqueueOperationInput = Omit<
  QueuedOperation,
  'id' | 'queueEntryId' | 'queuedAt' | 'dispatchState'
>;

export interface EnqueueOperationOptions {
  /** Affirmation explicite : aucune requete n'est partie pour cette ecriture. */
  proveNeverStarted?: boolean;
}

export interface QueuedOperation {
  /**
   * Identité LOCALE et immuable de l'entrée dans la file.
   *
   * Distincte de `id`, qui est l'identifiant idempotent connu du serveur et que
   * le rebase remplace volontairement. Le jeton de `runSyncPass` ne vit que le
   * temps d'une passe, deux entrées peuvent partager le même `id` métier, et
   * une préemption oblige la génération suivante à retrouver exactement la même
   * entrée persistée. Aucune signification serveur : elle n'entre ni dans
   * l'empreinte métier, ni dans l'export de diagnostic.
   *
   * Optionnelle le temps de la migration des files déjà persistées.
   */
  queueEntryId?: string;
  /**
   * Preuve DURABLE qu'aucune requête n'est partie.
   *
   * Déduire cette preuve de l'absence de compteurs était faux : une métadonnée
   * illisible, une file antérieure au champ, ou une branche d'échec
   * n'incrémentant rien produisent toutes « aucune trace de tentative » sans
   * démontrer qu'aucune écriture n'a été envoyée. Passe à `started` — et est
   * persistée — AVANT le premier appel réseau de la passe.
   */
  dispatchState?: QueueDispatchState;
  /** Suppression manuelle en cours : réconciliation pas encore terminée. */
  purgeState?: typeof PURGE_PENDING_RECONCILIATION;
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
  /** Empreinte du dernier échec : seuls des refus IDENTIQUES répétés comptent. */
  lastFailureFingerprint?: string;
  /** Refus déterministes consécutifs de même empreinte. */
  sameFailureCount?: number;
  // ── Planification par opération (P5) ────────────────────────────────────
  // Tous optionnels : une file persistée par une version anterieure ne porte
  // aucun de ces champs, et doit rester immediatement exigible plutot que
  // d'attendre une echeance qu'elle n'a jamais eue.
  /** Derniere tentative reelle, succes comme echec. */
  lastAttemptAt?: string;
  /** Dernier echec, distinct de la derniere tentative. */
  lastFailureAt?: string;
  /** Echeance avant laquelle l'operation ne doit pas etre rejouee. */
  nextAttemptAt?: string;
  failureClass?: SyncFailureClass;
  retrySource?: SyncRetrySource;
  /** Statut HTTP du dernier verdict serveur, pour le diagnostic. */
  lastHttpStatus?: number;
  /** Version du schema de planification, pour une migration future. */
  retryPolicyVersion?: 1;
  /** Server row version observed when the user made this mutation. */
  baseVersion?: number | null;
  /** Terminal failures stay visible but are not replayed automatically. */
  terminal?: boolean;
  terminalStatus?: string;
  /** Structured server result persisted for domain-aware acknowledgement UX. */
  terminalOutcome?: SyncQueueTerminalOutcome;
  /** Insert-if-missing repair for a legacy visit parent lost by an old client. */
  recoveryIntent?: typeof HISTORICAL_VISIT_RECOVERY_INTENT;
  /** Enfant suspendu jusqu'au succes verifie de la visite reconstruite. */
  recoveryBlockedByVisitId?: string;
  /** Identites locales des enfants que ce parent peut seul reactiver. */
  recoveryDependencyKeys?: string[];
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
  if (!isInventoryMovementOperation(operation) || outcome.domain !== 'inventory') return false;
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
  /** Horodatages ISO exposes pour le diagnostic support. `null` si jamais survenu. */
  lastSyncAttemptAt: string | null;
  /** Derniere operation individuellement acceptee par le serveur. */
  lastOperationSuccessAt: string | null;
  /** Derniere fois que la file s'est videe entierement. */
  lastQueueDrainedAt: string | null;
  /** `null` tant qu'aucune sonde n'a distingue Internet du backend. */
  backendReachable: boolean | null;
  /** Prochaine passe planifiee, quand un backoff est actif. */
  nextSyncAttemptAt: string | null;
  /** Resume non sensible de la derniere tentative de reconstruction de visite. */
  historicalVisitRecovery: HistoricalVisitRecoveryAudit;
  conflicts: StatusConflict[];
  enqueueOperation: (
    op: EnqueueOperationInput,
    options?: EnqueueOperationOptions,
  ) => void;
  resolveConflict: (conflictId: string, chosenStatus: string) => Promise<void>;
  dismissConflicts: () => void;
  registerReloadHandler: (fn: () => void) => void;
  /**
   * Rejette reellement : synchronisation en cours, disque indisponible, ou
   * compte change pendant l'action. Rend ce qui a ete supprime et ce qui a ete
   * CONSERVE — une ecriture deja tentee reste ambigue.
   */
  clearQueue: () => Promise<ManualQueuePurgeResult<QueuedOperation>>;
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
  lastSyncAttemptAt: null,
  lastOperationSuccessAt: null,
  lastQueueDrainedAt: null,
  backendReachable: null,
  nextSyncAttemptAt: null,
  historicalVisitRecovery: emptyHistoricalVisitRecoveryAudit(),
  conflicts: [],
  enqueueOperation: () => {},
  resolveConflict: async () => {},
  dismissConflicts: () => {},
  registerReloadHandler: () => {},
  clearQueue: async () => ({
    removed: [], keptAmbiguous: [], concurrentAdditions: [],
    keptWithoutIdentity: [], keptWithoutCompensator: [],
  }),
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

/**
 * `fetch` borné ET réellement interrompu. Sans le contrôleur, une sonde partie
 * sur un lien mort restait pendante bien après son délai : les sondes se
 * cumulaient toutes les 10 s, chacune tenant une socket sur une connexion déjà
 * saturée — exactement ce qu'on cherche à mesurer.
 */
async function fetchWithAbort(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkInternetReachable(): Promise<boolean> {
  for (const url of PING_URLS) {
    try {
      const res = await fetchWithAbort(url, { method: 'GET', cache: 'no-cache' }, 8000);
      if (res.ok || res.status === 204 || res.status === 404) return true;
    } catch {}
  }
  return false;
}

async function checkSupabaseReachable(): Promise<boolean> {
  if (!isSupabaseConfigured || !SUPABASE_URL || !SUPABASE_KEY) return true;
  try {
    const res = await fetchWithAbort(
      `${SUPABASE_URL}/auth/v1/health`,
      {
        method: 'GET',
        cache: 'no-cache',
        headers: {
          apikey: SUPABASE_KEY,
        },
      },
      12000,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * « En ligne » et « backend joignable » sont deux choses differentes : Internet
 * peut fonctionner alors que Supabase est indisponible. Les fusionner en un
 * booleen unique privait le diagnostic de cette distinction, et le rapport
 * affichait un backend systematiquement « inconnu ».
 */
interface ConnectivityReading {
  online: boolean;
  backendReachable: boolean | null;
}

async function checkAppOnline(navigatorOnline = true): Promise<ConnectivityReading> {
  if (!navigatorOnline) return { online: false, backendReachable: null };
  if (isSupabaseConfigured) {
    if (await checkSupabaseReachable()) return { online: true, backendReachable: true };
    if (await checkInternetReachable()) return { online: true, backendReachable: false };
    // A cached Supabase JWT keeps the user authenticated offline, but it is
    // not a connectivity signal. Returning false here lets the UI communicate
    // "hors connexion" while AuthContext continues to serve the cached session.
    return { online: false, backendReachable: false };
  }
  if (Platform.OS !== 'web') {
    return { online: await checkInternetReachable(), backendReachable: null };
  }
  return { online: true, backendReachable: null };
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
  const startedAt = Date.now();
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
  } finally {
    console.log(`[perf] active queries refetched (${reason}) in ${Date.now() - startedAt}ms`);
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

/**
 * Issue rendue par l'executeur legacy.
 *
 * `provesServerReachable` — et NON `reachedServer` — parce que la nuance est
 * piegeuse : un `503` a bien ete rendu par le serveur, mais il alimente
 * deliberement le compteur de pannes consecutives. Remettre la serie a zero sur
 * « le serveur a repondu » empecherait le disjoncteur de s'ouvrir sur une panne
 * de service prolongee. Ce drapeau signifie donc precisement : « cette issue
 * NON-echec prouve que le backend repond, et les compteurs n'ont ete touches
 * par personne d'autre ». `fail()` ne le pose jamais : le classificateur est
 * deja proprietaire des compteurs pour les echecs.
 */
type QueuedOperationOutcome = PassOperationOutcome<QueuedOperation> & {
  provesServerReachable?: boolean;
  /**
   * Serie rendue par le classificateur pour un echec. Elle fait autorite : elle
   * sait deja qu'un `503` alimente la serie et qu'un `429` ne l'alimente pas.
   */
  serviceFailureStreak?: number;
};

/**
 * Identifiants du contrat des sorties de synchronisation.
 *
 * Voir `docs/sync-loop-exit-contract.md`. Le type litteral fait echouer la
 * compilation sur un identifiant inexistant, et `tests/syncLoopExitContract`
 * verifie que le code et la table portent exactement les memes, chacun une
 * seule fois. Les numeros de ligne, eux, deviennent faux au premier changement.
 */
type SyncExitId =
  'E01' | 'E02' | 'E03' | 'E04' | 'E05' | 'E06' | 'E07' | 'E08' | 'E09' | 'E10' | 'E11' | 'E12' | 'E13' | 'E14' | 'E15' | 'E16' | 'E17' | 'E18' | 'E19' | 'E20' | 'E21' | 'E22' | 'E23' | 'E24' | 'E25' | 'E26' | 'E27' | 'E28' | 'E29' | 'E30' | 'E31' | 'E32' | 'E33' | 'E34' | 'E35' | 'E36' | 'E37' | 'E38' | 'E39' | 'E40' | 'E41' | 'E42' | 'E43' | 'E44' | 'E45' | 'E46' | 'E47' | 'E48' | 'E49' | 'E50' | 'E51' | 'E52' | 'E53' | 'E54' | 'E55' | 'E56' | 'E57' | 'E58' | 'E59' | 'E60' | 'E61' | 'E62';

/**
 * Marqueur d'identite d'une sortie. Ne transforme rien : l'issue traverse
 * inchangee. Il existe pour que la table de contrat soit verifiable branche par
 * branche, et non seulement par decompte — un decompte reste vert si une sortie
 * disparait pendant qu'une autre apparait ailleurs.
 */
function syncExit<T extends QueuedOperationOutcome>(_id: SyncExitId, outcome: T): T {
  return outcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const userId = user?.id;
  const userOrganizationId = user?.organizationId ?? null;
  const recoveryUserName = user?.name ?? user?.email ?? null;
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
  const [lastSyncAttemptAt, setLastSyncAttemptAt] = useState<string | null>(null);
  const [lastOperationSuccessAt, setLastOperationSuccessAt] = useState<string | null>(null);
  const [lastQueueDrainedAt, setLastQueueDrainedAt] = useState<string | null>(null);
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);
  const [nextSyncAttemptAt, setNextSyncAttemptAt] = useState<string | null>(null);
  const [historicalVisitRecovery, setHistoricalVisitRecovery] = useState<HistoricalVisitRecoveryAudit>(
    emptyHistoricalVisitRecoveryAudit,
  );
  // Contrôleur de la passe en cours. Abandonner une passe ne suffisait pas à
  // arrêter ses transferts : un upload préempté continuait à consommer le lien
  // que la passe suivante allait réclamer, et pouvait aboutir après son réessai.
  const passAbortRef = useRef<AbortController | null>(null);
  const abortCurrentPass = useCallback((reason: string) => {
    const controller = passAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    console.warn(`[queue] annulation des transferts de la passe en cours (${reason})`);
    controller.abort();
  }, []);
  const reloadHandlerRef = useRef<(() => void) | null>(null);
  const lastLoadedKeyRef = useRef<string | null>(null);
  // La cle AsyncStorage est par utilisateur, mais les migrations de file sont
  // aussi dependantes de l'organisation. Au demarrage, Auth peut fournir l'id
  // avant le profil : ce second marqueur force alors une nouvelle hydratation.
  const lastLoadedScopeRef = useRef<string | null>(null);
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
  /**
   * Ecritures serialisees de la file. Deux enqueue rapproches ne doivent jamais
   * laisser une ancienne version finir apres la plus recente.
   */
  /** Réessai d'hydratation : distinct du timer de synchronisation. */
  const hydrationRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Réessai de reprise de purge, distinct du précédent.
   *
   * Les confondre neutralisait la reprise : l'hydratation se terminait avec
   * succès juste après, annulait le timer et remettait sa référence à `null`.
   * La réparation attendait alors le prochain démarrage.
   */
  const purgeResumeRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadQueueRef = useRef<(() => Promise<void>) | null>(null);
  /**
   * Référence : l'hydratation reprend une purge interrompue, et le
   * réconciliateur est défini plus bas — une dépendance directe entre les deux
   * `useCallback` serait circulaire.
   */
  const reconcilePurgedOperationRef = useRef<(operation: QueuedOperation) => Promise<void>>(
    async () => {},
  );

  const queueWriteChain = useMemo(() => createQueueWriteChain(
    (key, value) => AsyncStorage.setItem(key, value),
    error => console.warn(
      '[queue] failed to persist offline queue:',
      error instanceof Error ? error.message : String(error),
    ),
  ), []);
  const queueHydrationGenerationRef = useRef(0);

  // Throttle: track when the last sync attempt started so ping-driven retries
  // don't hammer the server (max one attempt per 20 seconds).
  const lastSyncAttemptRef = useRef<number>(0);
  const syncBackoffUntilRef = useRef<number>(0);
  const syncInfrastructureFailureCountRef = useRef<number>(0);

  const scheduleSync = useCallback((delayMs = SYNC_KICK_DELAY_MS) => {
    if (!isSupabaseConfigured) return;

    const targetMs = normalizeTimerTarget(Date.now() + Number(delayMs), Date.now(), SYNC_KICK_DELAY_MS);
    // Le diagnostic doit montrer l'échéance réelle, jamais la fin de la tranche.
    setNextSyncAttemptAt(computeTimerSlice(targetMs, Date.now()).targetIso);

    // Ré-armement par tranches : un seul `setTimeout` couvrant plusieurs
    // semaines n'est pas fiable, et un réveil intermédiaire ne coûte rien.
    const arm = () => {
      if (syncKickTimerRef.current) clearTimeout(syncKickTimerRef.current);
      const slice = computeTimerSlice(targetMs, Date.now());
      syncKickTimerRef.current = setTimeout(() => {
        syncKickTimerRef.current = null;
        if (!computeTimerSlice(targetMs, Date.now()).due) {
          arm();
          return;
        }
        if (
          queueLoadedRef.current &&
          isOnlineRef.current &&
          hasReplayableQueuedOperations(queueRef.current)
        ) {
          void processSyncQueueRef.current();
        }
      }, slice.sliceMs);
    };
    arm();
  }, []);

  useEffect(() => () => {
    if (syncKickTimerRef.current) clearTimeout(syncKickTimerRef.current);
    if (hydrationRetryTimerRef.current) clearTimeout(hydrationRetryTimerRef.current);
    if (purgeResumeRetryTimerRef.current) clearTimeout(purgeResumeRetryTimerRef.current);
    // Démontage du provider : plus personne n'exploitera le résultat, on coupe
    // les transferts au lieu de les laisser courir en tâche de fond.
    abortCurrentPass('démontage du provider');
  }, [abortCurrentPass]);

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

  /**
   * Écriture STRICTE : elle rejette réellement.
   *
   * Indispensable à la préparation d'une écriture idempotente — si l'identité
   * préparée n'atteint pas le disque, aucune requête ne doit partir. L'ancienne
   * implémentation journalisait puis RÉSOLVAIT : un `await` y attendait un
   * succès fabriqué, et le serveur pouvait committer sous une identité que le
   * prochain démarrage ne retrouvait pas.
   */
  const writeQueueStrict = useCallback((q: QueuedOperation[]) => (
    queueWriteChain.write(offlineQueueKey, JSON.stringify(q))
  ), [offlineQueueKey]);

  /**
   * Écriture BEST-EFFORT : les chemins historiques ne doivent pas planter parce
   * que le disque est momentanément indisponible.
   */
  const saveQueue = useCallback((q: QueuedOperation[]) => (
    queueWriteChain.writeBestEffort(offlineQueueKey, JSON.stringify(q))
  ), [offlineQueueKey]);

  // Load the queue for the *current* user. We defer hydration until we know
  // user.id to avoid the catastrophic race where the queue is initially loaded
  // under the `..._anon` key (empty) and then never re-merged once user.id
  // arrives — losing every offline mutation made before login finished
  // restoring. We also migrate any orphan `..._anon` queue (mutations enqueued
  // before authentication completed) into the per-user key so they can sync.
  /**
   * Rappelle `loadQueue` — et non `processSyncQueue`.
   *
   * `scheduleSync` ne déclenche le moteur que si `queueLoadedRef.current` est
   * vrai : après un échec de migration il se réveillait, constatait que la file
   * n'était pas chargée, et ne faisait rien. La file restait bloquée jusqu'au
   * redémarrage ou au changement de compte — un blocage permanent pour toute la
   * session, sûr pour les données mais tout aussi inutilisable.
   */
  const scheduleHydrationRetry = useCallback((generation: number) => {
    if (hydrationRetryTimerRef.current) clearTimeout(hydrationRetryTimerRef.current);
    hydrationRetryTimerRef.current = setTimeout(() => {
      hydrationRetryTimerRef.current = null;
      // Une génération plus récente a repris la main : ce réessai est obsolète.
      if (queueHydrationGenerationRef.current !== generation) return;
      void loadQueueRef.current?.();
    }, SYNC_FAILURE_RETRY_DELAY_MS);
  }, []);

  /**
   * Rappelle `loadQueue` pour reprendre une purge, sans partager le timer de
   * l'hydratation : celle-ci l'annule dès qu'elle réussit.
   */
  const schedulePurgeResumeRetry = useCallback((generation: number) => {
    if (purgeResumeRetryTimerRef.current) clearTimeout(purgeResumeRetryTimerRef.current);
    purgeResumeRetryTimerRef.current = setTimeout(() => {
      purgeResumeRetryTimerRef.current = null;
      if (queueHydrationGenerationRef.current !== generation) return;
      void loadQueueRef.current?.();
    }, SYNC_FAILURE_RETRY_DELAY_MS);
  }, []);

  const loadQueue = useCallback(async () => {
    const hydrationStartedAt = Date.now();
    const myHydrationGeneration = ++queueHydrationGenerationRef.current;
    // Les identités locales n'ont de valeur que persistées : tant que ce
    // drapeau est faux, aucune passe réseau ne doit démarrer.
    let identitiesAreDurable = false;
    // Une hydratation obsolète ne doit écrire sous aucune clef, ni toucher le
    // cache du compte qui a pris la main.
    const assertHydrationOwner = () => {
      if (queueHydrationGenerationRef.current !== myHydrationGeneration) {
        throw new Error('Hydratation obsolete.');
      }
    };
    // Contenu EXACT deja present sous la clef que l'on ecrira. Une file relue
    // telle quelle est deja durable : exiger une reecriture ferait dependre son
    // utilisation d'un `setItem` qui n'a rien a ecrire.
    let persistedSnapshot: string | null = null;
    // Clef anonyme a vider APRÈS que la file utilisateur soit durable. Tant que
    // l'écriture définitive n'a pas abouti, la copie anonyme reste la seule
    // trace de ces saisies : mieux vaut un doublon temporaire qu'une perte.
    let anonQueueToClear: string | null = null;
    let nextHistoricalVisitRecovery = emptyHistoricalVisitRecoveryAudit();
    let historicalEvaluationRequired = false;
    let authorizedDismissalCount = 0;
    setQueueLoaded(false);
    queueLoadedRef.current = false;
    setHistoricalVisitRecovery(nextHistoricalVisitRecovery);
    const userKey = userId ? OFFLINE_QUEUE_PREFIX + userId : null;
    const anonKey = OFFLINE_QUEUE_PREFIX + 'anon';
    try {
      let merged: QueuedOperation[] = [];
      const seen = new Set<string>();

      // Read user-scoped queue if available
      if (userKey) {
        try {
          const rawUser = await AsyncStorage.getItem(userKey);
          persistedSnapshot = rawUser;
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
              // La fusion reste EN MÉMOIRE. L'écriture définitive — identités
              // locales comprises — a lieu plus bas, par la chaîne : écrire ici
              // puis vider la clé anonyme hors chaîne pouvait laisser la
              // suppression se terminer après une écriture concurrente.
              anonQueueToClear = anonKey;
              console.warn(`[NetworkContext] migrated ${parsedAnon.length} anon queue items to ${userKey}`);
            }
          }
        } catch {}
      } else {
        // No user yet — read anon-only queue (rare; usually we just wait for user.id)
        try {
          const rawAnon = await AsyncStorage.getItem(anonKey);
          persistedSnapshot = rawAnon;
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
      const authorizedDismissal = dismissAuthorizedTerminalQueueEntries(coalesced);
      authorizedDismissalCount = authorizedDismissal.dismissed.length;
      if (authorizedDismissalCount > 0) {
        await backupQueue(authorizedDismissal.dismissed, 'user-authorized-terminal-dismissal');
        assertHydrationOwner();
        console.warn(
          `[queue] ${authorizedDismissalCount} opération(s) terminale(s) supprimée(s) avec autorisation explicite`,
        );
      }

      const eligibleQueue = authorizedDismissal.kept;
      historicalEvaluationRequired = queueNeedsHistoricalVisitRecoveryEvaluation(eligibleQueue);
      let repairedQueue = eligibleQueue;
      if (userId && historicalEvaluationRequired) {
        const [cachedVisits, cachedReserves] = await Promise.all([
          readCache<Visite>(VISITES_CACHE_KEY, userId),
          readCache<Reserve>(RESERVES_CACHE_KEY, userId),
        ]);
        assertHydrationOwner();
        const recovery = planHistoricalVisitRecovery({
          queue: eligibleQueue,
          cachedVisits: cachedVisits ?? [],
          cachedReserves: cachedReserves ?? [],
          organizationId: userOrganizationId,
          userName: recoveryUserName,
          recoveryTitle: i18n.t('networkQueue.recoveredVisitTitle'),
          recoveryNotes: i18n.t('networkQueue.recoveredVisitNotes'),
        });
        nextHistoricalVisitRecovery = summarizeHistoricalVisitRecovery(
          recovery,
          Boolean(userOrganizationId),
        );
        if (recovery.repairs.length > 0) {
          const preparedRecoveryQueue = prepareRecoveredVisitQueue(
            eligibleQueue,
            recovery.repairs,
          );
          const recoveryOperations: QueuedOperation[] = recovery.repairs
            .filter(repair => !repair.reuseQueuedParent)
            .map(repair => ({
              id: genQueueId(),
              dispatchState: 'never_started',
              queuedAt: new Date().toISOString(),
              table: 'visites',
              op: 'insert',
              data: repair.payload,
              recoveryIntent: HISTORICAL_VISIT_RECOVERY_INTENT,
              recoveryDependencyKeys: repair.dependencyKeys,
            }));
          repairedQueue = [...preparedRecoveryQueue, ...recoveryOperations];
          console.warn(
            `[queue] visites historiques reconstruites : ${recovery.repairs.map(repair => `${repair.visitId}:${repair.source}`).join(', ')}`,
          );
        }
        if (recovery.skipped.length > 0) {
          console.warn(
            `[queue] reconstruction visite refusée : ${recovery.skipped.map(item => `${item.visitId}:${item.reason}`).join(', ')}`,
          );
        }
      }
      // L'organisation peut arriver pendant les lectures de cache ci-dessus.
      // Une hydratation partie sous le scope incomplet ne doit jamais publier
      // par-dessus celle que le nouvel effet vient de lancer.
      assertHydrationOwner();
      // Identité locale garantie AVANT le premier appel réseau : une opération
      // préparée pendant une passe doit pouvoir être retrouvée exactement, et
      // une file persistée avant l'existence du champ n'en porte aucune.
      const identified = ensureQueueEntryIdentities(repairedQueue, genQueueId);
      if (identified.assigned > 0 || identified.repaired > 0) {
        console.warn(
          `[queue] identités locales : ${identified.assigned} attribuée(s), ${identified.repaired} réparée(s)`,
        );
      }
      queueRef.current = identified.operations;
      setQueue(identified.operations);
      // Écriture STRICTE : une identité locale présente seulement en mémoire ne
      // survivrait pas au redémarrage, et une préparation faite pendant la
      // passe deviendrait introuvable. Si elle échoue, l'exception ci-dessous
      // empêche `queueLoaded` de passer à vrai — donc aucune passe réseau.
      //
      // Sauf si le disque porte DÉJÀ exactement ce contenu : rien à rendre
      // durable, et une panne de `setItem` ne doit alors bloquer ni la lecture
      // ni la synchronisation.
      const serialized = JSON.stringify(identified.operations);
      // Une file ABSENTE et vide n'a rien à rendre durable : exiger un
      // `setItem` ferait dépendre le démarrage d'une écriture qui n'écrit rien.
      const nothingToPersist = persistedSnapshot === null && identified.operations.length === 0;
      if (!nothingToPersist && serialized !== persistedSnapshot) {
        await writeQueueStrict(identified.operations);
      }
      assertHydrationOwner();
      // Ne publier l'audit qu'avec la file qu'il decrit, apres sa durabilite.
      // Un plan non ecrit ne doit jamais etre annonce au support comme actif.
      setHistoricalVisitRecovery(nextHistoricalVisitRecovery);

      // Seulement MAINTENANT : la file utilisateur porte ces opérations de
      // façon durable, la copie anonyme peut être vidée. Par la chaîne, et sans
      // supprimer la clef — `[]` est une file vide parfaitement valide.
      if (anonQueueToClear) {
        await queueWriteChain.writeBestEffort(anonQueueToClear, JSON.stringify([]));
      }
      // Une purge interrompue reprend AVANT toute passe : ses entrées sont
      // déjà non rejouables, mais leur effet local n'a pas encore été annulé.
      // La réconciliation est idempotente, donc rejouable sans risque.
      try {
        const resumed = await resumePendingQueuePurge<QueuedOperation>({
          readCurrent: () => queueRef.current,
          isPending: operation => operation.purgeState === PURGE_PENDING_RECONCILIATION,
          entryIdOf: operation => operation.queueEntryId ?? null,
          persist: compute => publishAfterDurableWrite<QueuedOperation>({
            readCurrent: () => queueRef.current,
            compute,
            write: next => writeQueueStrict(next),
            publish: next => {
              queueRef.current = next;
              setQueue(next);
            },
            assertCurrent: assertHydrationOwner,
          }),
          reconcile: async operation => {
            // La reprise ne doit pas réparer le cache d'un compte qui n'est
            // plus le nôtre.
            assertHydrationOwner();
            await reconcilePurgedOperationRef.current(operation);
            assertHydrationOwner();
          },
        });
        if (resumed.length > 0) {
          console.warn(`[queue] purge interrompue reprise : ${resumed.length} opération(s)`);
        }
      } catch (error) {
        // L'entrée reste en attente : reprenable, jamais supprimée sans
        // réparation. On replanifie DANS la session — attendre le prochain
        // démarrage laisserait l'entrée bloquée indéfiniment.
        console.warn(
          '[queue] reprise de purge impossible :',
          error instanceof Error ? error.message : String(error),
        );
        schedulePurgeResumeRetry(myHydrationGeneration);
      }

      lastLoadedKeyRef.current = userKey ?? anonKey;
      lastLoadedScopeRef.current = queueHydrationScopeKey(
        userKey ?? anonKey,
        userId ? userOrganizationId : null,
        queueNeedsHistoricalVisitRecoveryEvaluation(queueRef.current),
      );
      identitiesAreDurable = true;
      if (hydrationRetryTimerRef.current) {
        clearTimeout(hydrationRetryTimerRef.current);
        hydrationRetryTimerRef.current = null;
      }
      // INCONDITIONNEL. La version précédente ne remettait `idle` que si un
      // timer était encore armé — or le vrai réessai met la référence à `null`
      // AVANT de rappeler `loadQueue`. La branche ne s'exécutait donc jamais
      // dans le chemin qu'elle prétendait couvrir, et l'état `error` de l'échec
      // précédent restait affiché sur une file vide.
      setSyncStatus('idle');
    } catch (error) {
      // Conserver les opérations éventuellement créées pendant l'hydratation.
      if (queueHydrationGenerationRef.current === myHydrationGeneration) {
        setQueue([...queueRef.current]);
      }
      console.warn(
        '[queue] hydratation incomplète :',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (queueHydrationGenerationRef.current === myHydrationGeneration) {
        // La file n'est déclarée prête QUE si les identités locales ont atteint
        // le disque. Sinon une préparation faite pendant la passe serait
        // introuvable au redémarrage, et la même écriture métier repartirait.
        // On replanifie plutôt que de synchroniser sur une identité volatile.
        queueLoadedRef.current = identitiesAreDurable;
        setQueueLoaded(identitiesAreDurable);
        if (!identitiesAreDurable) {
          setSyncStatus('error');
          scheduleHydrationRetry(myHydrationGeneration);
        } else if (hasReplayableQueuedOperations(queueRef.current)) {
          scheduleSync();
        }
        console.log(
          `[perf] queue hydrated in ${Date.now() - hydrationStartedAt}ms `
          + `(entries=${queueRef.current.length}, historical=${historicalEvaluationRequired ? 'yes' : 'no'}, `
          + `dismissed=${authorizedDismissalCount})`,
        );
      }
    }
  }, [
    userId, userOrganizationId, recoveryUserName, backupQueue, writeQueueStrict,
    scheduleSync, scheduleHydrationRetry, schedulePurgeResumeRetry,
  ]);

  // `loadQueue` se rappelle lui-même après un échec de migration : la référence
  // évite une dépendance circulaire entre les deux `useCallback`.
  loadQueueRef.current = loadQueue;

  // ── Hydrate queue when user.id changes (cold start, login, switch) ─────────
  useEffect(() => {
    // During cold-start authentication, `user` is transiently null while the
    // cached profile/session is restored. Hydrating the anonymous outbox in
    // that window publishes queueLoaded=true, then the real user hydration
    // publishes it again a few milliseconds later. Every transition refetches
    // all active queries, which doubled the visible data-loading delay on the
    // physical Android device. A genuinely signed-out state still hydrates the
    // anonymous outbox as soon as AuthContext finishes loading.
    if (!userId && isAuthLoading) return;

    const targetKey = userId ? OFFLINE_QUEUE_PREFIX + userId : OFFLINE_QUEUE_PREFIX + 'anon';
    const targetScope = queueHydrationScopeKey(
      targetKey,
      userId ? userOrganizationId : null,
      queueNeedsHistoricalVisitRecoveryEvaluation(queueRef.current),
    );
    if (lastLoadedScopeRef.current === targetScope) return;
    // Une passe lancée pour le compte précédent ne doit jamais repeupler l'état
    // React du compte suivant lorsqu'un upload réseau se termine en retard.
    syncGenerationRef.current += 1;
    // Un transfert lancé pour le compte précédent ne doit pas survivre au
    // changement d'utilisateur.
    abortCurrentPass('changement de compte');
    syncingRef.current = false;
    queueHydrationGenerationRef.current += 1;
    // Un réessai programmé pour le compte précédent ne doit pas réveiller
    // l'hydratation du suivant.
    if (hydrationRetryTimerRef.current) {
      clearTimeout(hydrationRetryTimerRef.current);
      hydrationRetryTimerRef.current = null;
    }
    if (purgeResumeRetryTimerRef.current) {
      clearTimeout(purgeResumeRetryTimerRef.current);
      purgeResumeRetryTimerRef.current = null;
    }
    queueLoadedRef.current = false;
    setQueueLoaded(false);
    queueRef.current = [];
    setQueue([]);
    void loadQueue();
  }, [userId, userOrganizationId, isAuthLoading, loadQueue]);

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

  // AppProvider owns cold-start server freshness once queueLoaded becomes true:
  // it refreshes the six startup-critical keys first with cancelRefetch=false,
  // then defers the remaining active queries. A second global refetch here used
  // to cancel/restart those requests and doubled production startup traffic.
  // NetworkContext still refetches after real queue processing, reconnection,
  // foreground wake-up and explicit terminal-operation acknowledgement.

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
        const reading = await checkAppOnline(current);
        const online = reading.online;
        setIsOnline(online);
        setBackendReachable(reading.backendReachable);

        // Même filet que le natif ci-dessous. Sans lui, la branche web ne
        // déclenchait AUCUNE passe : une relance perdue pendant une coupure
        // (le kick est ignoré quand isOnline est faux) laissait la file figée
        // jusqu'au rechargement de la page.
        if (
          online &&
          isSupabaseConfigured &&
          hasReplayableQueuedOperations(queueRef.current) &&
          Date.now() - lastSyncAttemptRef.current > 20_000
        ) {
          processSyncQueueRef.current();
        }
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
      const reading = await checkAppOnline();
      setBackendReachable(reading.backendReachable);
      const online = applyOnlineReading(reading.online);

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
      const wakeReading = await checkAppOnline();
      setBackendReachable(wakeReading.backendReachable);
      const online = applyOnlineReading(wakeReading.online);

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
      // La passe gelée l'est presque toujours sur un transfert : le couper est
      // la seule façon de libérer vraiment le lien pour la nouvelle passe.
      abortCurrentPass('préemption passe gelée');
    }

    const myGeneration = ++syncGenerationRef.current;
    const isCurrentGeneration = () => syncGenerationRef.current === myGeneration;
    const passAbort = new AbortController();
    passAbortRef.current = passAbort;
    const passSignal = passAbort.signal;
    syncingRef.current = true;
    syncProgressAtRef.current = Date.now();
    lastSyncAttemptRef.current = Date.now();
    setLastSyncAttemptAt(new Date().toISOString());
    setNextSyncAttemptAt(null);
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
    // Rejets définitifs détectés pendant la passe : la réconciliation de cache
    // est asynchrone alors que `fail` est synchrone, on la rejoue après boucle.
    const terminalReconciliations: { op: QueuedOperation; outcome: SyncQueueTerminalOutcome }[] = [];
    const appliedHistoricalVisitRecoveries: {
      visitId: string;
      dependencyKeys: string[];
    }[] = [];
    let circuitOpened = false;
    let circuitDelayMs = 0;
    // Portee globale rendue par la politique P5. Un 429, ou un 503 porteur d'un
    // `Retry-After`, arrete toute la passe SANS alimenter une deuxieme fois le
    // compteur exponentiel : le blocage est deja porte par `blocksCurrentPass`.
    // Tant que les 37 sorties ne sont pas converties en `return`, la valeur
    // rendue par `fail()` est ignoree par la boucle — ce drapeau est le pont.
    let passMustStop = false;
    // Échecs d'infrastructure d'affilée. Remis à zéro par chaque opération qui
    // aboutit : sur un lien instable, un timeout isolé ne dit rien de la
    // suivante, et abandonner la passe trop tôt gelait toute la file.
    let consecutiveInfraFailures = 0;
    // Barrière de persistance : aucune requête ne part sans qu'une trace
    // durable n'existe déjà sur le disque. La séquence — rien de publié avant
    // l'écriture, recalcul si la file bouge, refus si la passe est obsolète —
    // vit dans `lib/queueDispatchPreparation.ts`, où elle est prouvée avec des
    // promesses contrôlées.
    let prepared: PreparedQueueForDispatch<QueuedOperation>;
    try {
      prepared = await prepareQueueForDispatch<QueuedOperation>({
        readCurrent: () => queueRef.current,
        needsProof: operation => (
          isReplayableQueuedOperation(operation) && operation.dispatchState !== 'started'
        ),
        markStarted: operation => ({ ...operation, dispatchState: 'started' as const }),
        writeStrict: next => writeQueueStrict(next),
        publish: next => {
          queueRef.current = next;
          setQueue(next);
        },
        assertCurrent: () => {
          if (!isCurrentGeneration()) throw new Error('Passe de synchronisation obsolete.');
        },
      });
    } catch (error) {
      // Si la preuve n'atteint pas le disque, AUCUNE requête ne part : une
      // écriture envoyée sans elle ne laisserait aucune trace exploitable après
      // un plantage — ni pour la rejouer, ni pour réconcilier son effet local.
      console.warn(
        "[queue] passe annulée : état d'envoi non persistable —",
        error instanceof Error ? error.message : String(error),
      );
      syncingRef.current = false;
      setSyncStatus('error');
      scheduleSync(SYNC_FAILURE_RETRY_DELAY_MS);
      return;
    }

    // Snapshot de travail : EXACTEMENT la file dont la barrière vient d'établir
    // la durabilité, jamais une relecture de `queueRef.current`.
    //
    // Relire ici rouvrait la fenêtre que la barrière ferme : entre son retour et
    // cette lecture, `enqueueOperation` peut publier une entrée `unknown` en
    // mémoire — sa sauvegarde n'étant que best-effort et non attendue. Elle
    // serait alors partie vers le serveur sans qu'aucune écriture stricte ne
    // l'ait précédée.
    //
    // Une entrée arrivée après la barrière reste dans `queueRef`, y est
    // conservée comme ajout concurrent en fin de passe, et franchit la barrière
    // à la passe suivante.
    const currentQueue = prepared.operations.filter(isReplayableQueuedOperation).sort((a, b) => {
      const priorityDiff = queueReplayPriority(a) - queueReplayPriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.queuedAt ?? '').localeCompare(b.queuedAt ?? '');
    });
    setSyncProgress({ done: 0, total: currentQueue.length });

    // Helper: re-queue an op while attaching the latest error message and
    // bumping its attempt counter so the user can see in the UI why it stays
    // stuck after each retry.
    /**
     * Enregistre un echec et rend son verdict.
     *
     * La decision « rejouable, definitif, ou passe abandonnee » est deleguee a
     * `classifyFailureOutcome`, module pur et teste. Elle vivait auparavant
     * dans cette fermeture, melangee aux effets de bord, et aucune des 37
     * sorties de la boucle ne pouvait etre verifiee.
     */
    const fail = (
      op: QueuedOperation,
      err: any,
      options?: {
        terminalStatus?: string;
        terminalOutcome?: SyncQueueTerminalOutcome;
        meta?: SupabaseRestMeta;
        /**
         * Le serveur a déjà rendu un verdict PLUS TÔT dans cette même
         * opération — cas du rebase, appelé seulement après un premier
         * `version_conflict`. La série de pannes consécutives est donc déjà
         * rompue : cet échec-ci en démarre une nouvelle.
         */
        serverAnsweredEarlier?: boolean;
      },
    ): QueuedOperationOutcome => {
      const verdict = classifyFailureOutcome({
        operation: op,
        error: err,
        meta: options?.meta,
        terminalStatus: options?.terminalStatus,
        terminalOutcome: options?.terminalOutcome,
        nowMs: Date.now(),
        consecutiveServiceFailures: options?.serverAnsweredEarlier ? 0 : consecutiveInfraFailures,
        circuitAlreadyOpen: circuitOpened,
      });
      console.warn(`[queue] ${op.op} ${op.table} failed:`, verdict.message);

      let resolvedOutcome = options?.terminalOutcome;
      if (verdict.inferredTerminal && verdict.terminalStatus && isInventoryQueuedOperation(op)) {
        // Le stock optimiste doit etre annule comme pour tout refus metier :
        // le mouvement n'a jamais atteint le serveur.
        resolvedOutcome = normalizeInventoryMovementOutcome(
          { status: verdict.terminalStatus, message: verdict.message },
          inventoryOutcomeContextFromQueuedOperation(op),
        );
        terminalReconciliations.push({ op, outcome: resolvedOutcome });
      }

      // Une annulation volontaire n'est pas un echec. Le classificateur ne lui
      // consomme aucune tentative ; ecrire malgre tout `lastError` et
      // `lastFailureAt` la ferait apparaitre dans le diagnostic comme le
      // dernier echec de l'operation. Si aucune tentative n'a ete consommee,
      // aucune metadonnee d'echec n'est ecrite.
      const failedOperation: QueuedOperation = verdict.incrementAttempt
        ? {
          ...op,
          lastError: verdict.message,
          attemptCount: verdict.attemptCount,
          lastFailureFingerprint: verdict.fingerprint ?? undefined,
          sameFailureCount: verdict.sameFailureCount,
          // Metadonnees P5 : persistees des maintenant, exploitees par la passe
          // dynamique au commit suivant.
          lastFailureAt: new Date().toISOString(),
          nextAttemptAt: verdict.nextAttemptAt ?? undefined,
          failureClass: verdict.failureClass,
          retrySource: verdict.retrySource ?? undefined,
          lastHttpStatus: verdict.lastHttpStatus ?? undefined,
          retryPolicyVersion: 1,
          terminal: verdict.isTerminal,
          terminalStatus: verdict.terminalStatus ?? op.terminalStatus,
          terminalOutcome: resolvedOutcome ?? op.terminalOutcome,
        }
        : { ...op };
      failedOps.push(failedOperation);

      // La preuve serveur casse les DEUX dimensions. Ne remettre à zéro que la
      // série consécutive laissait le palier exponentiel intact : après un
      // historique de 4, un `version_conflict` reçu, puis trois `503`, le
      // circuit repartait du palier 5 — rattaché à une panne que le verdict
      // intermédiaire venait pourtant de casser.
      if (options?.serverAnsweredEarlier) {
        syncInfrastructureFailureCountRef.current = 0;
      }

      if (verdict.opensAuthCircuit) {
        circuitOpened = true;
        circuitDelayMs = SYNC_AUTH_RETRY_DELAY_MS;
        syncBackoffUntilRef.current = Date.now() + circuitDelayMs;
        setSyncAuthBlocked(isSessionExpired());
      } else if (verdict.opensServiceCircuit) {
        circuitOpened = true;
        const failures = syncInfrastructureFailureCountRef.current + 1;
        syncInfrastructureFailureCountRef.current = failures;
        const exponential = Math.min(
          SYNC_INFRA_BACKOFF_MAX_MS,
          SYNC_INFRA_BACKOFF_BASE_MS * (2 ** Math.min(failures - 1, 4)),
        );
        circuitDelayMs = Math.round(exponential * (0.8 + Math.random() * 0.4));
        syncBackoffUntilRef.current = Date.now() + circuitDelayMs;
      } else if (verdict.serviceFailureStreak === 0 && verdict.reachedServer) {
        // Refus rendu PAR le serveur : le lien fonctionne, la serie est rompue.
        syncInfrastructureFailureCountRef.current = 0;
      }

      // La série n'est plus mutée ici : `fail()` la rend, la boucle la plie
      // avec les issues non-échec via `nextServiceFailureStreak`. Un seul
      // endroit décide, et il est pur.
      const streak = verdict.serviceFailureStreak;

      if (verdict.kind === 'abandon') {
        passMustStop = true;
        if (!circuitOpened && verdict.abandonReason === 'backend') {
          // `circuitOpened` pilote la programmation d'apres-passe : sans lui,
          // le bloc final remet `syncBackoffUntilRef` a zero et relance dans
          // 30 s, ignorant l'echeance imposee par le serveur. On ouvre donc le
          // disjoncteur SANS incrementer `syncInfrastructureFailureCountRef` :
          // la portee backend ne doit pas etre comptabilisee deux fois.
          const deadlineMs = verdict.nextAttemptAt
            ? Date.parse(verdict.nextAttemptAt)
            : Number.NaN;
          circuitDelayMs = Number.isFinite(deadlineMs)
            ? Math.max(0, deadlineMs - Date.now())
            : SYNC_FAILURE_RETRY_DELAY_MS;
          circuitOpened = true;
          syncBackoffUntilRef.current = Date.now() + circuitDelayMs;
        }
        // Une preemption arrete la passe sans creer de backoff artificiel :
        // la generation suivante possede deja la file.
        return {
          kind: 'abandon',
          operation: failedOperation,
          reason: verdict.abandonReason ?? 'backend',
          nextAttemptAt: verdict.nextAttemptAt,
          serviceFailureStreak: streak,
        };
      }
      if (verdict.kind === 'terminal') {
        return { kind: 'terminal', operation: failedOperation, serviceFailureStreak: streak };
      }
      return {
        kind: 'deferred',
        operation: failedOperation,
        nextAttemptAt: verdict.nextAttemptAt,
        serviceFailureStreak: streak,
      };
    };

    /**
     * Refus DÉFINITIF établi localement, sans le moindre appel réseau.
     *
     * Deux problèmes distincts sont réglés ici. D'abord la persistance : une
     * issue `terminal` rendue sans passer par `fail()` n'atterrissait ni dans
     * `pendingConflicts` ni dans `failedOps`, et la reconstruction de la file
     * la faisait donc disparaître au lieu de la conserver comme refusée et
     * visible dans le diagnostic. Ensuite la promesse de réessai : ces
     * opérations rendaient une erreur en texte brut, que la politique range en
     * `unknown` — l'opération était différée indéfiniment alors qu'aucun
     * changement de réseau ne peut reconstruire un payload absent.
     *
     * Aucun rollback de stock n'est déclenché : seul un `terminalOutcome`
     * métier explicite, rendu PAR le serveur, autorise à annuler une écriture
     * optimiste. Ici le serveur n'a jamais été joint.
     */
    const terminalLocalOperation = (
      operation: QueuedOperation,
      terminalStatus: string,
      message: string,
      options?: { provesServerReachable?: boolean },
    ): QueuedOperationOutcome => {
      const safeMessage = redactSensitiveText(message).slice(0, 500);

      // « Aucun rollback sur un refus local » était trop général. Une erreur
      // réseau est AMBIGUË — la requête a peut-être abouti, sa réponse s'est
      // perdue — et là il ne faut rien annuler. Une validation locale, elle,
      // prouve qu'aucune requête n'a été émise : le serveur ne peut pas avoir
      // appliqué l'écriture, et laisser le stock optimiste en place décale
      // durablement le cache.
      const terminalOutcome = isInventoryMovementOperation(operation)
        ? normalizeInventoryMovementOutcome(
          { status: 'invalid_payload', message: safeMessage },
          inventoryOutcomeContextFromQueuedOperation(operation),
        )
        : null;

      const terminalOperation: QueuedOperation = {
        ...operation,
        terminal: true,
        terminalStatus,
        terminalOutcome: terminalOutcome ?? operation.terminalOutcome,
        lastError: safeMessage,
        lastFailureAt: new Date().toISOString(),
        // Le refus local REMPLACE l'historique d'échec. Conserver l'ancien
        // afficherait « refusée localement » à côté d'un « HTTP 503 » périmé,
        // et la regrouperait sous le mauvais alias dans le diagnostic.
        failureClass: undefined,
        lastHttpStatus: undefined,
        lastFailureFingerprint: undefined,
        sameFailureCount: 0,
        // Une opération refusée n'a aucune prochaine tentative.
        nextAttemptAt: undefined,
        retrySource: undefined,
        retryPolicyVersion: 1,
      };

      if (terminalOutcome) {
        terminalReconciliations.push({ op: terminalOperation, outcome: terminalOutcome });
      }
      // Pont legacy : la reconstruction lit encore `failedOps`. Cette poussée
      // disparaît quand `runSyncPass` consommera les issues.
      failedOps.push(terminalOperation);
      return {
        kind: 'terminal',
        operation: terminalOperation,
        provesServerReachable: options?.provesServerReachable,
      };
    };

    /**
     * Rend l'identité préparée durable AVANT que l'écriture ne parte.
     *
     * Sans elle : le serveur applique le patch sous le nouvel identifiant, la
     * réponse se perd ou la passe est préemptée avant persistance, et la
     * génération suivante repart de l'ancien — elle génère une troisième
     * identité et rejoue la MÊME écriture métier. Un mouvement de stock compté
     * deux fois. Le signal ne fait que réduire cette fenêtre : le serveur peut
     * committer avant que l'annulation soit observée.
     *
     * La localisation se fait par `queueEntryId`, jamais par `id` — que le
     * rebase est précisément en train de remplacer — ni par contenu.
     */
    const persistPreparedRebase = async (prepared: PreparedRebaseWrite): Promise<void> => {
      // Même invariant que la purge manuelle : rien n'est publié tant que
      // l'écriture n'a pas abouti, et une saisie apparue pendant l'écriture
      // fait recalculer sur la file la plus récente.
      await publishAfterDurableWrite<QueuedOperation>({
        readCurrent: () => queueRef.current,
        compute: current => {
          const targets = current
            .map((entry, index) => (entry.queueEntryId === prepared.queueEntryId ? index : -1))
            .filter(index => index >= 0);

          if (targets.length !== 1) {
            // Échec FERMÉ : sans entrée cible unique, la préparation ne serait
            // pas retrouvable après une préemption, et l'écriture ne doit pas
            // partir.
            throw new Error(
              `Preparation de rebase impossible : ${targets.length} entree(s) pour cette identite locale.`,
            );
          }

          return current.map((entry, index) => (
            index === targets[0]
              ? { ...entry, id: prepared.operationId, baseVersion: prepared.baseVersion }
              : entry
          ));
        },
        write: next => writeQueueStrict(next),
        publish: next => {
          queueRef.current = next;
          setQueue(next);
        },
      });
    };

    let processed = 0;
    /** Entrées physiques déjà traitées par cette passe. */
    const processedEntryIds = new Set<string>();

    /**
     * Exécute UNE opération et rend son issue.
     *
     * Chaque sortie est désormais explicite. Avant cette extraction, trente-sept
     * `continue` quittaient la boucle sans dire ce qui venait de se passer :
     * « échec différé », « refus définitif », « succès » et « ligne déjà
     * absente » étaient une seule et même instruction. Le succès se déduisait
     * a posteriori de `failedOps.length`, une heuristique incapable de
     * distinguer « le serveur n'a pas répondu » de « le serveur a dit non ».
     *
     * `runSyncPass` n'est pas encore branché : la reconstruction de la file lit
     * toujours `failedOps`, que `fail()` continue d'alimenter. Cette conversion
     * ne change donc que le flot de contrôle — c'est délibéré.
     */
    const executeQueuedOperation = async (
      op: QueuedOperation,
    ): Promise<QueuedOperationOutcome> => {
      let retryOpForCatch: QueuedOperation = op;
      try {
        // ── Status-change conflict detection ───────────────────────────────
        if (op.op === 'rpc') {
          if (!op.rpc?.fn) {
            return syncExit('E01', terminalLocalOperation(op, 'invalid_local_operation', i18n.t('networkQueue.missingRpc')));
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
              return syncExit('E02', terminalLocalOperation(op, 'invalid_local_operation', i18n.t('networkQueue.createReserveMissingPayload')));
            }
            if (rawReserve.deadline === 'â€”' || rawReserve.deadline === '') {
              rawReserve.deadline = null;
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('reserves', rawReserve, {
                signal: passSignal,
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
              return syncExit('E03', fail(partialRetryOp, prep.uploadErrors?.join(' | ') || i18n.t('networkQueue.uploadReservePhotosFailed')));
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
              return syncExit('E04', fail(op, terminalOutcome.message, { terminalOutcome }));
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('inventory_products', rawProduct, { signal: passSignal }),
              uploadStepTimeoutMs(rawProduct),
            );
            if (!prep.allOk) {
              return syncExit('E05', fail(op, prep.uploadErrors?.join(' | ') || 'Échec upload de la photo produit.'));
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
              return syncExit('E06', fail(op, terminalOutcome.message, { terminalOutcome }));
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('inventory_products', rawPatch, { signal: passSignal }),
              uploadStepTimeoutMs(rawPatch),
            );
            if (!prep.allOk) {
              return syncExit('E07', fail(op, prep.uploadErrors?.join(' | ') || 'Échec upload de la photo produit.'));
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
              return syncExit('E08', terminalLocalOperation(op, 'invalid_local_operation', 'RPC create_site_plan_revision_with_reserve_migration refusee: plan parent ou nouvelle revision manquant.'));
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('site_plans', rawPlan, { signal: passSignal }),
              UPLOAD_STEP_TIMEOUT_MS,
            );
            if (!prep.allOk) {
              return syncExit('E09', fail(op, prep.uploadErrors?.join(' | ') || 'Echec upload fichier plan avant creation revision controlee.'));
            }
            const preparedPlan = prep.data ?? rawPlan;
            args = { ...args, p_new_plan: preparedPlan };
            retryRpcOp = { ...op, data: preparedPlan, rpc: { ...op.rpc, args } };
          } else if (op.rpc.fn === 'replace_site_plan_file_safely') {
            const rawPatch = (args.p_patch ?? op.data) as Record<string, any> | undefined;
            if (!args.p_plan_id || !rawPatch) {
              return syncExit('E10', terminalLocalOperation(op, 'invalid_local_operation', i18n.t('networkQueue.replacePlanMissingPatch')));
            }
            const prep = await withTimeoutMs(
              uploadLocalPhotosInPayload('site_plans', rawPatch),
              UPLOAD_STEP_TIMEOUT_MS,
            );
            if (!prep.allOk) {
              return syncExit('E11', fail(op, prep.uploadErrors?.join(' | ') || i18n.t('networkQueue.uploadPlanFileFailed')));
            }
            const preparedPatch = { ...(prep.data ?? rawPatch) };
            delete preparedPatch.__replace_file_safely;
            args = { ...args, p_patch: preparedPatch };
            retryRpcOp = { ...op, data: preparedPatch, rpc: { ...op.rpc, args } };
          } else if (op.rpc.fn === 'append_reserve_status_event') {
            const event = args.p_event ?? op.data;
            if (!event?.reserve_id || !event?.to_status) {
              return syncExit('E12', terminalLocalOperation(op, 'invalid_local_operation', i18n.t('networkQueue.reserveStatusEventMissing')));
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

          const { data: rpcData, error, meta: rpcMeta } = await supabaseRestRpc(op.rpc.fn, args);
          if (!error && op.rpc.fn === 'replace_site_plan_file_safely') {
            // The RPC protects the binary transition but deliberately touches
            // only file columns. Persist the latest coalesced full snapshot
            // afterwards so annotations and plan metadata cannot be dropped.
            const snapshotPatch = (args.p_patch ?? retryRpcOp.data) as Record<string, any> | undefined;
            const planId = args.p_plan_id;
            if (!snapshotPatch || !planId) {
              // Le RPC vient d'aboutir : le backend répond, la série de
              // pannes doit être rompue même si l'opération est refusée.
              return syncExit('E13', terminalLocalOperation(
                retryRpcOp,
                'invalid_local_operation',
                i18n.t('networkQueue.replacePlanMissingPatch'),
                { provesServerReachable: true },
              ));
            }
            const { error: metadataError, meta: metadataMeta } = await supabaseRestMutation(
              'site_plans',
              'update',
              snapshotPatch,
              { column: 'id', value: String(planId) },
            );
            if (metadataError) {
              return syncExit('E14', fail(retryRpcOp, metadataError, { meta: metadataMeta }));
            }
          }
          if (error && op.rpc.fn === 'append_reserve_status_event' && isReserveMutationRpcUnavailable(error)) {
            if (op.filter?.column === 'id' && op.data) {
              const { error: fallbackErr, meta: fallbackMeta } = await supabaseRestMutation(
                'reserves',
                'update',
                op.data,
                op.filter,
              );
              // Le repli a abouti : c'est un succès, même si le RPC a refusé.
              if (fallbackErr) return syncExit('E15', fail({ ...retryRpcOp, data: op.data }, fallbackErr, { meta: fallbackMeta }));
              return syncExit('E16', { kind: 'applied', operation: retryRpcOp });
            }
            return syncExit('E17', fail(retryRpcOp, error, { meta: rpcMeta }));
          }
          if (error) return syncExit('E18', fail(retryRpcOp, error, { meta: rpcMeta }));
          if (op.rpc.fn === 'append_reserve_status_event') {
            const outcome = firstReserveMutationResult(rpcData);
            if (outcome && outcome.status !== 'ok') {
              const terminal = ['deleted', 'forbidden', 'not_found', 'duplicate_operation_mismatch', 'invalid_payload'].includes(outcome.status);
              return syncExit('E19', fail(
                retryRpcOp,
                outcome.message ?? outcome.status,
                terminal ? { terminalStatus: outcome.status, meta: rpcMeta } : { meta: rpcMeta },
              ));
            }
            return syncExit('E20', { kind: 'applied', operation: retryRpcOp });
          }
          if (op.rpc.fn === 'create_reserve_with_photos' && args.p_reserve?.id) {
            const reserveId = String(args.p_reserve.id);
            await applySyncedReservePhotoPayloadToCache(userId, reserveId, retryRpcOp.data ?? args.p_reserve);
            await queryClient.invalidateQueries({ queryKey: queryKeys.photos(), refetchType: 'active' });
            triggerReserveCreatedPush(reserveId);
            return syncExit('E21', { kind: 'applied', operation: retryRpcOp });
          }
          if (op.rpc.fn === 'record_inventory_movement' || op.rpc.fn === 'update_inventory_product') {
            // Lecture STRICTE : une reponse sans verdict exploitable n'est ni un
            // succes ni un refus. La traiter comme un refus annulerait un
            // mouvement que le serveur a peut-etre enregistre.
            const parsed = parseInventoryMovementOutcome(
              rpcData,
              inventoryOutcomeContextFromQueuedOperation(retryRpcOp),
              op.rpc.fn,
            );
            if (!parsed.ok) {
              return syncExit('E22', fail(retryRpcOp, { code: parsed.error.code, message: parsed.error.message }, { meta: rpcMeta }));
            }
            const terminalOutcome = parsed.outcome;
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
              return syncExit('E23', fail(
                retryRpcOp,
                translationKey
                  ? i18n.t(translationKey as any, { defaultValue: fallbackMessage })
                  : fallbackMessage,
                { terminalOutcome, meta: rpcMeta },
              ));
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
            return syncExit('E24', { kind: 'applied', operation: retryRpcOp });
          }
          // Tout RPC dont aucune branche ci-dessus n'a pris la main a réussi :
          // le succès n'est plus implicite.
          return syncExit('E25', { kind: 'applied', operation: retryRpcOp });
        }

        if (op.conflictCheck) {
          const { entityId, previousStatus, newStatus, author, history, closedAt, closedBy } = op.conflictCheck;

          const { data: serverRows, error: fetchErr, meta: fetchMeta } = await supabaseRestSelect<any>(
            'reserves',
            'status,title',
            { column: 'id', value: entityId },
          );
          const serverData = serverRows?.[0] ?? null;

          if (fetchErr) return syncExit('E26', fail(op, fetchErr, { meta: fetchMeta }));
          // Réserve absente côté serveur : il n'y a plus rien à appliquer.
          if (!serverData) return syncExit('E27', { kind: 'applied', operation: op });

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
            // Rendu à la logique métier de résolution : ni différé, ni refusé.
            // Le SELECT a abouti : le lien fonctionne, la série est rompue.
            return syncExit('E28', { kind: 'conflict', operation: op, provesServerReachable: true });
          }

          const { error: applyErr, meta: applyMeta } = await supabaseRestMutation('reserves', 'update', {
            status: newStatus,
            history,
            closed_at: closedAt ?? null,
            closed_by: closedBy ?? null,
          }, { column: 'id', value: entityId });

          if (applyErr) return syncExit('E29', fail(op, applyErr, { meta: applyMeta }));
          return syncExit('E30', { kind: 'applied', operation: op });
        }

        // ── Comment patch (CRDT-lite merge by comment ID) ─────────────────
        // Replaces the old "store full comments array" approach.  Each comment
        // op carries only the delta (add/edit/delete a single comment). The
        // engine fetches the live server array and merges by ID so concurrent
        // writes from other devices are never silently overwritten.
        if (op.commentPatch && (op.table === 'tasks' || op.table === 'reserves') && op.filter?.column === 'id') {
          const rowId = op.filter.value;
          const patch  = op.commentPatch;

          const { data: taskRows, error: fetchErr, meta: fetchMeta } = await supabaseRestSelect<any>(
            op.table,
            'comments',
            { column: 'id', value: rowId },
          );
          const serverTask = taskRows?.[0] ?? null;

          if (fetchErr) return syncExit('E31', fail(op, fetchErr, { meta: fetchMeta }));

          // Row is gone — treat as success (nothing to patch)
          if (!serverTask) return syncExit('E32', { kind: 'applied', operation: op });

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
            // Patch malformé : abandonné définitivement, pas différé — le
            // rejouer produirait exactement le même verdict à chaque passe.
            // Sérialiser le patch versait dans les journaux le texte du
            // commentaire, un nom, ou toute autre donnée métier qu'il porte.
            // Seule sa FORME est utile au diagnostic.
            console.warn('[queue] commentPatch malformed', {
              action: patch?.action,
              hasComment: Boolean(patch?.comment),
              hasCommentId: Boolean(patch?.commentId),
            });
            // Le SELECT des commentaires a abouti juste avant : le lien marche.
            return syncExit('E33', terminalLocalOperation(
              op,
              'invalid_payload',
              'Patch de commentaire illisible.',
              { provesServerReachable: true },
            ));
          }

          const { error: writeErr, meta: writeMeta } = await supabaseRestMutation(
            op.table,
            'update',
            { comments: merged },
            { column: 'id', value: rowId },
          );

          if (writeErr) return syncExit('E34', fail(op, writeErr, { meta: writeMeta }));
          return syncExit('E35', { kind: 'applied', operation: op });
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
              // Le fichier local n'existe plus : rien ne sera jamais uploadé.
              return syncExit('E36', terminalLocalOperation(op, 'local_file_missing', 'Fichier photo introuvable sur cet appareil.'));
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
                return syncExit('E37', fail(retryData ? { ...op, data: retryData } : op, errDetail || 'Échec upload photo. Nouvelle tentative au prochain passage.'));
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
                    queueEntryId: genQueueId(),
                    // Les photos de ce patch n'ont PAS été envoyées : leur
                    // upload vient d'échouer, et la réserve part sans elles.
                    dispatchState: 'never_started' as const,
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
                return syncExit('E38', fail(op, errDetail || 'Échec upload de fichiers locaux (photos/plans). Nouvelle tentative au prochain passage.'));
              }
            }
          } catch (e) {
            return syncExit('E39', fail(op, e));
          }
        }
        retryOpForCatch = retryData ? { ...op, data: retryData } : op;

        // ── Reserve photo patch (merge by photo ID) ─────────────────────────
        // A photo-only retry must not write a stale `photos` snapshot. Fetch the
        // live gallery, merge/delete by photo ID, then write the merged result.
        if (op.photoPatch && op.table === 'reserves' && op.filter?.column === 'id') {
          const reserveId = op.filter.value;
          const { data: reserveRows, error: fetchErr, meta: fetchMeta } = await supabaseRestSelect<any>(
            'reserves',
            'photos,photo_uri',
            { column: 'id', value: reserveId },
          );
          if (fetchErr) return syncExit('E40', fail(op, fetchErr, { meta: fetchMeta }));

          const serverReserve = reserveRows?.[0] ?? null;
          // Réserve supprimée entre-temps : la galerie n'a plus de destinataire.
          if (!serverReserve) return syncExit('E41', { kind: 'applied', operation: op });

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
          const { error: writeErr, meta: writeMeta } = await supabaseRestMutation(
            'reserves',
            'update',
            nextPayload,
            { column: 'id', value: reserveId },
          );
          if (writeErr) return syncExit('E42', fail({ ...op, data: nextPayload }, writeErr, { meta: writeMeta }));
          return syncExit('E43', { kind: 'applied', operation: { ...op, data: nextPayload } });
        }

        // ── Generic table/op replay ────────────────────────────────────────
        // `meta` est optionnel : certaines issues sont fabriquees localement
        // (23505 requalifie en succes, rebase applique) et n'ont pas de reponse.
        let result: { error: any; data?: any[] | null; meta?: SupabaseRestMeta };

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
          if (result.error?.code === '23505') {
            const originalDuplicate = result;
            const entityId = data?.id;
            if (!entityId) {
              return syncExit('E44', fail(
                retryOpForCatch,
                { code: 'DUPLICATE_INSERT_UNVERIFIED', status: 409, message: `INSERT ${op.table} en conflit sans identifiant vérifiable.` },
                { terminalStatus: 'duplicate_insert_mismatch', meta: originalDuplicate.meta },
              ));
            }

            const existing = await supabaseRestSelect<Record<string, unknown>>(
              op.table,
              '*',
              { column: 'id', value: String(entityId) },
              1,
            );
            if (existing.error) {
              return syncExit('E45', fail(retryOpForCatch, existing.error, { meta: existing.meta }));
            }

            const duplicateMatches = op.recoveryIntent === HISTORICAL_VISIT_RECOVERY_INTENT
              ? recoveredVisitMatchesPersistedIdentity(data, existing.data?.[0])
              : queuedInsertMatchesPersistedRow(data, existing.data?.[0]);
            if (!duplicateMatches) {
              return syncExit('E46', fail(
                retryOpForCatch,
                {
                  code: 'DUPLICATE_INSERT_MISMATCH',
                  status: 409,
                  message: `Identifiant ${String(entityId)} déjà utilisé par une autre ligne ${op.table}; insertion non appliquée.`,
                },
                { terminalStatus: 'duplicate_insert_mismatch', meta: originalDuplicate.meta },
              ));
            }

            // Only a byte-for-business-field match proves an idempotent replay.
            result = { error: null, data: existing.data, meta: existing.meta };
          }
        } else if (op.op === 'upsert') {
          result = await supabaseRestMutation(op.table, 'upsert', data!);
        } else if (op.op === 'update') {
          if (!op.filter) {
            // Aucune tentative possible : rejouer sans filtre écraserait la table.
            return syncExit('E47', terminalLocalOperation(op, 'invalid_local_operation', `UPDATE ${op.table} refusé: filtre manquant.`));
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
              const rebase = await rebaseReservePatchOnConflict(
                {
                  reserveId: String(op.filter.value),
                  patch: data!,
                  conflict: outcome,
                  queueEntryId: op.queueEntryId ?? '',
                },
                {
                  selectVersion: (reserveId, signal) => supabaseRestSelect<any>(
                    'reserves',
                    'version',
                    { column: 'id', value: reserveId },
                    1,
                    { signal },
                  ),
                  applyPatch: (patchParams, signal) => applyReservePatchOperation(patchParams, { signal }),
                  newOperationId,
                  beforeApply: persistPreparedRebase,
                  // Les deux appels du rebase doivent être interruptibles, et
                  // aucun ne doit démarrer après une préemption : une écriture
                  // partie ensuite serait rejouée par la génération suivante.
                  signal: passSignal,
                },
              );
              if (rebase.kind === 'applied') {
                result = { error: null, data: [rebase.outcome] };
              } else if (rebase.kind === 'retry_transport') {
                // Le second appel a échoué au transport. Il doit suivre la
                // politique P5 comme n'importe quel autre échec : un 429 arrête
                // la passe avec l'échéance du serveur, un 503 alimente le
                // circuit, un 401 ouvre le circuit d'authentification. La
                // version rebasée est conservée pour que le réessai reparte
                // avec une identité neuve.
                const retryOperation: QueuedOperation = {
                  ...op,
                  // `null` signifie qu'aucune identite idempotente n'a été
                  // consommée — la lecture de version a échoué avant toute
                  // écriture, ou la passe a été préemptée.
                  id: rebase.operationId ?? op.id,
                  baseVersion: rebase.baseVersion ?? op.baseVersion,
                };
                return syncExit('E48', fail(retryOperation, rebase.error, {
                  meta: rebase.meta,
                  // Le rebase n'est atteint qu'APRÈS un premier
                  // `version_conflict` rendu par le serveur : la série de
                  // pannes est déjà rompue, celle-ci en démarre une nouvelle.
                  serverAnsweredEarlier: true,
                }));
              } else if (rebase.kind === 'retry_conflict') {
                // Le serveur a de nouveau tranché : écriture concurrente entre
                // le SELECT et l'apply. On repart avec une identité neuve,
                // sinon le serveur rejoue indéfiniment le conflit mémorisé.
                const rebasedOperation: QueuedOperation = {
                  ...op,
                  id: rebase.operationId,
                  baseVersion: rebase.baseVersion,
                  lastError: `version_conflict — rebasé sur v${rebase.baseVersion ?? '?'}, réessai au prochain passage`,
                  attemptCount: normalizeAttemptCount(op.attemptCount) + 1,
                };
                failedOps.push(rebasedOperation);
                return syncExit('E49', {
                  kind: 'deferred',
                  operation: rebasedOperation,
                  nextAttemptAt: null,
                  provesServerReachable: true,
                });
              } else {
                return syncExit('E50', fail(retryOpForCatch, rebase.message ?? rebase.status, {
                  terminalStatus: rebase.status,
                  meta: rebase.meta,
                }));
              }
            } else {
              const terminal = ['deleted', 'forbidden', 'not_found', 'duplicate_operation_mismatch', 'invalid_payload'].includes(outcome.status);
              return syncExit('E51', fail(
                retryOpForCatch,
                outcome.message ?? outcome.status,
                terminal
                  ? { terminalStatus: outcome.status, meta: rpcResult.meta }
                  : { meta: rpcResult.meta },
              ));
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
                // Ligne disparue côté serveur : la mise à jour n'a plus d'objet.
                if (!existsErr && !exists?.[0]) {
                  return syncExit('E52', { kind: 'applied', operation: retryOpForCatch });
                }
              } catch {}
            }
            return syncExit('E53', fail(retryOpForCatch, `UPDATE sur ${op.table} a affecté 0 ligne. Probablement bloqué par une policy RLS, ou l'élément ne vous appartient plus.`, { meta: result.meta }));
          }
        } else if (op.op === 'delete') {
          if (!op.filter) {
            // Sans filtre, un DELETE viderait la table : refus définitif.
            return syncExit('E54', terminalLocalOperation(op, 'invalid_local_operation', `DELETE ${op.table} refusé: filtre manquant.`));
          }
          const criticalDeleteRpc = CRITICAL_SOFT_DELETE_RPCS[op.table];
          if (criticalDeleteRpc && op.filter.column === 'id') {
            result = await supabaseRestRpc(criticalDeleteRpc.fn, {
              [criticalDeleteRpc.idArg]: op.filter.value,
              p_reason: op.data?.deleted_reason ?? criticalDeleteRpc.reason,
            });
          } else {
          if (op.table === 'chantiers' && op.filter.column === 'id') {
            const { data: linkedReserves, error: linkedErr, meta: linkedMeta } = await supabaseRestSelect(
              'reserves',
              'id',
              { column: 'chantier_id', value: op.filter.value },
            );
            if (linkedErr) {
              return syncExit('E55', fail(op, linkedErr, { meta: linkedMeta }));
            }
            if (linkedReserves?.[0]) {
              // Le SELECT a répondu : l'opération reste différée — les
              // réserves peuvent être supprimées plus tard — mais le backend
              // est prouvé joignable.
              return syncExit('E56', fail(op, i18n.t('networkQueue.deleteProjectHasReserves'), { meta: linkedMeta }));
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
                  return syncExit('E57', { kind: 'applied', operation: op });
                }
              } catch {}
            }
            return syncExit('E58', fail(op, `DELETE sur ${op.table} bloqué par une policy RLS (0 ligne supprimée).`, { meta: result.meta }));
          }
        } else {
          // Opération illisible : aucune tentative ne la rendra valide.
          return syncExit('E59', terminalLocalOperation(op, 'invalid_local_operation', `Opération inconnue: ${(op as any).op}`));
        }

        if (result.error) return syncExit('E60', fail(retryOpForCatch, result.error, { meta: result.meta }));

        if (op.op === 'insert' && op.table === 'messages' && data?.id && data?.channel_id) {
          triggerMessagePush(String(data.id), String(data.channel_id));
        }
        if (op.op === 'insert' && op.table === 'reserves' && data?.id) {
          triggerReserveCreatedPush(String(data.id));
        }
        // NOUVELLE entrée de file, pas l'issue de celle-ci : la réserve a bien
        // été écrite, ses photos partent séparément. Elle reste poussée
        // directement tant que la reconstruction legacy lit `failedOps`.
        if (deferredPhotoPatch) failedOps.push(deferredPhotoPatch);
        return syncExit('E61', { kind: 'applied', operation: retryOpForCatch });
      } catch (e) {
        return syncExit('E62', fail(retryOpForCatch, e));
      }
    };

    for (const op of currentQueue) {
      // Le disjoncteur ne s'ouvre qu'après plusieurs échecs d'infrastructure
      // consécutifs : à ce stade les opérations restantes échoueraient pour la
      // même raison. On les laisse intactes pour le réessai différé.
      if (circuitOpened || passMustStop) break;
      // Si une passe plus récente nous a préemptés (nous étions gelés puis
      // réveillés), on cesse immédiatement tout travail : la passe courante
      // possède la file et a déjà rejoué (ou est en train de rejouer) ces ops.
      if (!isCurrentGeneration()) break;

      const outcome = await executeQueuedOperation(op);
      processed += 1;
      // Enregistré APRÈS exécution, jamais déduit d'un décompte : c'est cette
      // entrée physique qui vient d'être traitée, quelle que soit l'identité
      // serveur qu'elle porte désormais.
      if (op.queueEntryId) processedEntryIds.add(op.queueEntryId);

      // Le succès est désormais DÉCLARÉ, non plus déduit de `failedOps.length`.
      // Cette heuristique se trompait dans les deux sens : une réserve écrite
      // avec un patch photo différé était comptée comme un échec, et un patch
      // de commentaire malformé — abandonné sans qu'aucun serveur ne soit joint
      // — remettait le backoff à zéro comme s'il avait prouvé que le lien
      // fonctionne.
      // `fail()` ne pose jamais `provesServerReachable` : un `503` — rendu PAR
      // le serveur — doit continuer d'alimenter la série, sans quoi le
      // disjoncteur ne s'ouvrirait jamais sur une panne de service prolongée.
      // C'est le verdict d'échec, lui, qui impose sa valeur.
      consecutiveInfraFailures = nextServiceFailureStreak({
        current: consecutiveInfraFailures,
        failureStreak: outcome.serviceFailureStreak,
        applied: outcome.kind === 'applied',
        provesServerReachable: outcome.provesServerReachable,
      });
      if (outcome.kind === 'applied' || outcome.provesServerReachable === true) {
        syncInfrastructureFailureCountRef.current = 0;
      }
      if (outcome.kind === 'applied') {
        setLastOperationSuccessAt(new Date().toISOString());
        if (
          op.recoveryIntent === HISTORICAL_VISIT_RECOVERY_INTENT
          && op.table === 'visites'
          && op.op === 'insert'
          && typeof op.data?.id === 'string'
          && Array.isArray(op.recoveryDependencyKeys)
        ) {
          appliedHistoricalVisitRecoveries.push({
            visitId: op.data.id,
            dependencyKeys: op.recoveryDependencyKeys,
          });
        }
      }
      // Marque le progrès : tant qu'une opération est traitée régulièrement,
      // la passe n'est jamais considérée comme gelée par le garde-fou.
      syncProgressAtRef.current = Date.now();
      setSyncProgress({ done: processed, total: currentQueue.length });
    }

    // Si une passe plus récente nous a préemptés (cette passe était gelée puis
    // a fini par se réveiller), on n'écrit RIEN : la passe courante est
    // désormais propriétaire de la file. Écraser l'état ici ferait revivre des
    // opérations déjà rejouées ou supprimerait celles enfilées entre-temps.
    if (!isCurrentGeneration()) return;

    // Annulation du stock optimiste des mouvements requalifiés en refus
    // définitif pendant cette passe. Séquentiel : deux mouvements du même
    // produit doivent se retirer l'un après l'autre du même instantané.
    for (const entry of terminalReconciliations) {
      await reconcileTerminalInventoryOperationCache(entry.op, entry.outcome, userId).catch(error => {
        console.warn('[inventory] terminal cache reconciliation failed:', (error as any)?.message ?? error);
      });
    }

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
    // Par IDENTITÉ PHYSIQUE, jamais par `id` métier : un rebase remplace
    // volontairement l'identifiant serveur de l'entrée. Suivre l'ancien `id`
    // faisait passer la version préparée pour une opération enfilée pendant la
    // passe — elle restait dans la file après un succès, et pouvait y coexister
    // avec sa propre version en échec.
    //
    // Le décompte `slice(0, processed)` est également abandonné : il déduisait
    // les entrées traitées de leur POSITION, alors que le tableau parcouru et
    // celui de `queueRef` peuvent avoir divergé pendant la passe.
    const additionsDuringPass = queueRef.current.filter(operation => (
      !operation.queueEntryId || !processedEntryIds.has(operation.queueEntryId)
    ));
    let queueAfterRecovery = [
      ...remaining,
      ...additionsDuringPass,
    ];
    for (const recovery of appliedHistoricalVisitRecoveries) {
      queueAfterRecovery = releaseRecoveredVisitDependencies(
        queueAfterRecovery,
        recovery.visitId,
        recovery.dependencyKeys,
      );
    }
    const nextQueue = coalesceQueuedOperations(queueAfterRecovery);
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
      // Les échecs non terminaux restent rejouables : on programme la relance
      // au lieu de dépendre du seul ping natif (inexistant sur le web).
      if (hasReplayableQueuedOperations(leftover)) scheduleSync(SYNC_FAILURE_RETRY_DELAY_MS);
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
      setLastQueueDrainedAt(new Date().toISOString());
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

  /**
   * @param options.proveNeverStarted
   *   L'appelant AFFIRME qu'aucune requête n'est partie pour cette écriture.
   *   Affirmation, pas supposition : elle seule autorise la purge manuelle à
   *   supprimer l'entrée et à annuler son effet optimiste.
   *
   *   Par DÉFAUT `'unknown'` — ni `never_started`, ni `started`.
   *
   *   `never_started` par défaut était faux : plusieurs chemins tentent le
   *   serveur d'abord et n'enfilent qu'en cas d'erreur, si bien qu'une écriture
   *   peut-être validée devenait supprimable.
   *
   *   `started` par défaut était pire : cet état signifie « preuve durable
   *   écrite avant tout réseau », et la passe saute son écriture stricte quand
   *   elle le voit. Le poser à l'entrée supprimait donc la barrière même qu'il
   *   représente — l'entrée partait vers le serveur sans qu'aucune trace ne
   *   soit garantie sur le disque.
   */
  const enqueueOperation = useCallback((
    op: EnqueueOperationInput,
    options?: EnqueueOperationOptions,
  ) => {
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
      queueEntryId: genQueueId(),
      dispatchState: options?.proveNeverStarted === true ? 'never_started' : 'unknown',
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

  /**
   * Suppression EXPLICITE demandée par l'utilisateur.
   *
   * Contrairement à une sauvegarde automatique, une réussite fabriquée est ici
   * inacceptable : l'interface annoncerait une file vide pendant que le disque
   * garde les anciennes opérations, qui réapparaîtraient — et se
   * synchroniseraient — au redémarrage. L'écriture est donc stricte, et la file
   * n'est vidée en mémoire qu'une fois le disque à jour.
   */
  /**
   * Existe-t-il de quoi annuler l'effet local de cette opération ?
   *
   * Un mouvement de stock écrit dans un cache DURABLE : sans compensateur, le
   * supprimer laisserait le stock local en désaccord avec le serveur pour de
   * bon. Les autres domaines n'écrivent que dans les caches de requêtes, qu'une
   * invalidation suffit à reconstruire depuis le serveur.
   */
  const purgeCompensatorFor = useCallback((operation: QueuedOperation): (() => Promise<void>) | null => {
    if (isInventoryMovementOperation(operation)) {
      return async () => {
        const outcome = normalizeInventoryMovementOutcome(
          { status: 'invalid_payload', message: 'Opération supprimée avant tout envoi.' },
          inventoryOutcomeContextFromQueuedOperation(operation),
        );
        // AUCUN `catch` : absorber l'échec déclarerait la purge réussie avec un
        // stock local incohérent, et plus aucune opération pour le réparer.
        await reconcileTerminalInventoryOperationCache(operation, outcome, userId);
      };
    }

    // Registre FERMÉ. Une invalidation de requête n'est pas une compensation :
    // hors ligne, ou avec l'écran concerné inactif, aucun refetch autoritaire
    // n'a lieu — l'opération disparaîtrait pendant que le cache DURABLE garde
    // son état optimiste. Les produits d'inventaire et les réserves écrivent
    // tous deux dans AsyncStorage à chaque mutation.
    //
    // Tant qu'un vrai compensateur durable n'existe pas pour un domaine, ses
    // opérations sont CONSERVÉES plutôt que supprimées à l'aveugle.
    return null;
  }, [userId]);

  const reconcilePurgedOperation = useCallback(async (operation: QueuedOperation) => {
    const compensator = purgeCompensatorFor(operation);
    if (!compensator) throw new Error('Aucun compensateur pour cette operation.');
    await compensator();
  }, [purgeCompensatorFor]);

  reconcilePurgedOperationRef.current = reconcilePurgedOperation;

  const clearQueue = useCallback(async () => {
    // Capturée AVANT toute attente : une invocation devenue obsolète ne doit
    // écrire sous la clef d'un compte qui n'est plus le sien, ni libérer le
    // verrou d'une passe qui ne lui appartient pas.
    const ownerGeneration = queueHydrationGenerationRef.current;
    const isOwner = () => queueHydrationGenerationRef.current === ownerGeneration;
    const anonKey = OFFLINE_QUEUE_PREFIX + 'anon';

    const result = await runManualQueuePurge<QueuedOperation>({
      // Préempter ne suffirait pas : `AbortController` coupe le transport
      // client, il n'annule pas une transaction PostgreSQL.
      // L'hydratation publie elle aussi dans `queueRef` : purger pendant
      // qu'elle court ferait écrire deux propriétaires concurrents.
      isSyncing: () => syncingRef.current || !queueLoadedRef.current,
      acquire: () => { syncingRef.current = true; },
      release: () => { syncingRef.current = false; },
      isOwner,
      readCurrent: () => queueRef.current,
      entryIdOf: operation => operation.queueEntryId ?? null,
      isPurgeable: isUnambiguouslyPurgeableOperation,
      hasCompensator: operation => purgeCompensatorFor(operation) !== null,
      markPending: operation => ({ ...operation, purgeState: PURGE_PENDING_RECONCILIATION }),
      backup: operations => backupQueue([...operations], 'manual-clear'),
      persist: compute => publishAfterDurableWrite<QueuedOperation>({
        readCurrent: () => queueRef.current,
        compute,
        write: next => writeQueueStrict(next),
        publish: next => {
          queueRef.current = next;
          setQueue(next);
        },
        assertCurrent: () => {
          if (!isOwner()) throw new Error('Purge annulee : le compte actif a change.');
        },
      }),
      reconcile: reconcilePurgedOperation,
      finalize: () => {
        // Réussite comme échec : la file doit rester automatiquement
        // reprenable. Un rejet du coordinateur sortait avant l'appel postérieur.
        if (hasReplayableQueuedOperations(queueRef.current)) scheduleSync();
      },
      reset: outcome => {
        // La passe préemptée ne se nettoie plus elle-même : sa génération n'est
        // plus courante. Sans cette remise à zéro, l'interface pouvait rester
        // sur « 3/29 » et un statut `syncing` alors que rien ne tourne.
        if (syncKickTimerRef.current) {
          clearTimeout(syncKickTimerRef.current);
          syncKickTimerRef.current = null;
        }
        passAbortRef.current = null;
        syncProgressAtRef.current = 0;
        setSyncProgress({ done: 0, total: 0 });
        setNextSyncAttemptAt(null);
        if (outcome === 'failed') {
          setSyncStatus('error');
          return;
        }
        setSyncAuthBlocked(false);
        setSyncStatus(hasReplayableQueuedOperations(queueRef.current) ? 'idle' : 'done');
      },
    });

    // La copie anonyme est VIDÉE, jamais supprimée — et seulement si ce n'est
    // pas la clef active : sans utilisateur, `offlineQueueKey` EST la clef
    // anonyme, et cette écriture effacerait les survivantes.
    if (isOwner() && offlineQueueKey !== anonKey) {
      await queueWriteChain.writeBestEffort(anonKey, JSON.stringify([]));
    }
    return result;
  }, [
    backupQueue, writeQueueStrict, queueWriteChain, offlineQueueKey,
    scheduleSync, purgeCompensatorFor, reconcilePurgedOperation,
  ]);

  const dismissRejectedOperations = useCallback(async () => {
    const rejected = queueRef.current.filter(operation => operation.terminal);
    if (rejected.length === 0) return;

    // Final safeguard for outcomes created by an older app session: reconcile
    // the durable inventory cache before removing the acknowledgement record.
    for (const operation of rejected) {
      if (!isInventoryMovementOperation(operation)) continue;
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
    // Les nouvelles mutations sont déjà la représentation durable courante :
    // les relire, puis relire les gros caches visites/réserves et invalider
    // toutes les queries doublait inutilement le temps du bouton manuel.
    // Seules les anciennes références VIS-######## ont besoin de rejouer le
    // planificateur historique avant la passe réseau.
    if (
      !syncingRef.current
      && (
        !queueLoadedRef.current
        || queueNeedsHistoricalVisitRecoveryEvaluation(queueRef.current)
      )
    ) {
      await loadQueueRef.current?.();
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
      lastSyncAttemptAt,
      lastOperationSuccessAt,
      lastQueueDrainedAt,
      backendReachable,
      nextSyncAttemptAt,
      historicalVisitRecovery,
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
