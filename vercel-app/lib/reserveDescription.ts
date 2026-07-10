const EMPTY_DESCRIPTION_PLACEHOLDERS = new Set([
  'Aucune description fournie.',
  'Aucune description fournie',
  'Position provisoire',
]);

export function getReserveDescriptionText(
  description?: string | null,
  title?: string | null,
  fallback = '—',
): string {
  const cleanDescription = String(description ?? '').trim();
  if (cleanDescription && !EMPTY_DESCRIPTION_PLACEHOLDERS.has(cleanDescription)) {
    return cleanDescription;
  }
  const cleanTitle = String(title ?? '').trim();
  return cleanTitle || fallback;
}

/**
 * True quand la réserve porte une VRAIE description (ni vide, ni placeholder,
 * ni simple recopie du titre). Sert à éviter de répéter le titre sous lui-même
 * dans la colonne Observation des rapports PDF.
 */
export function hasCustomReserveDescription(
  description?: string | null,
  title?: string | null,
): boolean {
  const cleanDescription = String(description ?? '').trim();
  if (!cleanDescription || EMPTY_DESCRIPTION_PLACEHOLDERS.has(cleanDescription)) return false;
  const cleanTitle = String(title ?? '').trim();
  return cleanDescription !== cleanTitle;
}
