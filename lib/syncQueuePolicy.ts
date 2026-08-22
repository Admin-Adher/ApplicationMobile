export interface SyncQueueOperationLike {
  table?: string;
  terminal?: boolean;
  terminalStatus?: string;
  terminalOutcome?: SyncQueueTerminalOutcome;
  attemptCount?: number;
  rpc?: { fn?: string };
}

export type SyncQueueOperationDomain = 'inventory' | 'reserve' | 'plan' | 'generic';

export interface SyncQueueTerminalOutcome {
  domain: SyncQueueOperationDomain;
  status: string;
  message?: string;
  operationId?: string;
  productId?: string;
  movementId?: string;
  stockBefore?: number;
  stockAfter?: number;
  serverStock?: number;
  direction?: 'in' | 'out' | 'transfer' | 'adjustment';
  productName?: string;
  productReference?: string;
  quantity?: number;
  unit?: string;
  chantierId?: string;
  chantierName?: string;
  occurredAt?: string;
}

export interface SyncQueueCounts {
  pending: number;
  rejected: number;
  stuck: number;
  /** Operations requiring attention, without double-counting terminal failures. */
  attention: number;
}

const INVENTORY_RPC_NAMES = new Set([
  'record_inventory_movement',
  'update_inventory_product',
]);

const RESERVE_RPC_NAMES = new Set([
  'append_reserve_status_event',
  'apply_reserve_patch',
  'create_reserve_with_photos',
]);

const PLAN_RPC_NAMES = new Set([
  'create_site_plan_revision_with_reserve_migration',
  'replace_site_plan_file_safely',
]);

const INVENTORY_OUTCOME_TRANSLATION_KEYS: Record<string, string> = {
  insufficient_stock: 'networkQueue.inventoryOutcome.insufficient_stock',
  forbidden: 'networkQueue.inventoryOutcome.forbidden',
  invalid_payload: 'networkQueue.inventoryOutcome.invalid_payload',
  not_found: 'networkQueue.inventoryOutcome.not_found',
  product_not_found: 'networkQueue.inventoryOutcome.product_not_found',
  duplicate_product: 'networkQueue.inventoryOutcome.duplicate_product',
  duplicate_operation_mismatch: 'networkQueue.inventoryOutcome.duplicate_operation_mismatch',
  server_rejected: 'networkQueue.inventoryOutcome.server_rejected',
};

/**
 * Nombre d'échecs déterministes consécutifs avant de requalifier une opération
 * en refus définitif. Un seul 400/404 peut venir d'un proxy qui hoquette : on
 * ne détruit jamais une écriture utilisateur sur un unique verdict. Trois
 * échecs identiques (≈ une minute de réessais) ne peuvent plus être un aléa.
 */
export const SYNC_PERMANENT_FAILURE_ATTEMPTS = 3;

/**
 * Erreurs dont le verdict ne dépend ni du réseau ni de l'instant : rejouer
 * l'opération telle quelle produit exactement la même erreur, indéfiniment.
 */
const PERMANENT_SYNC_ERROR_CODES = new Set([
  'MISSING_FILTER', // garde-fou client : opération non rejouable en l'état
  'PGRST202',       // fonction absente du cache de schéma (migration non appliquée)
  'PGRST203',       // surcharge de fonction ambiguë
  'PGRST204',       // colonne inconnue dans le payload
  '42501',          // permission refusée (grant / RLS)
  '42883',          // fonction inexistante
  '42703',          // colonne inexistante
  '42P01',          // table inexistante
  '42804',          // types incompatibles
  '22P02',          // syntaxe d'entrée invalide (uuid, numeric, enum…)
  '22003',          // dépassement de capacité numérique
  '22007',          // format de date/heure invalide
  '22008',          // date/heure hors plage
  '23502',          // contrainte NOT NULL violée
  '23503',          // clé étrangère violée
  '23514',          // contrainte CHECK violée
]);

/**
 * 401 (auth) et 409/429/5xx sont volontairement absents : les premiers ont leur
 * propre circuit de reconnexion, les seconds peuvent réussir au réessai — ou
 * l'écriture a peut-être abouti côté serveur, auquel cas annuler l'optimisme
 * local corromprait les stocks.
 */
const PERMANENT_SYNC_HTTP_STATUSES = new Set([400, 403, 404, 405, 413, 422]);

export function syncErrorStatus(error: any): number {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const explicitStatus = Number(error?.status);
  const messageStatus = Number(message.match(/\bhttp\s+(\d{3})/)?.[1]);
  return Number.isFinite(explicitStatus) && explicitStatus > 0
    ? explicitStatus
    : messageStatus;
}

