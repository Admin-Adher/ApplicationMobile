/**
 * Publication d'une file APRES sa persistance durable — module PUR.
 *
 * La chaine d'ecriture serialise les acces au disque, mais elle ne rend pas
 * atomique la sequence « calculer, ecrire, publier en memoire ». Entre le calcul
 * et la fin de l'ecriture, une saisie peut arriver :
 *
 *   file = [A] ; on calcule les survivantes = []
 *   l'ecriture de [] part
 *   l'utilisateur cree B — la file en memoire devient [A, B], et sa persistance
 *   s'enfile DERRIERE l'ecriture de []
 *   l'ecriture de [] se termine, on publie []
 *   la persistance de [A, B] se termine ensuite
 *
 * Resultat : le disque contient [A, B] alors que la memoire est vide. A
 * ressuscite au redemarrage malgre la purge, B disparait de l'interface, et la
 * sauvegarde suivante — calculee depuis la memoire — l'efface pour de bon.
 *
 * On compare donc la REFERENCE du tableau avant et apres l'ecriture. Si elle a
 * change, on recalcule sur la version la plus recente et on reecrit derriere
 * elle. Rien n'est publie tant que le disque n'est pas a jour.
 */

export interface PublishAfterDurableWriteInput<T> {
  /** Etat courant, relu a CHAQUE tentative. */
  readCurrent: () => readonly T[];
  /** Ce qu'il faut ecrire, calcule depuis l'etat courant. */
  compute: (current: readonly T[]) => T[];
  /** Ecriture STRICTE : elle doit rejeter si le disque refuse. */
  write: (next: T[]) => Promise<void>;
  /** Publication en memoire. Aucun `await` ne doit la separer du controle. */
  publish: (next: T[]) => void;
  /**
   * Leve si l'appelant n'est plus proprietaire du contexte — changement de
   * compte, par exemple. Verifie a chaque tour : une boucle de recalcul peut
   * enjamber ce changement, et ecrire sous une clef qui n'est plus la sienne.
   */
  assertCurrent?: () => void;
  maxAttempts?: number;
}

export async function publishAfterDurableWrite<T>(
  input: PublishAfterDurableWriteInput<T>,
): Promise<T[]> {
  const maxAttempts = input.maxAttempts ?? 8;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    input.assertCurrent?.();
    const current = input.readCurrent();
    const next = input.compute(current);

    // Un rejet remonte tel quel : l'appelant doit savoir que rien n'a ete
    // publie, et surtout ne pas annoncer un succes.
    await input.write(next);
    input.assertCurrent?.();

    // Une saisie est apparue pendant l'ecriture : on recommence sur la file la
    // plus recente, dont la persistance passera derriere celle-ci.
    if (input.readCurrent() !== current) continue;

    input.publish(next);
    return next;
  }

  throw new Error('Publication impossible : la file evolue continuellement.');
}
