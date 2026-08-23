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
 *
 * L'identite manipulee ici est la POSITION dans le tableau, jamais la reference
 * objet : deux positions peuvent parfaitement contenir la MEME reference apres
 * une fusion de files, et raisonner par reference annulerait la protection
 * physique que le jeton de l'ordonnanceur apporte.
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

/** Leve des qu'une egalite ne peut plus etre PROUVEE. */
const UNREADABLE = Symbol('empreinte illisible');

/**
 * Budget de calcul. Une file corrompue peut porter un tableau de plusieurs
 * millions d'elements ; l'hydratation ne doit pas bloquer le fil d'execution.
 */
const MAX_DEPTH = 12;
const MAX_NODES = 20_000;
const MAX_LENGTH = 200_000;

/**
 * Serialisation stable et STRICTE.
 *
 * N'accepte que ce dont l'egalite est demontrable apres un aller-retour JSON :
 * `null`, booleen, chaine, nombre fini, tableau, objet plat. Tout le reste leve.
 *
 * Ce n'est pas de la pedanterie. `Object.entries(new Date(...))` rend `{}`,
 * donc deux dates DIFFERENTES produiraient la meme empreinte et seraient
 * fusionnees — une saisie perdue. Meme piege avec `Map`, `Set`, `RegExp` et
 * toute instance de classe. `NaN` et `Infinity` deviennent `null` en JSON,
 * indiscernables d'un vrai `null`.
 */
