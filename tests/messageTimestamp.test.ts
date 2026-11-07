import { describe, expect, it } from 'vitest';
import { messageDateKey, messageDateLabel, messageTime, parseMessageTimestamp } from '../lib/messageTimestamp';

const t = (key: string) => ({ 'channel.today': 'Aujourd’hui', 'channel.yesterday': 'Hier' })[key] ?? key;

describe('shared conversation timestamps', () => {
  it('groups ISO web messages with French mobile messages on the same local day', () => {
    const local = new Date(2026, 10, 7, 15, 20);
    const iso = local.toISOString();
    const french = '07/11/2026 15:20';
    expect(messageDateKey(iso)).toBe(messageDateKey(french));
    expect(messageTime(iso)).toBe('15:20');
    expect(messageTime(french)).toBe('15:20');
    expect(messageDateLabel(iso, t, 'fr', local)).toBe('Aujourd’hui');
    expect(messageDateLabel(french, t, 'fr', local)).toBe('Aujourd’hui');
  });
  it('uses local calendar days and calendar subtraction for yesterday', () => {
    const now = new Date(2026, 2, 30, 0, 5);
    const yesterday = new Date(2026, 2, 29, 23, 50);
    expect(messageDateLabel(yesterday.toISOString(), t, 'fr', now)).toBe('Hier');
    expect(messageDateKey(now.toISOString())).not.toBe(messageDateKey(yesterday.toISOString()));
  });
  it('converts an explicit UTC offset to device local time', () => {
    const text = '2026-11-07T00:20:00+05:00';
    const expected = new Date(text);
    expect(messageTime(text)).toBe(`${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`);
    expect(parseMessageTimestamp(text)?.getTime()).toBe(expected.getTime());
  });
  it('formats older day labels in the chosen language, without an ISO string', () => {
    const now = new Date(2026, 10, 7);
    expect(messageDateLabel('01/10/2026 09:15', t, 'en', now)).toContain('Oct');
    expect(messageDateLabel('2026-10-01T09:15:00Z', t, 'fr', now)).toContain('oct.');
  });
  it.each(['', 'garbage', '31/02/2026 10:00', '07/11/2026 25:30', '2026-11-07Tnot-a-time'])('handles malformed historical data: %s', value => {
    expect(parseMessageTimestamp(value)).toBeNull();
    expect(messageTime(value)).toBe('');
    expect(messageDateKey(value)).toBe(value);
  });
});
