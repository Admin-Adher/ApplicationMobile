export function genId(prefix?: string): string {
  const id = Date.now().toString() + Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}-${id}` : id;
}

export function formatSize(bytes: number | undefined): string {
  if (!bytes) return '?';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/**
 * Formats a date string (ISO or dd/mm/yyyy) to dd/mm/yyyy HH:mm.
 * Locale-independent — does not rely on toLocaleString().
 */
export function formatDateTimeFR(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/**
 * Formats a date string (ISO or dd/mm/yyyy) to dd/mm/yyyy.
 * Locale-independent.
 */
export function formatDateFR(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Returns a locale-independent timestamp string: dd/mm/yyyy HH:mm
 */
export function nowTimestampFR(): string {
  return formatDateTimeFR(new Date());
}

/**
 * Formats a persisted timestamp for display: accepts both the canonical ISO
 * format (written by mobile and web) and legacy dd/mm/yyyy[ HH:mm] strings,
 * and renders them as dd/mm/yyyy[ HH:mm].
 */
export function formatTimestampFR(raw: string | undefined | null): string {
  if (!raw || raw === '—') return '—';
  if (/^\d{2}\/\d{2}\/\d{4}/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? formatDateFR(d) : formatDateTimeFR(d);
}

/**
 * Returns the ISO 8601 week number for a given date.
 * Week 1 is the week containing the first Thursday of the year.
 * Locale-independent and consistent across environments.
 */
export function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Returns the ISO 8601 week key string (e.g. "2025-W03") for a given date.
 * The ISO year is used (not the calendar year) so weeks near year-end are
 * correctly attributed to the next or previous year.
 * Useful for grouping dates by ISO week.
 */
export function getISOWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const n = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(n).padStart(2, '0')}`;
}
