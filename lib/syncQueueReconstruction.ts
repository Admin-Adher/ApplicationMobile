import type { PassEntryKind, PassEntryResult } from './syncPassScheduler';
import {
  ensureQueueEntryIdentities,
  type QueueEntryIdentityLike,
} from './queueEntryIdentity';
import {
  resolveDuplicateQueueIds,
  type QueueIdentityLike,
} from './syncQueueIdentity';

/**
 * Reconstruction POSITIONNELLE de la file apres une passe — module PUR.
 *
 * Le moteur historique reconstruisait a partir des identifiants metier. C'est
 * intenable des lors qu'une operation peut changer d'identite : un rebase
 * remplace volontairement son `id`, deux entrees peuvent partager le meme, et
 * une operation enrichie n'a plus le meme contenu. Chaque entree est donc
 * retrouvee par sa POSITION dans le snapshot, jamais par ce qu'elle contient.
 *
 * Trois sources, et trois seulement :
 *
 *   snapshot   — la file telle qu'elle etait au debut de la passe ;
 *   entries    — le journal tokenise rendu par `runSyncPass` ;
 *   additions  — ce qui est apparu PENDANT la passe.
 *
 * Le journal fait AUTORITE. Il ne sert pas seulement a designer une entree : ce
 * qu'il dit de l'echeance prime sur ce que porte l'operation, sans quoi une
 * operation refusee garderait une ancienne date de reessai et une operation
 * differee perdrait celle que la politique vient de calculer.
 *
 * Les operations deja terminales ou en quarantaine n'entrent jamais dans
 * l'ordonnanceur : elles n'ont donc aucune ligne de journal, et c'est ici
 * qu'elles sont conservees a leur place.
 */

export type QueueAdditionSource =
  /** Engendree par l'execution — patch photo differe apres une reserve ecrite. */
  | 'spawned'
  /** Enfilee par l'utilisateur pendant que la passe tournait. */
  | 'concurrent_enqueue';

export interface QueueAddition<T> {
  /**
   * Compteur MONOTONE et unique de la passe.
   *
   * Deux blocs separes — « tous les engendres, puis tous les enfiles » —
   * changeraient l'ordre reel : une saisie faite avant qu'un patch photo soit
   * engendre se retrouverait apres lui. Deux sequences egales feraient dependre
   * le resultat de l'ordre du tableau, alors que le contrat annonce un ordre
   * total : elles sont donc refusees, pas departagees.
   */
  sequence: number;
  source: QueueAdditionSource;
  operation: T;
}

export interface ReconstructSyncQueueInput<T> {
  snapshot: readonly T[];
  entries: readonly PassEntryResult<T>[];
  additions?: readonly QueueAddition<T>[];
  /**
   * LE MEME predicat que celui remis a `runSyncPass`.
   *
   * Sans lui, une ligne manquante est supposee legitime : une regression de
   * l'ordonnanceur qui omettrait une operation rejouable passerait pour une
   * entree deja terminale, et l'operation serait rejouee indefiniment sans que
   * rien ne le signale.
   */
  isReplayable: (operation: T) => boolean;
  /** Marque une entree dont l'identifiant metier est contredit par une autre. */
  markQuarantined: (operation: T, reason: 'duplicate_id_mismatch') => T;
  /** Repare une collision d'identite LOCALE introduite par une addition. */
  newQueueEntryId: () => string;
}

export interface ReconstructSyncQueueResult<T> {
  queue: T[];
  /** Entrees retirees parce qu'appliquees par le serveur. */
  removed: number;
  deduplicated: number;
  quarantined: number;
  /** Collisions d'identite locale reparees apres les additions. */
  repairedIdentities: number;
}

function fail(detail: string): never {
  throw new Error(`Reconstruction impossible : ${detail}`);
}

/**
 * Version a persister pour une entree, ou `null` si elle quitte la file.
 *
 * Le `switch` est EXHAUSTIF : une issue inconnue injectee a l'execution doit
 * arreter la reconstruction, pas tomber dans une branche par defaut qui la
 * traiterait comme « jamais tentee ».
 */
function operationForEntry<T extends Record<string, unknown>>(
  original: T,
  entry: PassEntryResult<T>,
): T | null {
  // `T` est generique : l'acces direct a une propriete connue lui est refuse.
  // On travaille donc sur un enregistrement, restitue en `T` a la sortie.
  const copy = (): Record<string, unknown> => ({ ...entry.resolved });

  switch (entry.kind) {
    case 'applied':
      return null;

    case 'untouched':
      // Jamais tentee : on reprend la version du SNAPSHOT, pas celle du
      // journal — l'ordonnanceur transmet l'operation a `execute`, qui peut la
      // muter, et ne promet donc aucune version d'origine.
      return original;

    case 'deferred':
    case 'abandon': {
      // `resolved` : l'executeur a pu enrichir l'operation — photos deja
      // televersees remplacees par leurs URLs distantes, patch reconstruit.
      const next = copy();
      if (entry.nextAttemptAt) next.nextAttemptAt = entry.nextAttemptAt;
      else delete next.nextAttemptAt;
      return next as T;
    }

    case 'terminal':
    case 'conflict': {
      // Une operation refusee, ou rendue a la resolution de conflit, n'a
      // aucune prochaine tentative. Conserver une ancienne echeance afficherait
      // « refusee » et « prochaine tentative » sur la meme ligne.
      const next = copy();
      delete next.nextAttemptAt;
      delete next.retrySource;
      return next as T;
    }

    default: {
      const unknown: never = entry.kind;
      return fail(`issue de journal inconnue « ${String(unknown)} ».`);
    }
  }
}

