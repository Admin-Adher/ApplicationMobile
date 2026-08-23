/**
 * Decoupe d'une echeance longue en tranches de minuterie sures — module PUR.
 *
 * `setTimeout` n'est fiable que sous 2^31-1 ms (~24,8 jours) : au-dela, le
 * comportement depend du runtime — ecretage, debordement du compteur signe, ou
 * declenchement quasi immediat. La politique P5 conserve volontairement les
 * `Retry-After` longs, et depuis que la boucle honore reellement les echeances
 * serveur, un tel delai peut atteindre le planificateur.
 *
 * On separe donc deux notions que le code confondait :
 *   l'echeance metier complete — ce que le diagnostic doit montrer ;
 *   la tranche physique       — ce qu'on confie a `setTimeout`, re-armee.
 */

/** Une heure : assez long pour ne pas multiplier les reveils, assez court pour rester sur. */
export const MAX_TIMER_SLICE_MS = 60 * 60 * 1000;

/** Au-dela, `new Date(ms).toISOString()` leve au lieu de rendre une date. */
export const MAX_REPRESENTABLE_DATE_MS = 8.64e15;

export interface TimerSlice {
  /** Duree du prochain `setTimeout`, toujours dans la plage sure. */
  sliceMs: number;
  /** L'echeance metier est-elle atteinte ? Sinon il faut re-armer. */
  due: boolean;
  /** Echeance reelle a afficher, ou null quand elle n'est pas representable. */
  targetIso: string | null;
}

/**
 * Ramene une echeance venue de l'exterieur dans le domaine du calculable.
 *
 * Strict sur le TYPE, contrairement a `normalizeAttemptCount` qui accepte une
 * chaine numerique : ce compteur-la sort d'un aller-retour JSON, ou "4" est une
 * valeur legitime, tandis qu'une echeance est le produit d'un calcul en memoire.
 * Y accepter une coercition ferait passer `null` pour l'epoque Unix — donc pour
 * une echeance echue — et relancerait la file immediatement au lieu d'attendre.
 */
export function normalizeTimerTarget(targetMs: unknown, nowMs: number, fallbackDelayMs: number): number {
  if (typeof targetMs !== 'number' || !Number.isFinite(targetMs)) {
    return nowMs + fallbackDelayMs;
  }
  // Une echeance deja passee est atteinte, pas une erreur : on ne la repousse pas.
  return Math.max(nowMs, Math.min(targetMs, MAX_REPRESENTABLE_DATE_MS));
}

export function computeTimerSlice(targetMs: number, nowMs: number): TimerSlice {
  const remainingMs = Number.isFinite(targetMs) ? Math.max(0, targetMs - nowMs) : 0;

  return {
    sliceMs: Math.min(remainingMs, MAX_TIMER_SLICE_MS),
    due: remainingMs <= 0,
    targetIso: Number.isFinite(targetMs) && Math.abs(targetMs) <= MAX_REPRESENTABLE_DATE_MS
      ? new Date(targetMs).toISOString()
      : null,
  };
}
