/**
 * Suppression manuelle de la file — coordinateur PUR.
 *
 * Extrait de la fermeture React parce que ce qui compte ici n'est pas la
 * logique mais l'ORDRE : quand le verrou est pris, ce qui se passe pendant une
 * attente, et ce qu'une invocation devenue obsolete a encore le droit de
 * toucher. Des assertions de source verifient qu'un appel existe ; elles ne
 * verifient pas qu'il precede le premier `await`.
 *
 * La suppression est TRANSACTIONNELLE. Supprimer d'abord et reconcilier
 * ensuite laissait une fenetre fatale : l'entree quittait la file et le disque,
 * puis un plantage — ou un simple echec de reconciliation — laissait le stock
 * optimiste local en desaccord avec le serveur, sans plus aucune operation pour
 * reparer l'ecart. Trois phases, chacune persistee :
 *
 *   1. marquer `pending_reconciliation` — l'entree cesse d'etre rejouable ;
 *   2. reconcilier les effets locaux, sans absorber la moindre erreur ;
 *   3. retirer definitivement ce qui a ete reconcilie.
 *
 * Une purge interrompue reprend a l'hydratation : la reconciliation est
 * idempotente, et la phase 1 est deja durable.
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

/** Etat durable d'une entree en cours de suppression. */
export const PURGE_PENDING_RECONCILIATION = 'pending_reconciliation';

/**
 * Preuve DURABLE qu'aucune requete n'est partie.
 *
 * Deduire cette preuve de l'absence de compteurs etait faux : une metadonnee
 * illisible, une file heritee d'une version anterieure au champ, ou une branche
 * d'echec qui n'incremente rien produisent toutes « aucune trace de tentative »
 * sans prouver qu'aucune ecriture n'a ete envoyee. Absence de preuve d'envoi
 * n'est pas preuve d'absence d'envoi.
 */
export type QueueDispatchState =
  /** Preuve EXPLICITE qu'aucune requete n'a ete envoyee pour cette ecriture. */
  | 'never_started'
  /**
   * Le sort anterieur n'est pas connu. C'est l'etat par defaut a l'entree en
   * file : plusieurs chemins tentent le serveur d'abord et n'enfilent qu'en cas
   * d'erreur. Ni supprimable, ni preuve de durabilite.
   */
  | 'unknown'
  /**
   * Etat strictement PERSISTE avant un appel reseau de la file.
   *
   * Il ne doit jamais etre pose a l'entree : la condition de la passe verrait
   * l'entree deja marquee et sauterait l'ecriture stricte, supprimant la
   * barriere meme qu'il represente.
   */
  | 'started';

export interface PurgeAmbiguityLike {
  terminal?: boolean;
  dispatchState?: QueueDispatchState;
}

/**
 * Cette operation peut-elle etre supprimee sans ambiguite serveur ?
 *
 * Un seul cas : l'etat durable affirme qu'aucune requete n'a jamais ete
 * preparee. Tout le reste — `started`, absent, inconnu, corrompu — est
 * conserve.
 *
 * Les refus TERMINAUX sont exclus de ce parcours. `terminal` dit que le sort
 * serveur est connu ; il ne dit rien de la coherence de l'etat local, et rien
 * ne demontre que leur reconciliation a abouti. Ils ont leur propre parcours,
 * « marquer comme examinee », qui reconcilie avant de supprimer.
 */
export function isUnambiguouslyPurgeableOperation(operation: PurgeAmbiguityLike): boolean {
  if (operation.terminal === true) return false;
  return operation.dispatchState === 'never_started';
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
  /** Sans ambiguite serveur ? Voir `isUnambiguouslyPurgeableOperation`. */
  isPurgeable: (operation: T) => boolean;
  /**
   * Existe-t-il de quoi annuler l'effet local de cette operation ?
   *
   * Sans compensateur, une entree portant un effet optimiste ne doit pas etre
   * supprimee : rien ne viendrait reparer l'ecart.
   */
  hasCompensator: (operation: T) => boolean;
  backup: (operations: readonly T[]) => Promise<void>;
  /** Ecriture stricte puis publication atomique. */
  persist: (compute: (current: readonly T[]) => T[]) => Promise<T[]>;
  /** Marque une entree comme en attente de reconciliation. */
  markPending: (operation: T) => T;
  /**
   * Annule l'effet optimiste local. Toute erreur REMONTE : absorber un echec
   * ici declarerait la purge reussie avec un cache incoherent.
   */
  reconcile: (operation: T) => Promise<void>;
  /** Remise a zero de l'etat de passe. Appelee UNIQUEMENT si encore proprietaire. */
  reset: (outcome: 'succeeded' | 'failed') => void;
  /** Finalisation proprietaire — replanification, notamment. */
  finalize?: (outcome: 'succeeded' | 'failed') => void;
}

