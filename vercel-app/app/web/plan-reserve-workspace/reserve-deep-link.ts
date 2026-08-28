const MAX_RESERVE_ID_LENGTH = 128;
const RESERVE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function normalizeReserveDeepLinkId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > MAX_RESERVE_ID_LENGTH || !RESERVE_ID_PATTERN.test(id)) return null;
  return id;
}

export function reserveIdFromHref(href: string): string | null {
  try {
    return normalizeReserveDeepLinkId(new URL(href).searchParams.get('reserve'));
  } catch {
    return null;
  }
}

export function hrefWithReserveId(href: string, reserveId: string | null): string {
  const url = new URL(href);
  const normalized = normalizeReserveDeepLinkId(reserveId);
  if (normalized) url.searchParams.set('reserve', normalized);
  else url.searchParams.delete('reserve');
  return `${url.pathname}${url.search}${url.hash}`;
}