export function isAuthenticationSyncFailure(error: any): boolean {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  return (
    syncErrorStatus(error) === 401
    || code === 'PGRST301'
    || /jwt.*(?:expired|invalid)/.test(message)
    || /invalid.*jwt/.test(message)
  );
}

export function isInfrastructureSyncFailure(error: any): boolean {
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
    // Coupures de transport : l'appel n'a jamais obtenu de réponse. Sans elles,
    // une 4G qui tombe produisait des erreurs « inconnues » n'alimentant aucun
    // circuit, et confondables avec un refus serveur.
    || /network request failed/.test(message)
    || /failed to fetch/.test(message)
    || /fetch failed/.test(message)
    || /network error/.test(message)
    || /socket hang up/.test(message)
    || /connection refused/.test(message)
    || /econnreset/.test(message)
    || /econnaborted/.test(message)
    || /enetunreach/.test(message)
    || /ehostunreach/.test(message)
    || /etimedout/.test(message)
    || /eai_again/.test(message)
    // Borne locale atteinte (withTimeoutMs / AbortController) : le lien est
    // trop lent pour cette opération, c'est un signal réseau, pas un refus.
    || /^timeout after \d+ms$/.test(message)
    || /aborted/.test(message)
  );
}

/**
 * Refus déterministe du serveur (droit manquant, fonction absente, payload
 * invalide…). Sans cette classification, un tel échec est ré-enfilé « en
 * attente, réessai automatique » à vie : la file grossit à chaque saisie et ne
 * se vide jamais, tout en promettant à l'utilisateur qu'elle va se résorber.
 */
export function isPermanentSyncFailure(error: any): boolean {
  // Un échec d'authentification ou d'infrastructure est transitoire par nature :
  // il possède son propre circuit (reconnexion, backoff exponentiel) et ne doit
  // jamais être requalifié en refus définitif.
  if (isAuthenticationSyncFailure(error) || isInfrastructureSyncFailure(error)) return false;
  const code = String(error?.code ?? '').toUpperCase();
  if (PERMANENT_SYNC_ERROR_CODES.has(code)) return true;
  return PERMANENT_SYNC_HTTP_STATUSES.has(syncErrorStatus(error));
}

/** Codes fabriqués côté client : leur présence ne prouve aucune réponse serveur. */
const CLIENT_SIDE_FAILURE_CODES = new Set(['REST_TIMEOUT', 'REST_ABORTED', 'MISSING_FILTER']);

/**
 * Le serveur a-t-il rendu un verdict ? Un statut HTTP ou un code PostgREST /
 * Postgres ne peut provenir que d'une réponse ; une coupure de transport n'en
 * porte aucun. C'est ce qui distingue « le backend est injoignable » d'un refus
 * métier : un 400 prouve que le lien fonctionne, même si l'opération échoue.
 */
export function syncFailureReachedServer(error: any): boolean {
  if (syncErrorStatus(error) > 0) return true;
  const code = String(error?.code ?? '').toUpperCase();
  if (!code) return false;
  return !CLIENT_SIDE_FAILURE_CODES.has(code);
}

/**
 * Fragments d'un message qui changent d'un essai à l'autre sans changer la
 * nature du refus. Les neutraliser rend l'empreinte stable entre deux passes.
 */
const VOLATILE_FAILURE_MESSAGE_PATTERNS: [RegExp, string][] = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'],
  [/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '<timestamp>'],
  [/\d+/g, '<n>'],
];

/**
 * Identité stable d'un échec, pour ne compter comme « répétés » que des refus
 * réellement identiques. Sans empreinte, une séquence timeout → 503 → 404
 * rendait le 404 terminal du premier coup, puisque seul le nombre total de
 * tentatives était consulté.
 */
export function syncFailureFingerprint(error: any): string {
  const code = String(error?.code ?? '').toUpperCase().trim();
  const status = syncErrorStatus(error);
  let message = String(error?.message ?? error ?? '').toLowerCase().trim();
  for (const [pattern, token] of VOLATILE_FAILURE_MESSAGE_PATTERNS) {
    message = message.replace(pattern, token);
  }
  message = message.replace(/\s+/g, ' ').slice(0, 200);
  return [code, status > 0 ? String(status) : '', message].join('|');
}

/** Suivi persisté permettant de reconnaître un refus déjà rencontré. */
export interface SyncFailureTrackingLike {
  lastFailureFingerprint?: string;
  sameFailureCount?: number;
}

export interface PermanentFailureAssessment {
  /** Empreinte à persister, ou null quand la série est cassée. */
  fingerprint: string | null;
  /** Refus déterministes consécutifs de MÊME empreinte, celui-ci inclus. */
  sameFailureCount: number;
  terminal: boolean;
}

