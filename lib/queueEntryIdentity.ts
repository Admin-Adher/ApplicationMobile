/**
 * Identite LOCALE des entrees de file — module PUR.
 *
 * Distincte de l'identifiant metier `id`, qui est connu du serveur et que le
 * rebase remplace volontairement. Elle existe parce qu'aucune des identites
 * disponibles ne survit a ce dont on a besoin :
 *
 *   - le jeton de `runSyncPass` ne vit que le temps d'une passe ;
 *   - `id` peut etre remplace en cours d'ecriture ;
 *   - deux entrees peuvent partager le meme `id` metier ;
 *   - une preemption oblige la generation suivante a retrouver EXACTEMENT la
 *     meme entree persistee.
 *
 * Elle n'a aucune signification serveur : elle n'entre ni dans l'empreinte
 * metier, ni dans l'export de diagnostic.
 */

export interface QueueEntryIdentityLike {
  queueEntryId?: string;
}

export interface QueueEntryIdentityReport<T> {
  operations: T[];
  /** Entrees migrees depuis une file persistee avant l'existence du champ. */
  assigned: number;
  /** Collisions d'identite LOCALE reparees. */
  repaired: number;
}

/**
 * Garantit que chaque entree porte une identite locale unique.
 *
 * Une collision ne merite pas de quarantaine : contrairement a un `id` metier
 * duplique, elle n'a aucun effet sur l'idempotence serveur. C'est une
 * metadonnee locale, on la repare — sans jamais toucher `id`.
 */
export function ensureQueueEntryIdentities<T extends QueueEntryIdentityLike>(
  operations: readonly T[],
  newId: () => string,
): QueueEntryIdentityReport<T> {
  const used = new Set<string>();
  let assigned = 0;
  let repaired = 0;

  const result = operations.map(operation => {
    const current = operation.queueEntryId;
    const valid = typeof current === 'string' && current.length > 0;

    if (valid && !used.has(current as string)) {
      used.add(current as string);
      return operation;
    }

    let candidate = newId();
    // `newId` peut, en principe, rendre deux fois la meme valeur.
    while (used.has(candidate)) candidate = newId();
    used.add(candidate);

    if (valid) repaired += 1;
    else assigned += 1;

    return { ...operation, queueEntryId: candidate };
  });

  return { operations: result, assigned, repaired };
}
