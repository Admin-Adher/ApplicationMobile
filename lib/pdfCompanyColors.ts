import {
  getReserveCompanyNames,
  normalizeCompanyName,
  PIN_FALLBACK_COLOR,
  PIN_NEUTRAL_COLOR,
} from './planPinColor';

export type PdfCompany = { name: string; color?: string | null };
type ReserveCompanies = Parameters<typeof getReserveCompanyNames>[0];

export function getPdfCompanyPalette(companies: unknown): Map<string, string> {
  const palette = new Map<string, string>();
  if (Array.isArray(companies)) {
    for (const company of companies) {
      const name = normalizeCompanyName(company?.name);
      const color = safePdfColor(company?.color);
      if (name && color && !palette.has(name)) palette.set(name, color);
    }
  }
  return palette;
}

function safePdfColor(color: unknown): string | undefined {
  if (typeof color !== 'string') return undefined;
  const value = color.trim();
  return /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ? value : undefined;
}

export function getPdfReservePinColor(
  reserve: ReserveCompanies,
  palette: ReadonlyMap<string, string>,
): string {
  const names = getReserveCompanyNames(reserve);
  const key = normalizeCompanyName(names[0]);
  if (names.length !== 1 || key === '__mixed__') return PIN_NEUTRAL_COLOR;
  return palette.get(key) ?? PIN_FALLBACK_COLOR;
}

export function renderPdfCompanyLabel(name: unknown, palette: ReadonlyMap<string, string>): string {
  const text = String(name ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const color = palette.get(normalizeCompanyName(typeof name === 'string' ? name : undefined));
  if (!color) return text;
  // The SVG is foreground content, so it prints with background graphics disabled.
  return `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 10 10" style="vertical-align:baseline"><circle cx="5" cy="5" r="4.5" fill="${color}" stroke="#334155" stroke-opacity=".35"/></svg>&nbsp;${text}`;
}

export function renderPdfReserveCompanies(
  reserve: ReserveCompanies,
  palette: ReadonlyMap<string, string>,
  empty = '—',
): string {
  return getReserveCompanyNames(reserve).map(name => renderPdfCompanyLabel(name, palette)).join(', ')
    || renderPdfCompanyLabel(empty, palette);
}
