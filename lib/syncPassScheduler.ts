import { selectEligibleOperationHeads, syncOrderingKey, type RetryQueueOperationLike } from './syncRetryPolicy';

/**
 * Ordonnanceur d'une passe de synchronisation — module PUR.
 *
 * Il decide QUELLE operation vient ensuite, quand la passe s'arrete et ce qui
 * est differe. Il ne sait pas EXECUTER une operation : l'appelant fournit
 * `execute`. C'est ce qui rend testable la garantie centrale, impossible a
 * exprimer sur une boucle enfouie dans un provider React.
 *
 * La garantie : une photographie unique des tetes de groupe ne traiterait
 * qu'UNE operation par groupe et par passe. Trente mouvements sur le meme
 * produit auraient alors demande trente passes, soit une version atténuée du
 * bug d'origine. Les tetes sont donc recalculees apres CHAQUE operation.
 */

export type PassOperationOutcome =
  /** Acceptee par le serveur : quitte la file de travail. */
  | { kind: 'applied' }
  /** Refus deterministe : ne sera plus rejouee. */
  | { kind: 'terminal' }
  /** Conflit remis a la logique metier : sort de la passe sans echeance. */
  | { kind: 'conflict' }
  /** Echec rejouable : reste en place, son groupe est bloque jusqu'a l'echeance. */
  | { kind: 'deferred'; nextAttemptAt?: string | null }
  /**
   * Portee globale : la passe entiere s'arrete. L'operation qui a declenche
   * l'abandon a bien ete tentee, elle est donc rapportee comme differee — la
   * classer « jamais touchee » perdrait son echeance et son compteur.
   */
  | { kind: 'abandon'; reason: 'backend' | 'authentication' | 'preempted'; nextAttemptAt?: string | null };

export type PassAbandonReason = 'backend' | 'authentication' | 'preempted' | 'operation_budget';

export interface RunSyncPassInput<T extends RetryQueueOperationLike> {
  operations: readonly T[];
  /** Injectee : l'ordonnanceur ne lit jamais l'horloge lui-meme. */
  now: () => number;
  execute: (operation: T) => Promise<PassOperationOutcome>;
  idOf: (operation: T) => string;
  orderingKey?: (operation: T) => string;
  priority?: (operation: T) => number;
  onProgress?: (done: number, total: number) => void;
  /** Une passe plus recente nous a-t-elle preemptes ? */
  isCurrentGeneration?: () => boolean;
  /** Garde-fou contre une boucle qui ne convergerait pas. */
  maxOperations?: number;
}

export interface RunSyncPassResult<T> {
  /** Operations executees, succes comme echecs. */
  processed: number;
  applied: T[];
  terminal: T[];
  conflicts: T[];
  /** Operations differees, avec l'echeance decidee par l'appelant. */
  deferred: { operation: T; nextAttemptAt: string | null }[];
  /** Operations jamais tentees : passe abandonnee, ou groupe bloque. */
  untouched: T[];
  abandoned: boolean;
  abandonReason: PassAbandonReason | null;
}

/**
 * Plafond de securite. Trente mouvements sur un produit sont normaux ; dix
 * mille tours signifient que `execute` ne fait pas progresser la file, et il
 * vaut mieux rendre la main que tourner indefiniment.
 */
const DEFAULT_MAX_OPERATIONS = 10_000;

/**
 * Echeance interne rendant une operation ineligible pour le RESTE de la passe,
 * sans etre persistee. Une operation differee doit rester a sa place : la
 * retirer de la liste ferait de la suivante du meme groupe la nouvelle tete,
 * donc un depassement d'ordre.
 */
const IN_PASS_DEFERRAL_MS = 24 * 60 * 60 * 1000;

export async function runSyncPass<T extends RetryQueueOperationLike>(
  input: RunSyncPassInput<T>,
): Promise<RunSyncPassResult<T>> {
  const {
    operations,
    now,
    execute,
    idOf,
    orderingKey = syncOrderingKey,
    priority,
    onProgress,
    isCurrentGeneration,
    maxOperations = DEFAULT_MAX_OPERATIONS,
  } = input;

  const applied: T[] = [];
  const terminal: T[] = [];
  const conflicts: T[] = [];
  const deferred: { operation: T; nextAttemptAt: string | null }[] = [];

  // Operations encore candidates. Les differees y restent, avec une echeance
  // interne qui les rend ineligibles sans changer leur position.
  let remaining: T[] = operations.filter(operation => !operation.terminal);
  const total = remaining.length;
  let processed = 0;
  let abandoned = false;
  let abandonReason: PassAbandonReason | null = null;

  const withoutId = (list: T[], id: string) => list.filter(operation => idOf(operation) !== id);

  while (true) {
    if (isCurrentGeneration && !isCurrentGeneration()) {
      abandoned = true;
      abandonReason = 'preempted';
      break;
    }

    if (processed >= maxOperations) {
      abandoned = true;
      abandonReason = 'operation_budget';
      break;
    }

    // Recalcul apres CHAQUE operation : des qu'une tete quitte la file, la
    // suivante de son groupe devient immediatement disponible dans la meme passe.
    const heads = selectEligibleOperationHeads({
      operations: remaining,
      nowMs: now(),
      orderingKey,
      priority,
    });
    if (heads.length === 0) break;

    const operation = heads[0];
    const id = idOf(operation);
    const outcome = await execute(operation);

    processed += 1;
    onProgress?.(processed, total);

    if (outcome.kind === 'applied') {
      applied.push(operation);
      remaining = withoutId(remaining, id);
      continue;
    }

    if (outcome.kind === 'terminal') {
      terminal.push(operation);
      remaining = withoutId(remaining, id);
      continue;
    }

    if (outcome.kind === 'conflict') {
      conflicts.push(operation);
      remaining = withoutId(remaining, id);
      continue;
    }

    if (outcome.kind === 'deferred') {
      const persisted = outcome.nextAttemptAt ?? null;
      deferred.push({ operation, nextAttemptAt: persisted });
      // Sans echeance exploitable, on en fabrique une INTERNE : l'operation doit
      // cesser d'etre eligible dans cette passe, sinon la boucle la reprendrait
      // indefiniment.
      const inPassDeadline = persisted && Date.parse(persisted) > now()
        ? persisted
        : new Date(now() + IN_PASS_DEFERRAL_MS).toISOString();
      remaining = remaining.map(candidate => (
        idOf(candidate) === id ? { ...candidate, nextAttemptAt: inPassDeadline } : candidate
      ));
      continue;
    }

    deferred.push({ operation, nextAttemptAt: outcome.nextAttemptAt ?? null });
    abandoned = true;
    abandonReason = outcome.reason;
    break;
  }

  const handledIds = new Set([
    ...applied.map(idOf),
    ...terminal.map(idOf),
    ...conflicts.map(idOf),
    ...deferred.map(entry => idOf(entry.operation)),
  ]);

  return {
    processed,
    applied,
    terminal,
    conflicts,
    deferred,
    // Renvoyees telles qu'a l'entree : jamais les copies porteuses d'une
    // echeance interne, qui ne doit pas etre persistee.
    untouched: operations.filter(operation => (
      !operation.terminal && !handledIds.has(idOf(operation))
    )),
    abandoned,
    abandonReason,
  };
}
