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
  /**
   * Necessaire pour rattacher une ecriture generique a son entite : une photo
   * enfilee hors ligne porte son `reserve_id` ici, pas dans un filtre.
   */
  data?: Record<string, unknown>;
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

/** Plage maximale d'une Date JavaScript. */
const MAX_REPRESENTABLE_DATE_MS = 8.64e15;

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

/** Codes fabriques par le client : leur presence ne prouve aucune reponse. */
const CLIENT_SIDE_CODES = new Set(['REST_ABORTED', 'REST_TIMEOUT', 'MISSING_FILTER']);

/**
 * Codes systeme structures. Une erreur peut porter `code: 'ECONNRESET'` avec un
 * message quelconque (« socket closed ») : chercher uniquement dans le texte la
 * laissait tomber en `unknown`. Le code structure prime sur le texte.
 */
const TIMEOUT_ERROR_CODES = new Set(['REST_TIMEOUT', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);

const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
]);

/**
 * Classes SQLSTATE reellement definies par PostgreSQL.
 *
 * Accepter toute chaine alphanumerique de cinq caracteres reconnaissait aussi
 * des codes systeme locaux — EPERM, EBUSY, EINTR, ENXIO… — comme preuve qu'un
 * serveur avait repondu. Une erreur de fichier local aurait alors pu remettre a
 * zero le circuit reseau alors que le backend n'avait jamais ete contacte.
 */
const POSTGRES_SQLSTATE_CLASSES = new Set([
  '00', '01', '02', '03', '08', '09',
  '0A', '0B', '0F', '0L', '0P', '0Z',
  '20', '21', '22', '23', '24', '25',
  '26', '27', '28', '2B', '2D', '2F',
  '34', '38', '39', '3B', '3D', '3F',
  '40', '42', '44', '53', '54', '55',
  '57', '58', '72', 'F0', 'HV', 'P0', 'XX',
]);

function isServerIssuedCode(code: string): boolean {
  if (/^PGRST\d{3}$/.test(code)) return true;
  return /^[0-9A-Z]{5}$/.test(code) && POSTGRES_SQLSTATE_CLASSES.has(code.slice(0, 2));
}

/**
 * Unique definition de « le serveur a repondu ».
 *
 * Deux calculs divergents cohabitaient : la classification et la decision
 * pouvaient conclure l'inverse l'une de l'autre sur la meme erreur. Un statut
 * HTTP est la preuve la plus forte et prime sur un booleen contradictoire.
 */