function stableStringify(value: unknown, budget: { nodes: number }, depth = 0): string {
  if (depth > MAX_DEPTH) throw UNREADABLE;
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES) throw UNREADABLE;

  if (value === null) return 'null';

  const type = typeof value;
  if (type === 'boolean' || type === 'string') return JSON.stringify(value) as string;
  if (type === 'number') {
    if (!Number.isFinite(value as number)) throw UNREADABLE;
    return JSON.stringify(value) as string;
  }
  if (type !== 'object') throw UNREADABLE;

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item, budget, depth + 1)).join(',')}]`;
  }

  // Objet PLAT uniquement : un prototype exotique cache un etat que
  // `Object.entries` ne voit pas.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw UNREADABLE;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item, budget, depth + 1)}`).join(',')}}`;
}

/**
 * Empreinte du CONTENU metier, insensible a l'historique de reessai.
 *
 * Rend `null` quand le contenu ne peut pas etre compare de facon fiable. Ce
 * n'est pas un detail : on ne peut alors PAS prouver que deux entrees sont
 * identiques, et la politique doit donc les mettre en quarantaine plutot que
 * d'en fusionner deux qui different peut-etre.
 *
 * La valeur rendue contient les payloads metier : elle ne doit jamais etre
 * persistee, journalisee ni exportee.
 */
export function queueOperationFingerprint(operation: QueueIdentityLike): string | null {
  const business: Record<string, unknown> = {};
  for (const field of BUSINESS_FIELDS) {
    const value = (operation as Record<string, unknown>)[field];
    if (value !== undefined) business[field] = value;
  }

  try {
    const serialized = stableStringify(business, { nodes: 0 });
    return serialized.length > MAX_LENGTH ? null : serialized;
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

// ─────────────────────────────────────────────────────────────────────────────
// Fusion conservatrice
// ─────────────────────────────────────────────────────────────────────────────

function validTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Rend la plus ancienne, ou la plus recente, des dates VALIDES rencontrees. */
function pickTime(values: unknown[], mode: 'oldest' | 'latest'): string | undefined {
  let best: { at: number; raw: string } | null = null;
  for (const value of values) {
    const at = validTime(value);
    if (at === null) continue;
    if (!best || (mode === 'oldest' ? at < best.at : at > best.at)) {
      best = { at, raw: value as string };
    }
  }
  return best?.raw;
}

function maxCount(values: unknown[]): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) continue;
    if (best === undefined || parsed > best) best = parsed;
  }
  return best;
}

/** Champs du bloc d'erreur : ils viennent tous de la MEME copie. */
const FAILURE_BLOCK = [
  'lastFailureAt',
  'lastError',
  'failureClass',
  'lastHttpStatus',
  'retrySource',
  'lastFailureFingerprint',
  'sameFailureCount',
] as const;

/**
 * Fusionne des copies au contenu metier IDENTIQUE.
 *
 * Choisir une copie entiere perdrait l'etat porte par l'autre : l'une peut
 * detenir le `queuedAt` le plus ancien et l'autre l'echec le plus recent. On
 * retient donc, champ par champ, la valeur la plus conservatrice — sauf le bloc
 * d'erreur, pris d'un seul tenant sur la copie portant le `lastFailureAt`
 * retenu. Melanger un message avec la classe d'une AUTRE erreur produirait un
 * diagnostic faux.
 */
function mergeIdenticalCopies<T extends Record<string, unknown>>(copies: T[]): T {
  const merged: Record<string, unknown> = { ...copies[0] };

  const queuedAt = pickTime(copies.map(copy => copy.queuedAt), 'oldest');
  if (queuedAt !== undefined) merged.queuedAt = queuedAt;

  const attemptCount = maxCount(copies.map(copy => copy.attemptCount));
  if (attemptCount !== undefined) merged.attemptCount = attemptCount;

  if (copies.some(copy => copy.terminal === true)) merged.terminal = true;
  if (copies.some(copy => copy.quarantined === true)) merged.quarantined = true;

  const terminalCopy = copies.find(copy => copy.terminal === true);
  if (terminalCopy?.terminalStatus !== undefined) merged.terminalStatus = terminalCopy.terminalStatus;

  const withOutcome = copies.find(copy => copy.terminalOutcome !== undefined && copy.terminalOutcome !== null);
  if (withOutcome) merged.terminalOutcome = withOutcome.terminalOutcome;

  const lastAttemptAt = pickTime(copies.map(copy => copy.lastAttemptAt), 'latest');
  if (lastAttemptAt !== undefined) merged.lastAttemptAt = lastAttemptAt;

  const nextAttemptAt = pickTime(copies.map(copy => copy.nextAttemptAt), 'latest');
  if (nextAttemptAt !== undefined) merged.nextAttemptAt = nextAttemptAt;

  const lastFailureAt = pickTime(copies.map(copy => copy.lastFailureAt), 'latest');
  const source = lastFailureAt === undefined
    ? copies.find(copy => copy.lastError !== undefined)
    : copies.find(copy => copy.lastFailureAt === lastFailureAt);
  if (source) {
    for (const field of FAILURE_BLOCK) merged[field] = source[field];
  }

  // Une operation refusee n'a aucune prochaine tentative.
  if (merged.terminal === true) {
    merged.nextAttemptAt = undefined;
    merged.retrySource = undefined;
  }

  return merged as T;
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
  const positionsById = new Map<string, number[]>();

  operations.forEach((operation, index) => {
    // Sans identifiant, rien ne permet d'affirmer qu'il s'agit du meme envoi :
    // ces entrees traversent sans etre regroupees.
    const id = typeof operation.id === 'string' && operation.id ? operation.id : null;
    if (!id) return;
    const positions = positionsById.get(id);
    if (positions) positions.push(index);
    else positionsById.set(id, [index]);
  });

  const resolutions: DuplicateResolution[] = [];
  const replacementByIndex = new Map<number, T[]>();
  const droppedIndices = new Set<number>();

  for (const [id, positions] of positionsById) {
    if (positions.length < 2) continue;

    const copies = positions.map(index => operations[index]);
    const fingerprints = copies.map(queueOperationFingerprint);
    const comparable = fingerprints.every(fingerprint => fingerprint !== null);

    if (comparable && new Set(fingerprints).size === 1) {
      // Contenu identique : la duplication est un artefact, pas une donnee.
      replacementByIndex.set(positions[0], [mergeIdenticalCopies(copies)]);
      for (const index of positions.slice(1)) droppedIndices.add(index);
      resolutions.push({ kind: 'deduplicated', id, removed: positions.length - 1 });
      continue;
    }

    // Contenus divergents — ou incomparables, ce qui revient au meme : on ne
    // peut pas prouver l'egalite. Deux ecritures reelles se disputent un
    // identifiant idempotent. En executer une choisirait arbitrairement
    // laquelle perdre, et en supprimer une detruirait une saisie. On ne fait
    // donc NI l'un NI l'autre : tout le groupe attend un arbitrage humain.
    replacementByIndex.set(positions[0], copies.map(copy => mark(copy, 'duplicate_id_mismatch')));
    for (const index of positions.slice(1)) droppedIndices.add(index);
    resolutions.push({ kind: 'quarantined', id, entries: positions.length });
  }

  if (resolutions.length === 0) {
    return { operations: [...operations], resolutions };
  }

  const rebuilt: T[] = [];
  operations.forEach((operation, index) => {
    const replaced = replacementByIndex.get(index);
    if (replaced) {
      rebuilt.push(...replaced);
      return;
    }
    if (droppedIndices.has(index)) return;
    rebuilt.push(operation);
  });

  return { operations: rebuilt, resolutions };
}
