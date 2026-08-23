import type { PassEntryKind, PassEntryResult } from './syncPassScheduler';
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
   * engendre se retrouverait apres lui.
   */
  sequence: number;
  source: QueueAdditionSource;
  operation: T;
}

export interface ReconstructSyncQueueInput<T> {
  snapshot: readonly T[];
  entries: readonly PassEntryResult<T>[];
  additions?: readonly QueueAddition<T>[];
  /** Marque une entree dont l'identifiant metier est contredit par une autre. */
  markQuarantined: (operation: T, reason: 'duplicate_id_mismatch') => T;
}

export interface ReconstructSyncQueueResult<T> {
  queue: T[];
  /** Entrees retirees parce qu'appliquees par le serveur. */
  removed: number;
  deduplicated: number;
  quarantined: number;
}

/** Issues qui CONSERVENT l'entree, avec la version rendue par l'executeur. */
const KEEPS_RESOLVED: ReadonlySet<PassEntryKind> = new Set<PassEntryKind>([
  'deferred',
  'terminal',
  'conflict',
  'abandon',
]);

export function reconstructSyncQueue<T extends QueueIdentityLike & Record<string, unknown>>(
  input: ReconstructSyncQueueInput<T>,
): ReconstructSyncQueueResult<T> {
  const byIndex = new Map<number, PassEntryResult<T>>();

  for (const entry of input.entries) {
    if (!Number.isInteger(entry.originalIndex)
      || entry.originalIndex < 0
      || entry.originalIndex >= input.snapshot.length) {
      // Contrat viole : une issue sans entree correspondante ne peut etre ni
      // appliquee ni ignoree sans choisir arbitrairement.
      throw new Error(`Reconstruction impossible : index ${entry.originalIndex} hors du snapshot.`);
    }
    if (byIndex.has(entry.originalIndex)) {
      throw new Error(`Reconstruction impossible : deux issues pour l'index ${entry.originalIndex}.`);
    }
    byIndex.set(entry.originalIndex, entry);
  }

  const rebuilt: T[] = [];
  let removed = 0;

  input.snapshot.forEach((operation, index) => {
    const entry = byIndex.get(index);

    // Aucune ligne de journal : l'entree n'etait pas rejouable — deja terminale,
    // ou en quarantaine. Elle reste exactement ou elle etait.
    if (!entry) {
      rebuilt.push(operation);
      return;
    }

    if (entry.kind === 'applied') {
      removed += 1;
      return;
    }

    if (KEEPS_RESOLVED.has(entry.kind)) {
      // `resolved` : l'executeur a pu enrichir l'operation — photos deja
      // televersees remplacees par leurs URLs distantes, patch reconstruit.
      // Reprendre le snapshot ferait re-televerser des fichiers deja envoyes.
      rebuilt.push(entry.resolved);
      return;
    }

    // `untouched` : jamais tentee. On reprend la version du SNAPSHOT, pas celle
    // du journal — l'ordonnanceur transmet l'operation a `execute`, qui peut la
    // muter, et ne promet donc aucune version d'origine.
    rebuilt.push(operation);
  });

  // Ordre d'EVENEMENT, pas ordre de categorie.
  const additions = [...(input.additions ?? [])].sort((a, b) => a.sequence - b.sequence);
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

  return { queue: resolved.operations, removed, deduplicated, quarantined };
}