export function failureReachedServer(error: unknown, meta?: SyncFailureTransportMeta): boolean {
  if (errorStatus(error, meta) > 0) return true;
  if (typeof meta?.reachedServer === 'boolean') return meta.reachedServer;
  const code = errorCode(error);
  if (!code || CLIENT_SIDE_CODES.has(code) || NETWORK_ERROR_CODES.has(code) || TIMEOUT_ERROR_CODES.has(code)) {
    return false;
  }
  return isServerIssuedCode(code);
}

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
  const hasServerVerdict = failureReachedServer(error, meta);

  // 1. Annulation demandee par l'appelant.
  if (code === 'REST_ABORTED') return 'cancelled';

  // 2. Authentification.
  if (status === 401 || code === 'PGRST301') return 'authentication';
  if (/jwt.*(?:expired|invalid)/.test(message) || /invalid.*jwt/.test(message)) {
    return 'authentication';
  }

  // 3. Limitation de debit — le serveur a repondu, ce n'est pas une panne reseau.
  if (status === 429) return 'rate_limited';

  // 4. Indisponibilite serveur — toute la plage 5xx, pas une liste fermee qui
  // laissait un HTTP 500 tomber en `unknown`.
  if (status >= 500 && status <= 599) return 'server_unavailable';

  // 5. Depassement de delai RENDU PAR LE SERVEUR. Ces motifs restent valables
  // meme avec une reponse HTTP : c'est le serveur lui-meme qui declare avoir
  // depasse son propre delai.
  if (status === 408) return 'timeout';
  if (code === '57014' || /statement timeout/.test(message) || /database.*tim(?:ed|e)\s*out/.test(message)) {
    return 'timeout';
  }

  // 6. Depassement de delai et coupure STRICTEMENT CLIENTS. Ces heuristiques ne
  // valent que si personne n'a repondu.
  //
  // Le probleme decouvert sur « aborted » n'etait pas propre a ce mot : c'est un
  // conflit general entre preuve structuree et heuristique textuelle. Un refus
  // `42501/403` dont le message contient « network error » etait requalifie en
  // coupure reseau, et aurait alimente le circuit au lieu d'etre traite comme un
  // refus deterministe.
  if (!hasServerVerdict) {
    if (TIMEOUT_ERROR_CODES.has(code)) return 'timeout';
    if (
      /^timeout after \d+ms$/.test(message)
      || /connection.*timeout/.test(message)
      || /\betimedout\b/.test(message)
    ) {
      return 'timeout';
    }

    if (NETWORK_ERROR_CODES.has(code)) return 'network';
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
      || /aborted/.test(message)
    ) {
      return 'network';
    }
  }

  // 7. Conflit metier.
  if (status === 409 || code === '23505' || /version_conflict/.test(message)) return 'conflict';

  // 8. Refus deterministe candidat.
  // Signature brute : l'ordre ci-dessus a deja ecarte auth, debit, panne
  // serveur, timeout et coupure. La version gardee de syncQueuePolicy
  // renverrait false ici, a cause de sa propre reconnaissance de « aborted ».
  // Le statut normalise est reinjecte : le helper ne lit que l'objet erreur et
  // ne verrait pas un `meta.status` fourni par la couche transport.
  if (hasDeterministicRefusalSignature({ code, status })) return 'permanent_candidate';

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
  // Seule une echeance non representable est rejetee. Un plafond arbitraire
  // etait pire que le mal : ignorer une consigne de 45 jours faisait retomber
  // sur le petit backoff client et reinterrogeait le serveur en une minute.
  // La borne reelle est la plage d'une Date JavaScript (±8.64e15 ms) : au-dela,
  // `new Date(...)` produirait une Invalid Date et `toISOString()` leverait.
  const targetMs = nowMs + delayMs;
  if (!Number.isFinite(targetMs) || Math.abs(targetMs) > MAX_REPRESENTABLE_DATE_MS) {
    return { delayMs: null, long: false };
  }

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
  /**
   * Compteur propre a la PORTEE de la politique. Sans lui, la duree d'un
   * blocage global — authentification, limitation de debit — dependrait du
   * nombre de tentatives de l'operation qui se trouve par hasard en tete de
   * file : deux pannes identiques donneraient des delais differents.
   */
  retryOrdinal?: number;
}

