/**
 * Identite METIER d'une operation en file, et politique des identifiants
 * dupliques — module PUR.
 *
 * Le meme `id` peut apparaitre deux fois : reprise apres plantage, restauration
 * de sauvegarde, migration, ou deux appareils ayant genere le meme identifiant.
 * Les deux traitements existants sont dangereux :
 *
 *   - l'hydratation deduplique via un `Set<string>` d'identifiants et jette
 *     silencieusement les suivantes ;
 *   - la reconstruction marque un identifiant comme traite, si bien que DEUX
 *     entrees sortent de la file apres l'execution d'UNE seule.
 *
 * Dans les deux cas, une saisie utilisateur peut disparaitre sans trace.
 */

export interface QueueIdentityLike {
  id?: string;
  table?: string;
  op?: string;
  filter?: { column?: string; value?: unknown };
  data?: Record<string, unknown> | null;
  rpc?: { fn?: string; args?: Record<string, unknown> };
  conflictCheck?: unknown;
  commentPatch?: unknown;
  photoPatch?: unknown;
  baseVersion?: number | null;
  coalesceKey?: string;
}

/**
 * Champs qui decrivent CE QUE l'operation fait. Tout le reste — horodatages,
 * compteurs, dernier message d'erreur, echeance — decrit son HISTOIRE : deux
 * copies semantiquement identiques mais differemment reessayees doivent etre
 * reconnues comme identiques, sinon la quarantaine se declencherait sur des
 * doublons parfaitement benins.
 */
const BUSINESS_FIELDS = [
  'table',
  'op',
  'filter',
  'data',
  'rpc',
  'conflictCheck',
  'commentPatch',
  'photoPatch',
  'baseVersion',
  'coalesceKey',
] as const;

/** Leve quand le contenu ne peut pas etre compare de facon fiable. */
const UNREADABLE = Symbol('empreinte illisible');

/** Serialisation stable : l'ordre des cles d'un objet ne doit rien changer. */
function stableStringify(value: unknown, depth = 0): string {
  // Trop profond — souvent une reference circulaire. On ne tronque PAS : une
  // troncature rendrait deux payloads differents identiques, donc fusionnables.
  if (depth > 12) throw UNREADABLE;
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item, depth + 1)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item, depth + 1)}`).join(',')}}`;
}

/**
 * Empreinte du CONTENU metier, insensible a l'historique de reessai.
 *
 * Rend `null` quand le contenu ne peut pas etre compare de facon fiable. Ce
 * n'est pas un detail : on ne peut alors PAS prouver que deux entrees sont
 * identiques, et la politique doit donc les mettre en quarantaine plutot que
 * d'en fusionner deux qui different peut-etre.
 */
export function queueOperationFingerprint(operation: QueueIdentityLike): string | null {
  const business: Record<string, unknown> = {};
  for (const field of BUSINESS_FIELDS) {
    const value = (operation as Record<string, unknown>)[field];
    if (value !== undefined) business[field] = value;
  }

  try {
    return stableStringify(business);
  } catch {
    return null;
  }
}

export type DuplicateResolution =
  /** Meme identifiant ET meme contenu : une seule entree survit. */
  | { kind: 'deduplicated'; id: string; removed: number }
  /** Meme identifiant, contenus divergents : rien n'est execute ni supprime. */
  | { kind: 'quarantined'; id: string; entries: number };

export interface DuplicateReport<T> {
  operations: T[];
  resolutions: DuplicateResolution[];
}

/**
 * Combien de metadonnees d'echec une entree porte-t-elle ? A contenu metier
 * identique, on garde la plus informative : jeter celle qui porte l'historique
 * ferait perdre la trace de ce qui a deja ete tente.
 */
function informationScore(operation: Record<string, unknown>): number {
  let score = 0;
  for (const field of ['lastError', 'lastFailureAt', 'lastFailureFingerprint', 'failureClass', 'terminalOutcome']) {
    if (operation[field] !== undefined && operation[field] !== null) score += 1;
  }
  const attempts = Number(operation.attemptCount);
  if (Number.isSafeInteger(attempts) && attempts > 0) score += Math.min(attempts, 5);
  return score;
}

/**
 * Applique la politique des identifiants dupliques.
 *
 * L'ORDRE d'origine est preserve : une entree conservee reste a la place de la
 * PREMIERE occurrence de son identifiant, sinon une ecriture pourrait doubler
 * une autre ecriture sur le meme produit.
 */
export function resolveDuplicateQueueIds<T extends QueueIdentityLike & Record<string, unknown>>(
  operations: T[],
  mark: (operation: T, reason: 'duplicate_id_mismatch') => T,
): DuplicateReport<T> {
  const byId = new Map<string, T[]>();

  for (const operation of operations) {
    // Sans identifiant, rien ne permet d'affirmer qu'il s'agit du meme envoi :
    // ces entrees traversent sans etre regroupees.
    const id = typeof operation.id === 'string' && operation.id ? operation.id : null;
    if (!id) continue;
    const bucket = byId.get(id);
    if (bucket) bucket.push(operation);
    else byId.set(id, [operation]);
  }

  const resolutions: DuplicateResolution[] = [];
  const replacement = new Map<T, T[]>();
  const dropped = new Set<T>();

  for (const [id, bucket] of byId) {
    if (bucket.length < 2) continue;

    const fingerprints = bucket.map(queueOperationFingerprint);
    const comparable = fingerprints.every(fingerprint => fingerprint !== null);
    if (comparable && new Set(fingerprints).size === 1) {
      // Contenu identique : la duplication est un artefact, pas une donnee.
      const survivor = bucket.reduce((best, candidate) => (
        informationScore(candidate) > informationScore(best) ? candidate : best
      ));
      for (const entry of bucket) if (entry !== survivor) dropped.add(entry);
      replacement.set(bucket[0], [survivor]);
      resolutions.push({ kind: 'deduplicated', id, removed: bucket.length - 1 });
      continue;
    }

    // Contenus divergents — ou incomparables, ce qui revient au meme : on ne
    // peut pas prouver l'egalite. Deux ecritures reelles se disputent un identifiant
    // idempotent. En executer une choisirait arbitrairement laquelle perdre, et
    // en supprimer une detruirait une saisie. On ne fait donc NI l'un NI
    // l'autre : tout le groupe est mis de cote pour arbitrage humain.
    replacement.set(bucket[0], bucket.map(entry => mark(entry, 'duplicate_id_mismatch')));
    for (const entry of bucket.slice(1)) dropped.add(entry);
    resolutions.push({ kind: 'quarantined', id, entries: bucket.length });
  }

  if (resolutions.length === 0) {
    return { operations: [...operations], resolutions };
  }

  const rebuilt: T[] = [];
  for (const operation of operations) {
    const replaced = replacement.get(operation);
    if (replaced) {
      rebuilt.push(...replaced);
      continue;
    }
    if (dropped.has(operation)) continue;
    rebuilt.push(operation);
  }

  return { operations: rebuilt, resolutions };
}
