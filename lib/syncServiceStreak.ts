/**
 * Serie d'echecs consecutifs alimentant le disjoncteur — module PUR.
 *
 * La regle tient en une phrase difficile a appliquer par accident : la serie ne
 * repart de zero que sur une PREUVE que le backend repond, jamais sur une
 * simple absence d'echec.
 *
 * Trois nuances l'ont rendue fausse tour a tour :
 *
 *   - une erreur purement locale — patch malformé, fichier absent, payload
 *     invalide — n'a joint aucun serveur ; l'effacement systematique produisait
 *     « timeout, erreur locale, timeout » = 1 → 0 → 1, et le disjoncteur ne
 *     s'ouvrait jamais ;
 *   - un conflit de statut, lui, arrive APRES un `SELECT` reussi : le serveur a
 *     bel et bien repondu, la serie doit etre rompue ;
 *   - un `503` est egalement rendu PAR le serveur, mais il alimente
 *     deliberement la serie. C'est pourquoi le verdict d'echec impose sa propre
 *     valeur et n'est jamais reinterprete ici.
 */

/** Borne haute : une serie n'a pas besoin de croitre au-dela du seuil utile. */
const MAX_STREAK = 1_000;

export interface ServiceStreakInput {
  /** Serie AVANT cette operation. */
  current: number;
  /**
   * Serie rendue par le classificateur quand l'operation a ECHOUE. Elle fait
   * autorite : elle sait deja qu'un `503` compte et qu'un `429` ne compte pas.
   */
  failureStreak?: number | null;
  /** L'operation a ete acceptee par le serveur. */
  applied?: boolean;
  /**
   * Issue NON-echec prouvant que le backend repond — conflit observe, rebase
   * resolu par un verdict serveur. Sans preuve, la serie est conservee.
   */
  provesServerReachable?: boolean;
}

function normalize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MAX_STREAK);
}

export function nextServiceFailureStreak(input: ServiceStreakInput): number {
  // Un echec : le classificateur a deja tranche, on ne rejuge pas.
  if (typeof input.failureStreak === 'number') return normalize(input.failureStreak);
  if (input.applied === true || input.provesServerReachable === true) return 0;
  // Issue locale : elle ne prouve rien sur la sante du lien.
  return normalize(input.current);
}