/** Derniere barriere : aucune entree externe ne doit pouvoir faire lever ce module. */
function toIsoOrNull(ms: number): string | null {
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_REPRESENTABLE_DATE_MS) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
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

  const reachedServer = failureClass === 'cancelled'
    ? false
    : failureReachedServer(failure.error, failure.meta);

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
    normalizeAttemptCount(input.retryOrdinal ?? operation?.attemptCount),
    Math.max(0, ladder.length - 1),
  );
  const baseDelayMs = ladder.length > 0 ? ladder[attemptIndex] : 0;

  // Jitter client symetrique : ±20 %, centre quand jitter = 0.5.
  const clientDelayMs = Math.round(baseDelayMs * (0.8 + 0.4 * jitter));
  const clientAttemptAtMs = nowMs + clientDelayMs;

  // Jitter serveur uniquement POSITIF : on n'avance jamais une echeance imposee.
  // `parseRetryAfter` a valide l'echeance BRUTE ; le jitter peut la pousser
  // hors plage. Dans ce cas on conserve exactement l'echeance serveur — le
  // jitter est un confort, pas une exigence, et `toISOString()` leverait.
  const serverBaseAtMs = retryAfter.delayMs !== null ? nowMs + retryAfter.delayMs : null;
  let serverAttemptAtMs: number | null = null;
  if (serverBaseAtMs !== null && retryAfter.delayMs !== null) {
    const jittered = serverBaseAtMs + Math.round(retryAfter.delayMs * 0.1 * jitter);
    serverAttemptAtMs = Math.abs(jittered) <= MAX_REPRESENTABLE_DATE_MS ? jittered : serverBaseAtMs;
  }

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
    nextAttemptAt: toIsoOrNull(nextAttemptAtMs),
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
  if (rpcFn === 'replace_site_plan_file_safely') {
    const planId = args.p_plan_id;
    if (planId) return `plan:${String(planId)}`;
  }
  // Une revision touche DEUX identites : le plan parent (`p_parent_plan_id`) et
  // le nouveau plan (`p_new_plan.id`). Une cle unique n'en couvrirait qu'une, et
  // une operation ciblant le nouveau plan pourrait depasser la creation de sa
  // propre revision. Tant que la selection ne gere qu'une cle par operation, on
  // serialise volontairement toute la table : debit reduit, ordre garanti.
  if (rpcFn === 'create_site_plan_revision_with_reserve_migration') {
    return 'table:site_plans';
  }

  const table = operation.table ?? 'inconnu';
  const ownId = operation.filter?.column === 'id' && operation.filter.value !== undefined
    ? operation.filter.value
    : operation.data?.id;

  // Les chemins generiques doivent produire la MEME cle que les RPC de la meme
  // entite. Sinon `create_reserve_with_photos(R7)` donnait `reserve:R7` tandis
  // qu'un `update reserves id=R7` donnait `reserves:R7` : deux groupes
  // distincts, et une ecriture pouvait depasser la creation dont elle depend.
  if (table === 'reserves' && ownId !== undefined) return `reserve:${String(ownId)}`;
  if (table === 'inventory_products' && ownId !== undefined) return `inventory:${String(ownId)}`;
  if (table === 'inventory_movements' && ownId !== undefined) return `inventory:${String(ownId)}`;
  if (table === 'site_plans' && ownId !== undefined) return `plan:${String(ownId)}`;

  // Une photo hors ligne transporte son rattachement dans `data`, pas dans un
  // filtre : sans cela elle formait son propre groupe et pouvait etre inseree
  // avant que sa reserve existe.
  if (table === 'photos') {
    const reserveId = operation.data?.reserve_id ?? operation.data?.reserveId;
    if (reserveId !== undefined && reserveId !== null) return `reserve:${String(reserveId)}`;
  }

  if (ownId !== undefined) return `${table}:${String(ownId)}`;
  // Repli conservateur : toute la table partage une file d'ordre.
  return `table:${table}`;
}

/**
 * Age dans la file. La comparaison lexicographique des chaines ne tient que si
 * toutes proviennent de `toISOString()` : un offset different, une migration
 * ancienne ou une date corrompue elisaient la mauvaise tete de groupe, donc un
 * depassement d'ordre. A donnee illisible, l'ordre persiste du tableau reste
 * autoritaire.
 */
function compareQueueAge(
  a: RetryQueueOperationLike,
  aIndex: number,
  b: RetryQueueOperationLike,
  bIndex: number,
): number {
  const aMs = Date.parse(a.queuedAt ?? '');
  const bMs = Date.parse(b.queuedAt ?? '');
  if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return aMs - bMs;
  return aIndex - bIndex;
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
    if (compareQueueAge(operation, index, current.operation, current.index) < 0) {
      headByKey.set(key, { operation, index });
    }
  });

  return [...headByKey.values()]
    .filter(entry => dueAtMs(entry.operation) <= nowMs)
    .sort((a, b) => {
      const priorityDiff = priorityOf(a.operation) - priorityOf(b.operation);
      if (priorityDiff !== 0) return priorityDiff;
      return compareQueueAge(a.operation, a.index, b.operation, b.index);
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

  // Meme comparateur que la selection des tetes : deux definitions de « la plus
  // ancienne » auraient pu armer le reveil sur une operation differente de celle
  // effectivement traitee.
  const headByKey = new Map<string, { operation: T; index: number }>();
  operations.forEach((operation, index) => {
    if (operation.terminal) return;
    const key = keyOf(operation);
    const current = headByKey.get(key);
    if (!current || compareQueueAge(operation, index, current.operation, current.index) < 0) {
      headByKey.set(key, { operation, index });
    }
  });

  if (headByKey.size === 0) return null;

  let earliest = Number.POSITIVE_INFINITY;
  for (const entry of headByKey.values()) {
    earliest = Math.min(earliest, Math.max(nowMs, dueAtMs(entry.operation)));
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