/**
 * Décide si une opération a assez insisté sur le MÊME refus déterministe pour
 * quitter le lot « en attente ». Toute erreur d'une autre nature (timeout, 5xx,
 * empreinte différente) casse la série : une écriture utilisateur ne doit jamais
 * être requalifiée en refus sur la foi d'échecs hétérogènes.
 */
export function assessPermanentFailure(
  operation: SyncFailureTrackingLike,
  error: any,
): PermanentFailureAssessment {
  if (!isPermanentSyncFailure(error)) {
    return { fingerprint: null, sameFailureCount: 0, terminal: false };
  }

  const fingerprint = syncFailureFingerprint(error);
  const sameFailureCount = operation.lastFailureFingerprint === fingerprint
    ? (operation.sameFailureCount ?? 0) + 1
    : 1;

  return {
    fingerprint,
    sameFailureCount,
    terminal: sameFailureCount >= SYNC_PERMANENT_FAILURE_ATTEMPTS,
  };
}

/**
 * Nombre d'échecs d'infrastructure CONSÉCUTIFS (timeout, 5xx, 429) avant
 * d'abandonner la passe de synchronisation en cours.
 *
 * Pourquoi ce n'est pas 1 : sur une connexion de chantier instable, une
 * opération peut expirer alors que la suivante passe très bien. Abandonner la
 * passe dès le premier timeout ne rejouait qu'UNE opération par passe, puis
 * attendait le backoff (jusqu'à 5 min) — une file de trente mouvements de stock
 * ne pouvait alors plus se vider, et chaque nouvelle saisie la faisait grossir
 * plus vite qu'elle ne se drainait. Plusieurs échecs d'affilée restent en
 * revanche une preuve raisonnable que le lien est inutilisable : inutile de
 * marteler le serveur avec les opérations restantes.
 */
export const SYNC_INFRA_CIRCUIT_THRESHOLD = 3;

/**
 * Le compteur passé ici est CONSÉCUTIF : toute opération réussie dans la même
 * passe le remet à zéro, puisqu'elle prouve que le réseau fonctionne.
 */
export function shouldAbandonPassAfterInfrastructureFailure(consecutiveFailures: number): boolean {
  return consecutiveFailures >= SYNC_INFRA_CIRCUIT_THRESHOLD;
}

export function isReplayableQueuedOperation(operation: SyncQueueOperationLike): boolean {
  return operation.terminal !== true;
}

export function hasReplayableQueuedOperations(queue: SyncQueueOperationLike[]): boolean {
  return queue.some(isReplayableQueuedOperation);
}

export function getSyncQueueCounts(queue: SyncQueueOperationLike[]): SyncQueueCounts {
  let pending = 0;
  let rejected = 0;
  let stuck = 0;

  for (const operation of queue) {
    if (operation.terminal) {
      rejected += 1;
      continue;
    }

    pending += 1;
    if ((operation.attemptCount ?? 0) >= 3) stuck += 1;
  }

  return { pending, rejected, stuck, attention: rejected + stuck };
}

export function getSyncQueueOperationDomain(operation: SyncQueueOperationLike): SyncQueueOperationDomain {
  const rpcName = operation.rpc?.fn;
  if (rpcName && INVENTORY_RPC_NAMES.has(rpcName)) return 'inventory';
  if (rpcName && RESERVE_RPC_NAMES.has(rpcName)) return 'reserve';
  if (rpcName && PLAN_RPC_NAMES.has(rpcName)) return 'plan';

  if (operation.table === 'inventory_products' || operation.table === 'inventory_movements') return 'inventory';
  if (operation.table === 'reserves' || operation.table === 'photos') return 'reserve';
  if (operation.table === 'site_plans') return 'plan';
  if (operation.terminalOutcome?.domain) return operation.terminalOutcome.domain;
  return 'generic';
}

export function isInventoryQueuedOperation(operation: SyncQueueOperationLike): boolean {
  return getSyncQueueOperationDomain(operation) === 'inventory';
}

export function inventoryOutcomeTranslationKey(operation: SyncQueueOperationLike): string | null;
export function inventoryOutcomeTranslationKey(
  status: string | null | undefined,
  operation?: SyncQueueOperationLike,
): string | null;
export function inventoryOutcomeTranslationKey(
  operationOrStatus: SyncQueueOperationLike | string | null | undefined,
  legacyOperation?: SyncQueueOperationLike,
): string | null {
  const operation = typeof operationOrStatus === 'object' && operationOrStatus !== null
    ? operationOrStatus
    : legacyOperation;
  if (!operation || getSyncQueueOperationDomain(operation) !== 'inventory') return null;

  const status = typeof operationOrStatus === 'string'
    ? operationOrStatus
    : operation.terminalOutcome?.status ?? operation.terminalStatus;
  if (!status) return null;
  return INVENTORY_OUTCOME_TRANSLATION_KEYS[status] ?? null;
}
