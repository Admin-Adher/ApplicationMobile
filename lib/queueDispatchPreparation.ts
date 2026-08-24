import { publishAfterDurableWrite } from './queuePublication';

/**
 * Barriere de persistance avant tout transport — module PUR.
 *
 * Une entree ne doit jamais partir vers le serveur sans qu'une trace durable
 * n'existe deja sur le disque. Sinon un plantage entre l'envoi et la
 * persistance laisse une ecriture peut-etre commitee dont l'appareil ne garde
 * aucune preuve : ni pour la rejouer, ni pour reconcilier son effet local.
 *
 * Le piege a evite : marquer l'entree `started` DES l'entree en file. L'etat
 * dirait alors deux choses incompatibles — « une requete a peut-etre ete
 * tentee » et « la preuve correspondante est durable ». La condition de la
 * passe la verrait deja marquee et sauterait l'ecriture stricte, supprimant
 * precisement la barriere. D'ou le troisieme etat, `unknown`.
 *
 * La barriere RENVOIE la file qu'elle vient de securiser. Rendre un simple
 * verdict — « pret » — ne suffisait pas : l'appelant relisait alors l'etat
 * courant pour construire sa passe, et entre les deux lectures une saisie
 * pouvait s'inserer.
 *
 *   file = [A started] ; la barriere n'a rien a ecrire, elle rend « pret »
 *   B est enfilee en `unknown`, publiee en memoire, sauvegarde best-effort
 *   l'appelant relit l'etat courant : [A, B]
 *   B part vers le serveur sans etre jamais passee par l'ecriture stricte
 *
 * La meme fenetre existe apres une ecriture reussie. Le seul remede est que la
 * file transmise au moteur SOIT celle dont la durabilite vient d'etre etablie,
 * et aucune autre.
 */

export interface PreparedQueueForDispatch<T> {
  /**
   * La file EXACTE dont la durabilite vient d'etre etablie. C'est la seule
   * source autorisee pour la passe : toute entree apparue ensuite reste dans
   * l'etat courant, sera conservee comme ajout concurrent, et franchira
   * elle-meme la barriere a la passe suivante.
   */
  operations: readonly T[];
  /** Une ecriture stricte a-t-elle ete necessaire ? */
  proofWritten: boolean;
}

export interface PrepareQueueForDispatchInput<T> {
  readCurrent: () => readonly T[];
  /** L'entree a-t-elle besoin d'une preuve durable avant de pouvoir partir ? */
  needsProof: (operation: T) => boolean;
  markStarted: (operation: T) => T;
  /** Ecriture STRICTE : elle doit rejeter si le disque refuse. */
  writeStrict: (next: T[]) => Promise<void>;
  publish: (next: T[]) => void;
  /** Leve si la passe n'est plus la generation courante. */
  assertCurrent?: () => void;
}

/**
 * Rend la file dont plus aucune entree ne peut partir sans preuve durable.
 *
 * Toute erreur REMONTE : l'appelant doit renoncer a la passe, jamais poursuivre
 * en esperant que la preuve suivra.
 */
export async function prepareQueueForDispatch<T>(
  input: PrepareQueueForDispatchInput<T>,
): Promise<PreparedQueueForDispatch<T>> {
  // Verifie AVANT la lecture, y compris quand il n'y a rien a ecrire : une
  // passe devenue obsolete ne doit pas repartir avec la file d'un autre compte.
  input.assertCurrent?.();

  const initial = input.readCurrent();

  if (!initial.some(input.needsProof)) {
    return { operations: initial, proofWritten: false };
  }

  const durable = await publishAfterDurableWrite<T>({
    readCurrent: input.readCurrent,
    compute: current => current.map(operation => (
      input.needsProof(operation) ? input.markStarted(operation) : operation
    )),
    write: input.writeStrict,
    publish: input.publish,
    assertCurrent: input.assertCurrent,
  });

  return { operations: durable, proofWritten: true };
}
