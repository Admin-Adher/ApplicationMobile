import { Reserve } from '@/constants/types';

// Shared plan pin color rule (kept in sync with the web app):
//   - exactly 1 associated company → the company color
//   - 0 or 2+ companies → neutral gray
//   - company found but color unknown → fallback blue
export const PIN_NEUTRAL_COLOR = '#6B7280';
export const PIN_FALLBACK_COLOR = '#003082';

type CompanyLike = { name: string; color?: string | null };

/** Normalizes a company name for matching (trim + lowercase), like the web. */
export function normalizeCompanyName(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Reads every company name attached to a reserve, whatever the field used:
 * `companies[]`, `company`, plus the web-side `company_name`/`companyName`.
 * Names are deduplicated using normalized matching.
 */
export function getReserveCompanyNames(reserve: Reserve | null | undefined): string[] {
  if (!reserve) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const name = value.trim();
    const key = normalizeCompanyName(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  push(reserve.company);
  push((reserve as any).company_name);
  push((reserve as any).companyName);
  if (Array.isArray(reserve.companies)) reserve.companies.forEach(push);
  return names;
}

/** Resolves a single company name to its pin color using normalized matching. */
export function getCompanyPinColor(
  companyName: string | null | undefined,
  companies: CompanyLike[],
  fallback: string = PIN_FALLBACK_COLOR,
): string {
  const key = normalizeCompanyName(companyName);
  if (!key || key === '__mixed__') return PIN_NEUTRAL_COLOR;
  const match = companies.find(c => normalizeCompanyName(c.name) === key);
  return match?.color || fallback;
}

/** Applies the shared pin color rule to a reserve. */
export function getReservePinColor(
  reserve: Reserve | null | undefined,
  companies: CompanyLike[],
  fallback: string = PIN_FALLBACK_COLOR,
): string {
  const names = getReserveCompanyNames(reserve);
  if (names.length !== 1) return PIN_NEUTRAL_COLOR;
  return getCompanyPinColor(names[0], companies, fallback);
}
