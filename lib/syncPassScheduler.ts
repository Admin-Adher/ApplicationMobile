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
 * produit auraient alors demande trente passes, soit une version attenuee du
 * bug d'origine. Les tetes sont donc recalculees apres CHAQUE operation.
 */

export type PassOperationOutcome<T> =
  /** Acceptee par le serveur : quitte la file de travail. */
  | { kind: 'applied'; operation?: T }
  /** Refus deterministe : ne sera plus rejouee. */
  | { kind: 'terminal'; operation?: T }
  /** Conflit remis a la logique metier : sort de la passe sans echeance. */
  | { kind: 'conflict'; operation?: T }
  /** Echec rejouable : son groupe est ferme pour le reste de la passe. */
  | { kind: 'deferred'; operation?: T; nextAttemptAt?: string | null }
  /**
   * Portee globale : la passe entiere s'arrete. L'operation qui a declenche
   * l'abandon a bien ete tentee, elle est donc rapportee comme differee — la
   * classer « jamais touchee » perdrait son echeance et son compteur.
   */
  | {
    kind: 'abandon';
    operation?: T;
    reason: 'backend' | 'authentication' | 'preempted';
    nextAttemptAt?: string | null;
  };

/**
 * Issues autorisees apres une EXCEPTION.
 *
 * `applied` en est exclu : une exception ne prouve jamais qu'une operation peut
 * quitter la file. Une reponse perdue apres un commit serveur doit rester
 * differee avec le meme `operation_id`, et c'est l'idempotence serveur qui
 * tranchera au rejeu — jamais une supposition du client.
 */
export type PassExecutionErrorOutcome<T> = Exclude<PassOperationOutcome<T>, { kind: 'applied' }>;

export type PassAbandonReason = 'backend' | 'authentication' | 'preempted' | 'operation_budget';

export interface RunSyncPassInput<T extends RetryQueueOperationLike> {
  operations: readonly T[];
  /** Injectee : l'ordonnanceur ne lit jamais l'horloge lui-meme. */
  now: () => number;
  execute: (operation: T) => Promise<PassOperationOutcome<T>>;
  /**
   * Traduit une exception echappee de `execute` en issue.
   *
   * OBLIGATOIRE. Sans lui, une seule branche non protegee ferait rejeter toute
   * la passe : les operations deja appliquees ne seraient plus rapportees, et
   * l'appelant devrait deviner ce qui a ete fait avant de persister.
   */
  onExecuteError: (
    operation: T,
    error: unknown,
  ) => PassExecutionErrorOutcome<T> | Promise<PassExecutionErrorOutcome<T>>;
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
  /** Operations jamais tentees : passe abandonnee, ou groupe ferme. */
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
 * Jeton interne d'identite.
 *
 * Retirer une operation par son identifiant metier supprimait TOUTES les
 * entrees le partageant : une file corrompue ou migree contenant deux fois le
 * meme id voyait la seconde disparaitre sans avoir ete ni executee ni refusee,
 * exactement le defaut que ce moteur cherche a eviter. L'identite interne d'une
 * entree du tableau ne doit donc rien devoir a son contenu.
 */
type Tracked<T> = T & { readonly __passToken: number };

export async function runSyncPass<T extends RetryQueueOperationLike>(
  input: RunSyncPassInput<T>,
): Promise<RunSyncPassResult<T>> {
  const {
    operations,
    now,
    execute,
    onExecuteError,
    orderingKey = syncOrderingKey as (operation: T) => string,
    priority,
    onProgress,
    isCurrentGeneration,
    maxOperations = DEFAULT_MAX_OPERATIONS,
  } = input;

  const applied: T[] = [];
  const terminal: T[] = [];
  const conflicts: T[] = [];
  const deferred: { operation: T; nextAttemptAt: string | null }[] = [];

  /** Version courante de chaque entree : `execute` peut la transformer. */
  const currentByToken = new Map<number, T>();
  const handledTokens = new Set<number>();
  const orderedTokens: number[] = [];

  let remaining: Tracked<T>[] = [];
  operations.forEach((operation, index) => {
    if (operation.terminal) return;
    currentByToken.set(index, operation);
    orderedTokens.push(index);
    remaining.push({ ...operation, __passToken: index } as Tracked<T>);
  });

  /**
   * Groupes fermes pour le RESTE de la passe.
   *
   * Une echeance fabriquee ne suffisait pas : sur une passe longue, l'horloge
   * pouvait depasser l'echeance reelle d'une operation differee et la rendre a
   * nouveau eligible, donc la retenter — et consommer une tentative de plus
   * avant meme le reveil global.
   */
  const blockedKeys = new Set<string>();

  const total = remaining.length;
  let processed = 0;
  let abandoned = false;
  let abandonReason: PassAbandonReason | null = null;

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
    }).filter(candidate => !blockedKeys.has(orderingKey(candidate)));

    if (heads.length === 0) break;

    const token = heads[0].__passToken;
    const operation = currentByToken.get(token) as T;
    // Retenue AVANT execution : `execute` peut renvoyer une version enrichie, et
    // rien dans le contrat generique ne garantit que sa cle d'ordre soit stable.
    const selectedKey = orderingKey(operation);

    let outcome: PassOperationOutcome<T>;
    try {
      outcome = await execute(operation);
    } catch (error) {
      outcome = await onExecuteError(operation, error);
    }

    processed += 1;
    onProgress?.(processed, total);

    // `execute` a pu enrichir l'operation : photos deja televersees remplacees
    // par leurs URLs distantes, arguments RPC prepares, patch reconstruit. Perdre
    // cette version ferait re-televerser des fichiers deja envoyes.
    const resolved = outcome.operation ?? operation;
    currentByToken.set(token, resolved);
    handledTokens.add(token);

    const dropFromRemaining = () => {
      remaining = remaining.filter(candidate => candidate.__passToken !== token);
    };

    if (outcome.kind === 'applied') {
      applied.push(resolved);
      dropFromRemaining();
      continue;
    }

    if (outcome.kind === 'terminal') {
      terminal.push(resolved);
      dropFromRemaining();
      continue;
    }

    if (outcome.kind === 'conflict') {
      conflicts.push(resolved);
      dropFromRemaining();
      continue;
    }

    if (outcome.kind === 'deferred') {
      deferred.push({ operation: resolved, nextAttemptAt: outcome.nextAttemptAt ?? null });
      // Les DEUX cles : si une transformation deplacait l'operation vers un
      // autre groupe, celui d'origine serait reste ouvert et son operation
      // suivante aurait pu passer devant.
      blockedKeys.add(selectedKey);
      blockedKeys.add(orderingKey(resolved));
      remaining = remaining.map(candidate => (
        candidate.__passToken === token
          ? { ...resolved, __passToken: token } as Tracked<T>
          : candidate
      ));
      continue;
    }

    deferred.push({ operation: resolved, nextAttemptAt: outcome.nextAttemptAt ?? null });
    abandoned = true;
    abandonReason = outcome.reason;
    break;
  }

  return {
    processed,
    applied,
    terminal,
    conflicts,
    deferred,
    // Jamais les copies porteuses du jeton interne, qui ne doit pas etre persiste.
    untouched: orderedTokens
      .filter(token => !handledTokens.has(token))
      .map(token => currentByToken.get(token) as T),
    abandoned,
    abandonReason,
  };
}
