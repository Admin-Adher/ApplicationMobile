/**
 * Suppression manuelle de la file — coordinateur PUR.
 *
 * Extrait de la fermeture React parce que ce qui compte ici n'est pas la
 * logique mais l'ORDRE : quand le verrou est pris, ce qui se passe pendant une
 * attente, et ce qu'une invocation devenue obsolete a encore le droit de
 * toucher. Des assertions de source verifient qu'un appel existe ; elles ne
 * verifient pas qu'il precede le premier `await`.
 */

/** La file est en cours de synchronisation : la purge ne peut pas commencer. */
export class QueuePurgeBusyError extends Error {
  constructor(message = 'Une synchronisation est en cours.') {
    super(message);
    this.name = 'QueuePurgeBusyError';
  }
}

/** L'invocation n'est plus proprietaire du contexte — changement de compte. */
export class QueuePurgeOwnershipError extends Error {
  constructor(message = 'Purge annulee : le compte actif a change.') {
    super(message);
    this.name = 'QueuePurgeOwnershipError';
  }
}

export interface PurgeAmbiguityLike {
  terminal?: boolean;
  attemptCount?: number;
  lastAttemptAt?: string;
  lastFailureAt?: string;
}

/**
 * Cette operation peut-elle etre supprimee sans ambiguite ?
 *
 * Deux cas SEULEMENT en sont depourvus :
 *
 *   - elle n'a jamais ete envoyee — aucune ecriture serveur ne peut lui
 *     correspondre, et son effet optimiste local peut etre annule sans risque ;
 *   - le serveur a explicitement rendu un refus — son effet a deja ete
 *     reconcilie a la reception.
 *
 * Tout le reste est ambigu : une ecriture tentee peut avoir abouti sans que sa
 * reponse soit parvenue. La supprimer laisserait le cache local en desaccord
 * avec le serveur, sans plus aucune operation pour reparer l'ecart.
 */
export function isUnambiguouslyPurgeableOperation(operation: PurgeAmbiguityLike): boolean {
  if (operation.terminal === true) return true;

  const attempts = Number(operation.attemptCount);
  const attempted = (Number.isFinite(attempts) && attempts > 0)
    || Boolean(operation.lastAttemptAt)
    || Boolean(operation.lastFailureAt);

  return !attempted;
}

export interface ManualQueuePurgeInput<T> {
  /**
   * Une passe active interdit la purge.
   *
   * Preempter ne suffirait pas : `AbortController` coupe le transport cote
   * client, il n'annule pas une transaction PostgreSQL. Le serveur peut avoir
   * commite juste avant de constater la fermeture. Supprimer l'operation
   * detruirait alors la seule trace locale de son `operation_id`, et
   * l'idempotence serveur n'aurait plus rien a trancher au rejeu.
   */
  isSyncing: () => boolean;
  /** Prise du verrou. SYNCHRONE, et avant toute attente. */
  acquire: () => void;
  release: () => void;
  /** Faux des que le compte actif a change. */
  isOwner: () => boolean;
  readCurrent: () => readonly T[];
  /** Identite PHYSIQUE : `id` peut etre partage ou remplace. */
  entryIdOf: (operation: T) => string | null;
  /**
   * Cette operation peut-elle etre supprimee sans ambiguite ?
   *
   * Une ecriture deja tentee peut avoir abouti sans que sa reponse soit
   * parvenue. La supprimer laisserait le cache optimiste local en desaccord
   * avec le serveur, sans plus aucune operation pour reparer l'ecart.
   */
  isPurgeable: (operation: T) => boolean;
  backup: (operations: readonly T[]) => Promise<void>;
  /** Ecriture stricte puis publication atomique. */
  persist: (compute: (current: readonly T[]) => T[]) => Promise<T[]>;
  /** Annule l'effet optimiste local des operations reellement supprimees. */
  reconcile: (removed: readonly T[]) => Promise<void>;
  /** Remise a zero de l'etat de passe. Appelee UNIQUEMENT si encore proprietaire. */
  reset: (outcome: 'succeeded' | 'failed') => void;
}

export interface ManualQueuePurgeResult<T> {
  removed: T[];
  kept: T[];
}

export async function runManualQueuePurge<T>(
  input: ManualQueuePurgeInput<T>,
): Promise<ManualQueuePurgeResult<T>> {
  if (input.isSyncing()) throw new QueuePurgeBusyError();

  const assertOwnership = () => {
    if (!input.isOwner()) throw new QueuePurgeOwnershipError();
  };
  assertOwnership();

  // AVANT le premier `await`. Sauvegarder d'abord laissait une fenetre pendant
  // laquelle une passe pouvait demarrer, une operation etre engendree, ou une
  // reponse reseau reconstruire la file.
  input.acquire();

  let succeeded = false;
  try {
    const snapshot = input.readCurrent();
    const removable = snapshot.filter(input.isPurgeable);
    const removableIds = new Set(
      removable.map(input.entryIdOf).filter((value): value is string => value !== null),
    );

    await input.backup(removable);
    assertOwnership();

    const kept = await input.persist(current => current.filter(operation => {
      const entryId = input.entryIdOf(operation);
      // Sans identite physique, on ne peut pas prouver qu'il s'agit de la meme
      // entree : on conserve.
      return entryId === null || !removableIds.has(entryId);
    }));
    assertOwnership();

    // Seulement ce qui a REELLEMENT quitte la file.
    const keptIds = new Set(kept.map(input.entryIdOf));
    const removed = removable.filter(operation => !keptIds.has(input.entryIdOf(operation)));

    await input.reconcile(removed);
    succeeded = true;
    return { removed, kept };
  } finally {
    // Une invocation devenue obsolete ne touche RIEN : ni le verrou, ni le
    // statut du compte qui a pris la main entre-temps.
    if (input.isOwner()) {
      input.reset(succeeded ? 'succeeded' : 'failed');
      input.release();
    }
  }
}
