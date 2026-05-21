const EMPTY_DESCRIPTION_PLACEHOLDERS = new Set([
  'Aucune description fournie.',
  'Aucune description fournie',
  'Position provisoire',
]);

export function isReserveDescriptionMissing(description?: string | null): boolean {
  const cleanDescription = String(description ?? '').trim();
  return !cleanDescription || EMPTY_DESCRIPTION_PLACEHOLDERS.has(cleanDescription);
}

export function getReserveDescriptionText(
  description?: string | null,
  title?: string | null,
  fallback = '—',
): string {
  const cleanDescription = String(description ?? '').trim();
  if (!isReserveDescriptionMissing(cleanDescription)) {
    return cleanDescription;
  }
  const cleanTitle = String(title ?? '').trim();
  return cleanTitle || fallback;
}

export function hasCustomReserveDescription(description?: string | null, title?: string | null): boolean {
  const cleanDescription = String(description ?? '').trim();
  if (isReserveDescriptionMissing(cleanDescription)) return false;
  return cleanDescription !== String(title ?? '').trim();
}
