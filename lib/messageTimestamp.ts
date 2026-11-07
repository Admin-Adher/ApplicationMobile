// Both formats exist in shared conversations: older mobile French dates and
// ISO timestamps written by the web client. Display both in the device timezone.
export function parseMessageTimestamp(value: string): Date | null {
  const text = value?.trim();
  if (!text) return null;
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (fr) {
    const [, d, m, y, h = '0', min = '0', s = '0'] = fr;
    const date = new Date(+y, +m - 1, +d, +h, +min, +s);
    return date.getFullYear() === +y && date.getMonth() === +m - 1 && date.getDate() === +d
      && date.getHours() === +h && date.getMinutes() === +min && date.getSeconds() === +s ? date : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function messageDateKey(timestamp: string): string {
  const date = parseMessageTimestamp(timestamp);
  return date ? [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') : timestamp;
}

export function messageTime(timestamp: string): string {
  const date = parseMessageTimestamp(timestamp);
  return date ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '';
}

export function messageDateLabel(timestamp: string, t: (key: string) => string, language?: string, now = new Date()): string {
  const date = parseMessageTimestamp(timestamp);
  if (!date) return timestamp;
  const key = messageDateKey(timestamp);
  if (key === messageDateKey(now.toISOString())) return t('channel.today');
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === messageDateKey(yesterday.toISOString())) return t('channel.yesterday');
  const locale = language?.startsWith('en') ? 'en-GB' : language?.startsWith('es') ? 'es-ES' : 'fr-FR';
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
