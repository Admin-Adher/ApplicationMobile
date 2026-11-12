/** Shared by native and web: keep minutes exact and round only at display/export. */
export function attendanceMinutes(arrival: string, departure?: string): number {
  const minutes = (value: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const start = minutes(arrival);
  const end = minutes(departure ?? '');
  if (start === null || end === null || start === end) return 0;
  return end > start ? end - start : end + 1440 - start;
}

export function attendanceHoursText(hours: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, useGrouping: false }).format(hours);
}

export function attendanceCsv(rows: unknown[][], delimiter = ';'): string {
  const encode = (value: unknown) => {
    const text = String(value ?? '');
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? "'" + text : text;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(encode).join(delimiter)).join('\r\n') + '\r\n';
}