function localIdentityOf(operation: Record<string, unknown>): string | null {
  const value = operation.queueEntryId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function reconstructSyncQueue<
  T extends QueueIdentityLike & QueueEntryIdentityLike & Record<string, unknown>,
>(
  input: ReconstructSyncQueueInput<T>,
): ReconstructSyncQueueResult<T> {
  const byIndex = new Map<number, PassEntryResult<T>>();
  const usedTokens = new Set<number>();

  for (const entry of input.entries) {
    // Le jeton EST l'index d'origine. Les exposer separement sans jamais
    // verifier leur accord laisserait passer une ligne contradictoire, et le
    // reconstructeur appliquerait l'issue a la mauvaise entree.
    if (entry.token !== entry.originalIndex) {
      fail(`jeton ${entry.token} incoherent avec l'index ${entry.originalIndex}.`);
    }
    if (usedTokens.has(entry.token)) fail(`jeton ${entry.token} duplique.`);
    usedTokens.add(entry.token);

    if (!Number.isInteger(entry.originalIndex)
      || entry.originalIndex < 0
      || entry.originalIndex >= input.snapshot.length) {
      fail(`index ${entry.originalIndex} hors du snapshot.`);
    }
    if (byIndex.has(entry.originalIndex)) {
      fail(`deux issues pour l'index ${entry.originalIndex}.`);
    }
    byIndex.set(entry.originalIndex, entry);
  }

  const rebuilt: T[] = [];
  let removed = 0;

  input.snapshot.forEach((operation, index) => {
    const entry = byIndex.get(index);
    const replayable = input.isReplayable(operation);

    // Le contrat de `runSyncPass` : une ligne par entree rejouable, aucune pour
    // les autres. Le verifier des DEUX cotes empeche une omission de passer
    // pour une entree deja terminale.
    if (replayable && !entry) fail(`issue absente pour l'index ${index}.`);
    if (!replayable && entry) fail(`issue presente pour une entree non rejouable (index ${index}).`);

    if (!entry) {
      rebuilt.push(operation);
      return;
    }

    const next = operationForEntry(operation, entry);
    if (next === null) {
      removed += 1;
      return;
    }

    // Le rebase change `id`, `baseVersion` et le payload — jamais l'identite
    // LOCALE. La laisser deriver ferait disparaitre l'ancrage physique sur
    // lequel repose toute la reconstruction.
    const before = localIdentityOf(operation);
    if (before && localIdentityOf(next) !== before) {
      fail(`queueEntryId modifie pour l'index ${index}.`);
    }

    rebuilt.push(next);
  });

  // Ordre d'EVENEMENT, pas ordre de categorie.
  const additions = [...(input.additions ?? [])];
  const usedSequences = new Set<number>();
  for (const addition of additions) {
    if (!Number.isSafeInteger(addition.sequence) || addition.sequence < 0) {
      fail(`sequence d'addition invalide (${String(addition.sequence)}).`);
    }
    if (usedSequences.has(addition.sequence)) {
      fail(`sequence d'addition dupliquee (${addition.sequence}).`);
    }
    usedSequences.add(addition.sequence);
  }
  additions.sort((a, b) => a.sequence - b.sequence);
  for (const addition of additions) rebuilt.push(addition.operation);

  // Nouvelle analyse APRES les additions : une operation engendree ou enfilee
  // peut introduire un identifiant deja present dans la file reconstruite.
  const resolved = resolveDuplicateQueueIds(rebuilt, input.markQuarantined);

  let deduplicated = 0;
  let quarantined = 0;
  for (const resolution of resolved.resolutions) {
    if (resolution.kind === 'deduplicated') deduplicated += resolution.removed;
    else quarantined += resolution.entries;
  }

  // Une addition peut porter une identite locale deja prise — generateur
  // defaillant, file heritee, operation engendree. Une collision locale se
  // repare : contrairement a un `id` metier duplique, elle n'a aucun effet sur
  // l'idempotence serveur.
  const identified = ensureQueueEntryIdentities(resolved.operations, input.newQueueEntryId);

  return {
    queue: identified.operations,
    removed,
    deduplicated,
    quarantined,
    repairedIdentities: identified.assigned + identified.repaired,
  };
}
