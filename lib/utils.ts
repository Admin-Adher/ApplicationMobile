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
