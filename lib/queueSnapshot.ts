/**
 * Instantané indépendant de la file — module PUR.
 *
 * `runSyncPass` transmet a `execute` les objets qu'on lui donne, et rien
 * n'empeche l'executeur d'en muter un payload imbrique. Reconstruire a partir
 * du MEME tableau reviendrait donc a comparer une chose a elle-meme.
 *
 * Le cas le plus insidieux n'est pas l'operation executee — sa version enrichie
 * est rendue par le journal — mais sa VOISINE : deux entrees peuvent partager
 * un objet imbrique. Muter celui de la premiere modifie alors la seconde, qui
 * n'a pourtant jamais ete tentee, et sa version « d'origine » serait fausse.
 *
 * Le clone passe par JSON, et non par `structuredClone`, parce que la file est
 * persistee en JSON : le clone doit refleter EXACTEMENT ce qui sera relu au
 * prochain demarrage. Un `structuredClone` conserverait des `Date` ou des `Map`
 * que la persistance perdrait, et le snapshot ne correspondrait plus au disque.
 *
 * Echec FERME : une valeur non serialisable arrete le clone plutot que de
 * produire une copie partielle sur laquelle on reconstruirait ensuite.
 */
export function cloneQueuedOperationsStrict<T>(operations: readonly T[]): T[] {
  try {
    return JSON.parse(JSON.stringify(operations)) as T[];
  } catch (error) {
    throw new Error(
      `Instantane de file impossible : ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
