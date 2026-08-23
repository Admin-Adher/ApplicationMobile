/**
 * Serialisation des ecritures de la file d'attente — module PUR.
 *
 * Deux exigences opposees vivent ici, et les confondre a coute cher :
 *
 *   - la plupart des chemins sont BEST-EFFORT : un enqueue ne doit pas planter
 *     l'application parce que le disque est momentanement indisponible ;
 *   - la preparation d'une ecriture idempotente est STRICTE : si l'identite
 *     preparee n'atteint pas le disque, aucune requete ne doit partir. Sinon le
 *     serveur peut committer sous une identite que le prochain demarrage ne
 *     retrouvera pas, et la meme ecriture metier repart une seconde fois.
 *
 * L'implementation precedente journalisait l'echec puis RESOLVAIT : un
 * `await` sur cette promesse attendait un succes fabrique.
 *
 * Les ecritures restent serialisees entre elles — deux enqueue rapproches ne
 * doivent jamais laisser une ancienne version de la file finir apres la plus
 * recente — et un echec n'empoisonne pas la chaine pour les suivantes.
 */

export interface QueueWriteChain {
  /** Rend une promesse qui REJETTE reellement si l'ecriture echoue. */
  write(key: string, value: string): Promise<void>;
  /** Ne rejette jamais : chemins historiques, ou perdre l'ecriture est tolere. */
  writeBestEffort(key: string, value: string): Promise<void>;
}

export function createQueueWriteChain(
  setItem: (key: string, value: string) => Promise<void>,
  onError?: (error: unknown) => void,
): QueueWriteChain {
  let chain: Promise<void> = Promise.resolve();

  const write = (key: string, value: string): Promise<void> => {
    // Le maillon precedent peut avoir echoue : il ne doit pas condamner les
    // suivants, mais son rejet a deja ete rendu a SON appelant.
    const attempt = chain.catch(() => {}).then(() => setItem(key, value));

    // La chaine interne absorbe l'echec pour rester utilisable ; la promesse
    // rendue a l'appelant, elle, conserve le rejet.
    chain = attempt.catch(error => {
      onError?.(error);
    });

    return attempt;
  };

  return {
    write,
    writeBestEffort: (key, value) => write(key, value).catch(() => {}),
  };
}