export interface ManualQueuePurgeResult<T> {
  removed: T[];
  /** Deja envoyees, ou dont l'envoi ne peut pas etre exclu. */
  keptAmbiguous: T[];
  /** Apparues PENDANT la purge : elles ne sont pas concernees. */
  concurrentAdditions: T[];
  /** Sans identite physique : impossible de prouver qu'il s'agit de la meme. */
  keptWithoutIdentity: T[];
  /** Aucun moyen d'annuler leur effet local. */
  keptWithoutCompensator: T[];
}

/** Reprend une purge interrompue : phases 2 et 3 uniquement. */
export async function resumePendingQueuePurge<T>(input: {
  readCurrent: () => readonly T[];
  isPending: (operation: T) => boolean;
  entryIdOf: (operation: T) => string | null;
  persist: (compute: (current: readonly T[]) => T[]) => Promise<T[]>;
  reconcile: (operation: T) => Promise<void>;
}): Promise<T[]> {
  const pending = input.readCurrent().filter(input.isPending);
  if (pending.length === 0) return [];

  const reconciled: T[] = [];
  for (const operation of pending) {
    // Un echec laisse l'entree en attente : elle sera reprise au prochain
    // demarrage plutot que supprimee sans reparation.
    await input.reconcile(operation);
    reconciled.push(operation);
  }

  const reconciledIds = new Set(
    reconciled.map(input.entryIdOf).filter((value): value is string => value !== null),
  );
  await input.persist(current => current.filter(operation => {
    const entryId = input.entryIdOf(operation);
    return entryId === null || !reconciledIds.has(entryId);
  }));

  return reconciled;
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
    const snapshotIds = new Set(
      snapshot.map(input.entryIdOf).filter((value): value is string => value !== null),
    );

    const removable: T[] = [];
    const keptAmbiguous: T[] = [];
    const keptWithoutIdentity: T[] = [];
    const keptWithoutCompensator: T[] = [];

    for (const operation of snapshot) {
      if (input.entryIdOf(operation) === null) {
        keptWithoutIdentity.push(operation);
        continue;
      }
      if (!input.isPurgeable(operation)) {
        keptAmbiguous.push(operation);
        continue;
      }
      if (!input.hasCompensator(operation)) {
        keptWithoutCompensator.push(operation);
        continue;
      }
      removable.push(operation);
    }

    const removableIds = new Set(
      removable.map(input.entryIdOf).filter((value): value is string => value !== null),
    );

    await input.backup(removable);
    assertOwnership();

    // ── Phase 1 : marquage durable ────────────────────────────────────────
    // L'entree cesse d'etre rejouable AVANT toute reconciliation. Un plantage
    // a partir d'ici laisse une trace reprenable, pas une donnee perdue.
    await input.persist(current => current.map(operation => {
      const entryId = input.entryIdOf(operation);
      return entryId !== null && removableIds.has(entryId) ? input.markPending(operation) : operation;
    }));
    assertOwnership();

    // ── Phase 2 : reconciliation, sans absorber la moindre erreur ─────────
    const reconciled: T[] = [];
    for (const operation of removable) {
      await input.reconcile(operation);
      reconciled.push(operation);
      assertOwnership();
    }

    // ── Phase 3 : suppression definitive ──────────────────────────────────
    const reconciledIds = new Set(
      reconciled.map(input.entryIdOf).filter((value): value is string => value !== null),
    );
    const kept = await input.persist(current => current.filter(operation => {
      const entryId = input.entryIdOf(operation);
      return entryId === null || !reconciledIds.has(entryId);
    }));

    const concurrentAdditions = kept.filter(operation => {
      const entryId = input.entryIdOf(operation);
      return entryId !== null && !snapshotIds.has(entryId);
    });

    succeeded = true;
    return {
      removed: reconciled,
      keptAmbiguous,
      concurrentAdditions,
      keptWithoutIdentity,
      keptWithoutCompensator,
    };
  } finally {
    // Une invocation devenue obsolete ne touche RIEN : ni le verrou, ni le
    // statut du compte qui a pris la main entre-temps.
    if (input.isOwner()) {
      input.reset(succeeded ? 'succeeded' : 'failed');
      input.release();
      input.finalize?.(succeeded ? 'succeeded' : 'failed');
    }
  }
}
