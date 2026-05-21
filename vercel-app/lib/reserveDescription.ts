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
