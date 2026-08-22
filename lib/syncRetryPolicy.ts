import { hasDeterministicRefusalSignature } from './syncQueuePolicy';

/**
 * Politique de reessai — module PUR.
 *
 * Aucune fonction d'ici n'appelle `Date.now()`, `Math.random()`, AsyncStorage,
 * React ou Supabase : l'heure et l'alea sont injectes. C'est ce qui rend la
 * politique testable sur des scenarios temporels que le moteur ne saurait pas
 * reproduire (echeance depassee au redemarrage, delai serveur de 48 h,
 * changement d'heure systeme).
 *
 * Ce fichier ne definit AUCUN comportement actif tant que le moteur ne
 * l'appelle pas. L'integration est volontairement separee.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Contrats
// ─────────────────────────────────────────────────────────────────────────────

export type SyncFailureClass =
  | 'cancelled'
  | 'authentication'
  | 'rate_limited'
  | 'server_unavailable'
  | 'timeout'
  | 'network'
  | 'conflict'
  | 'permanent_candidate'
  | 'unknown';

/**
 * Une echeance ne concerne pas toujours une seule operation. Un `429` demande
 * au client entier de ralentir : ne differer que l'operation courante ferait
 * partir les vingt-huit suivantes et rapporterait vingt-huit nouveaux `429`.
 */
export type SyncRetryScope = 'none' | 'operation' | 'backend' | 'authentication';

export type SyncRetrySource = 'policy' | 'retry_after' | 'authentication' | 'manual';

export interface SyncRetryDecision {
  failureClass: SyncFailureClass;
  retryable: boolean;
  incrementAttempt: boolean;
  /** Le serveur a rendu un verdict : le lien fonctionne, meme si l'op echoue. */
  reachedServer: boolean;
  scope: SyncRetryScope;
  /** La passe en cours doit-elle s'arreter immediatement ? */
  blocksCurrentPass: boolean;
  /** L'echec alimente-t-il le compteur d'echecs consecutifs du circuit ? */
  contributesToCircuit: boolean;
  nextAttemptAt: string | null;
  retrySource: SyncRetrySource | null;
  /**
   * Le serveur impose une attente superieure a 24 h. On ne la raccourcit pas —
   * l'interface doit signaler une limitation prolongee plutot que laisser
   * croire a une panne.
   */
  retryAfterLong: boolean;
}

/**
 * Forme minimale consommee par la politique. Volontairement independante de
 * `QueuedOperation` : importer NetworkContext ici creerait une dependance
 * circulaire et rendrait le module non testable isolement.
 */
export interface RetryQueueOperationLike {
  id?: string;
  queuedAt?: string;
  nextAttemptAt?: string;
  terminal?: boolean;
  attemptCount?: number;
  sameFailureCount?: number;
  table?: string;
  op?: string;
  rpc?: { fn?: string; args?: Record<string, unknown> };
  filter?: { column?: string; value?: unknown };
}

/** Metadonnees de transport. La PR d'integration les fournira reellement. */
export interface SyncFailureTransportMeta {
  status?: number | null;
  retryAfter?: string | null;
  reachedServer?: boolean;
}

export interface SyncFailureContext {
  error: unknown;
  meta?: SyncFailureTransportMeta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de politique
// ─────────────────────────────────────────────────────────────────────────────

/** Au-dela, un delai serveur est signale comme prolonge plutot que tronque. */
export const RETRY_AFTER_LONG_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Garde-fou contre une valeur techniquement impossible (30 jours). */
const RETRY_AFTER_ABSURD_MS = 30 * 24 * 60 * 60 * 1000;

const BACKOFF_LADDERS: Record<SyncFailureClass, number[]> = {
  cancelled: [],
  conflict: [],
  authentication: [5_000, 15_000, 30_000],
  rate_limited: [60_000],
  server_unavailable: [15_000, 30_000, 60_000, 120_000, 300_000],
  timeout: [10_000, 30_000, 60_000, 120_000, 300_000],
  network: [10_000, 30_000, 60_000, 120_000, 300_000],
  permanent_candidate: [30_000],
  unknown: [30_000, 60_000, 120_000, 300_000],
};

const SERVER_UNAVAILABLE_STATUSES = new Set([502, 503, 504, 520, 522, 524, 530, 544]);

/** Codes fabriques par le client : leur presence ne prouve aucune reponse. */
const CLIENT_SIDE_CODES = new Set(['REST_ABORTED', 'REST_TIMEOUT', 'MISSING_FILTER']);

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation defensive
// ─────────────────────────────────────────────────────────────────────────────

/** Une file persistee peut contenir n'importe quoi apres migration ou corruption. */
export function normalizeSameFailureCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(999, parsed);
}

function normalizeAttemptCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(10_000, parsed);
}

function errorMessage(error: unknown): string {
  return String((error as any)?.message ?? error ?? '').toLowerCase();
}

function errorCode(error: unknown): string {
  return String((error as any)?.code ?? '').toUpperCase();
}

function errorStatus(error: unknown, meta?: SyncFailureTransportMeta): number {
  const explicit = Number(meta?.status ?? (error as any)?.status);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const fromMessage = Number(errorMessage(error).match(/\bhttp\s+(\d{3})/)?.[1]);
  return Number.isFinite(fromMessage) ? fromMessage : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * L'ORDRE est normatif : plusieurs motifs peuvent reconnaitre la meme erreur.
 * L'annulation passe en premier, sinon une preemption volontaire — dont le
 * message contient « aborted » — retomberait dans la classe reseau et
 * declencherait un backoff qu'elle ne merite pas.
 */
export function classifySyncFailure(failure: SyncFailureContext): SyncFailureClass {
  const { error, meta } = failure;
  const code = errorCode(error);
  const message = errorMessage(error);
  const status = errorStatus(error, meta);
  // Un statut HTTP ou un code Postgres ne peut venir que d'une reponse. Sans
  // eux, aucun verdict serveur n'a ete rendu.
  const hasServerVerdict = status > 0 || (code !== '' && !CLIENT_SIDE_CODES.has(code));

  // 1. Annulation demandee par l'appelant.
  if (code === 'REST_ABORTED') return 'cancelled';

  // 2. Authentification.
  if (status === 401 || code === 'PGRST301') return 'authentication';
  if (/jwt.*(?:expired|invalid)/.test(message) || /invalid.*jwt/.test(message)) {
    return 'authentication';
  }

  // 3. Limitation de debit — le serveur a repondu, ce n'est pas une panne reseau.
  if (status === 429) return 'rate_limited';

  // 4. Indisponibilite serveur.
  if (SERVER_UNAVAILABLE_STATUSES.has(status)) return 'server_unavailable';

  // 5. Depassement de delai.
  if (code === 'REST_TIMEOUT') return 'timeout';
  if (
    /^timeout after \d+ms$/.test(message)
    || /statement timeout/.test(message)
    || /database.*tim(?:ed|e)\s*out/.test(message)
    || /connection.*timeout/.test(message)
    || /\betimedout\b/.test(message)
  ) {
    return 'timeout';
  }

  // 6. Coupure de transport.
  if (
    /network request failed/.test(message)
    || /failed to fetch/.test(message)
    || /fetch failed/.test(message)
    || /network error/.test(message)
    || /socket hang up/.test(message)
    || /connection refused/.test(message)
    || /connection terminated/.test(message)
    || /\beconnreset\b/.test(message)
    || /\beconnaborted\b/.test(message)
    || /\benetunreach\b/.test(message)
    || /\behostunreach\b/.test(message)
    || /\beai_again\b/.test(message)
    // « aborted » seul ne vaut coupure que si RIEN n'a repondu : un refus
    // serveur dont le message contient ce mot ne doit pas etre requalifie.
    || (!hasServerVerdict && /aborted/.test(message))
  ) {
    return 'network';
  }

  // 7. Conflit metier.
  if (status === 409 || code === '23505' || /version_conflict/.test(message)) return 'conflict';

  // 8. Refus deterministe candidat.
  // Signature brute : l'ordre ci-dessus a deja ecarte auth, debit, panne
  // serveur, timeout et coupure. La version gardee de syncQueuePolicy
  // renverrait false ici, a cause de sa propre reconnaissance de « aborted ».
  if (hasDeterministicRefusalSignature(error)) return 'permanent_candidate';

  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry-After
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryAfterParseResult {
  /** Delai en millisecondes, ou null si l'en-tete est inutilisable. */
  delayMs: number | null;
  /** Le serveur demande plus que le seuil : a signaler, jamais a raccourcir. */
  long: boolean;
}

/**
 * Accepte les deux formes de l'en-tete : un nombre de secondes, ou une date
 * HTTP. Une valeur invalide, negative ou deja passee est ignoree — elle ne doit
 * jamais raccourcir NI allonger arbitrairement la planification.
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number): RetryAfterParseResult {
  if (typeof value !== 'string') return { delayMs: null, long: false };
  const trimmed = value.trim();
  if (!trimmed) return { delayMs: null, long: false };

  let delayMs: number | null = null;

  if (/^\d+$/.test(trimmed)) {
    delayMs = Number(trimmed) * 1000;
  } else {
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) delayMs = parsed - nowMs;
  }

  if (delayMs === null || !Number.isFinite(delayMs)) return { delayMs: null, long: false };
  // Zero ou date deja passee : rien a attendre.
  if (delayMs <= 0) return { delayMs: null, long: false };
  // Valeur techniquement impossible : on ne la suit pas.
  if (delayMs > RETRY_AFTER_ABSURD_MS) return { delayMs: null, long: false };

  return { delayMs, long: delayMs > RETRY_AFTER_LONG_THRESHOLD_MS };
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision
// ─────────────────────────────────────────────────────────────────────────────

const SCOPE_BY_CLASS: Record<SyncFailureClass, SyncRetryScope> = {
  cancelled: 'none',
  authentication: 'authentication',
  rate_limited: 'backend',
  server_unavailable: 'operation',
  timeout: 'operation',
  network: 'operation',
  conflict: 'operation',
  permanent_candidate: 'operation',
  unknown: 'operation',
};

export interface RetryDecisionInput {
  failure: SyncFailureContext;
  operation?: RetryQueueOperationLike;
  nowMs: number;
  /**
   * Echantillon uniforme dans [0, 1). Injecte pour rester deterministe en test.
   * 0.5 signifie « pas de decalage » pour le jitter client symetrique.
   */
  jitter?: number;
}

function clampJitter(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.5;
  return Math.min(0.999_999, Math.max(0, value));
}

export function computeRetryDecision(input: RetryDecisionInput): SyncRetryDecision {
  const { failure, operation, nowMs } = input;
  const jitter = clampJitter(input.jitter);
  const failureClass = classifySyncFailure(failure);
  const status = errorStatus(failure.error, failure.meta);
  const retryAfter = parseRetryAfter(failure.meta?.retryAfter, nowMs);

  const reachedServer = failure.meta?.reachedServer
    ?? (status > 0 && failureClass !== 'cancelled');

  // Une annulation volontaire n'est pas un echec : elle ne compte pas, ne
  // planifie rien, et laisse l'operation intacte pour la generation suivante.
  if (failureClass === 'cancelled') {
    return {
      failureClass,
      retryable: true,
      incrementAttempt: false,
      reachedServer: false,
      scope: 'none',
      blocksCurrentPass: false,
      contributesToCircuit: false,
      nextAttemptAt: null,
      retrySource: null,
      retryAfterLong: false,
    };
  }

  // Le conflit releve de la logique metier existante (rebase), pas d'un delai.
  if (failureClass === 'conflict') {
    return {
      failureClass,
      retryable: true,
      incrementAttempt: true,
      reachedServer: true,
      scope: 'operation',
      blocksCurrentPass: false,
      contributesToCircuit: false,
      nextAttemptAt: null,
      retrySource: null,
      retryAfterLong: false,
    };
  }

  const ladder = BACKOFF_LADDERS[failureClass];
  const attemptIndex = Math.min(
    normalizeAttemptCount(operation?.attemptCount),
    Math.max(0, ladder.length - 1),
  );
  const baseDelayMs = ladder.length > 0 ? ladder[attemptIndex] : 0;

  // Jitter client symetrique : ±20 %, centre quand jitter = 0.5.
  const clientDelayMs = Math.round(baseDelayMs * (0.8 + 0.4 * jitter));
  const clientAttemptAtMs = nowMs + clientDelayMs;

  // Jitter serveur uniquement POSITIF : on n'avance jamais une echeance imposee.
  const serverAttemptAtMs = retryAfter.delayMs !== null
    ? nowMs + Math.round(retryAfter.delayMs * (1 + 0.1 * jitter))
    : null;

  // Le delai serveur ne remplace pas aveuglement le backoff : on retient le
  // plus tardif des deux, sinon une consigne serveur courte annulerait un
  // backoff client devenu long apres plusieurs echecs.
  const nextAttemptAtMs = serverAttemptAtMs !== null
    ? Math.max(clientAttemptAtMs, serverAttemptAtMs)
    : clientAttemptAtMs;

  const scope: SyncRetryScope = failureClass === 'server_unavailable' && serverAttemptAtMs !== null
    ? 'backend'
    : SCOPE_BY_CLASS[failureClass];

  return {
    failureClass,
    // Meme un refus deterministe reste rejouable ici : c'est la politique
    // d'empreintes identiques (syncQueuePolicy) qui decide de le terminer,
    // apres trois verdicts concordants — pas ce module.
    retryable: true,
    incrementAttempt: true,
    reachedServer,
    scope,
    blocksCurrentPass: scope === 'backend' || scope === 'authentication',
    // Seule une absence de verdict serveur temoigne d'un probleme de lien. Un
    // 429 ou un 400 prouvent au contraire que le backend repond.
    contributesToCircuit: failureClass === 'timeout'
      || failureClass === 'network'
      || (failureClass === 'server_unavailable' && serverAttemptAtMs === null),
    nextAttemptAt: new Date(nextAttemptAtMs).toISOString(),
    retrySource: serverAttemptAtMs !== null && serverAttemptAtMs >= clientAttemptAtMs
      ? 'retry_after'
      : failureClass === 'authentication' ? 'authentication' : 'policy',
    retryAfterLong: retryAfter.long,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ordonnancement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deux ecritures de la MEME entite doivent rester strictement ordonnees, sinon
 * un mouvement de stock plus recent pourrait depasser un plus ancien encore en
 * attente et corrompre le solde. Quand aucune cle metier ne peut etre derivee,
 * on retombe sur la table entiere : cela reduit le debit, ce qui est preferable
 * a un depassement d'ordre.
 */
export function syncOrderingKey(operation: RetryQueueOperationLike): string {
  const rpcFn = operation.rpc?.fn;
  const args = operation.rpc?.args ?? {};

  if (rpcFn === 'record_inventory_movement') {
    const movement = args.p_movement as Record<string, unknown> | undefined;
    const product = args.p_product as Record<string, unknown> | undefined;
    const productId = movement?.product_id ?? product?.id;
    if (productId) return `inventory:${String(productId)}`;
  }
  if (rpcFn === 'update_inventory_product') {
    const productId = args.p_product_id;
    if (productId) return `inventory:${String(productId)}`;
  }
  if (rpcFn === 'create_reserve_with_photos') {
    const reserve = args.p_reserve as Record<string, unknown> | undefined;
    if (reserve?.id) return `reserve:${String(reserve.id)}`;
  }
  if (rpcFn === 'apply_reserve_patch' || rpcFn === 'append_reserve_status_event') {
    const reserveId = args.p_reserve_id
      ?? (args.p_event as Record<string, unknown> | undefined)?.reserve_id;
    if (reserveId) return `reserve:${String(reserveId)}`;
  }
  if (rpcFn === 'replace_site_plan_file_safely' || rpcFn === 'create_site_plan_revision_with_reserve_migration') {
    const planId = args.p_plan_id;
    if (planId) return `plan:${String(planId)}`;
  }

  const table = operation.table ?? 'inconnu';
  if (operation.filter?.column === 'id' && operation.filter.value !== undefined) {
    return `${table}:${String(operation.filter.value)}`;
  }
  // Repli conservateur : toute la table partage une file d'ordre.
  return `table:${table}`;
}

function dueAtMs(operation: RetryQueueOperationLike): number {
  const parsed = Date.parse(operation.nextAttemptAt ?? '');
  // Absente ou invalide : l'operation est immediatement eligible. Une donnee
  // illisible ne doit jamais retarder indefiniment une ecriture utilisateur.
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export interface EligibleHeadsInput<T extends RetryQueueOperationLike> {
  operations: readonly T[];
  nowMs: number;
  orderingKey?: (operation: T) => string;
  priority?: (operation: T) => number;
}

/**
 * Tete de chaque groupe d'entite, puis filtrage sur l'echeance. Une operation
 * plus recente n'est JAMAIS retenue quand la tete de son groupe est differee.
 * L'entree n'est pas mutee et l'ordre est stable a priorite egale.
 */
export function selectEligibleOperationHeads<T extends RetryQueueOperationLike>(
  input: EligibleHeadsInput<T>,
): T[] {
  const { operations, nowMs } = input;
  const keyOf = input.orderingKey ?? syncOrderingKey;
  const priorityOf = input.priority ?? (() => 0);

  const headByKey = new Map<string, { operation: T; index: number }>();
  operations.forEach((operation, index) => {
    if (operation.terminal) return;
    const key = keyOf(operation);
    const current = headByKey.get(key);
    if (!current) {
      headByKey.set(key, { operation, index });
      return;
    }
    // La tete est la plus ancienne mise en file ; a egalite, l'ordre d'origine.
    const currentQueuedAt = current.operation.queuedAt ?? '';
    const candidateQueuedAt = operation.queuedAt ?? '';
    if (candidateQueuedAt < currentQueuedAt) {
      headByKey.set(key, { operation, index });
    }
  });

  return [...headByKey.values()]
    .filter(entry => dueAtMs(entry.operation) <= nowMs)
    .sort((a, b) => {
      const priorityDiff = priorityOf(a.operation) - priorityOf(b.operation);
      if (priorityDiff !== 0) return priorityDiff;
      const queuedDiff = (a.operation.queuedAt ?? '').localeCompare(b.operation.queuedAt ?? '');
      if (queuedDiff !== 0) return queuedDiff;
      return a.index - b.index;
    })
    .map(entry => entry.operation);
}

export interface NextWakeInput<T extends RetryQueueOperationLike> {
  operations: readonly T[];
  nowMs: number;
  /** Blocage backend global (circuit ouvert, `Retry-After` d'ampleur client). */
  globalBlockUntilMs?: number | null;
  orderingKey?: (operation: T) => string;
}

/**
 * Un seul reveil global, arme sur la premiere echeance utile. Retourne `null`
 * quand plus rien n'est rejouable — il ne faut alors armer aucun timer.
 */
export function computeNextWakeAt<T extends RetryQueueOperationLike>(
  input: NextWakeInput<T>,
): number | null {
  const { operations, nowMs } = input;
  const keyOf = input.orderingKey ?? syncOrderingKey;

  const headByKey = new Map<string, T>();
  for (const operation of operations) {
    if (operation.terminal) continue;
    const key = keyOf(operation);
    const current = headByKey.get(key);
    if (!current || (operation.queuedAt ?? '') < (current.queuedAt ?? '')) {
      headByKey.set(key, operation);
    }
  }

  if (headByKey.size === 0) return null;

  let earliest = Number.POSITIVE_INFINITY;
  for (const operation of headByKey.values()) {
    earliest = Math.min(earliest, Math.max(nowMs, dueAtMs(operation)));
  }
  if (!Number.isFinite(earliest)) return null;

  const globalBlock = input.globalBlockUntilMs;
  return typeof globalBlock === 'number' && Number.isFinite(globalBlock)
    ? Math.max(earliest, globalBlock)
    : earliest;
}

/** Une operation est-elle exigible maintenant ? */
export function isOperationDue(operation: RetryQueueOperationLike, nowMs: number): boolean {
  if (operation.terminal) return false;
  return dueAtMs(operation) <= nowMs;
}
