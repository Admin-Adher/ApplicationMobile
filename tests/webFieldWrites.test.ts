import { describe, expect, it } from 'vitest';
import { fieldUpdate, projectFieldRows, sameFieldValue } from '../vercel-app/lib/web-field-writes';
import type { WebQueuedOperation } from '../vercel-app/lib/web-outbox';

const entry = { id: 'TIME-1', organization_id: 'org-1', worker_name: 'Camille', departure_time: null };

describe('web field writes', () => {
  it('projects a chain of saved offline changes without mutating the server snapshot', () => {
    const pending: WebQueuedOperation = {
      key: 'one', owner: 'user:org-1', kind: 'field_write', createdAt: 1,
      payload: {
        table: 'time_entries', writes: [
          fieldUpdate(entry, { departure_time: '16:30' }),
          fieldUpdate({ ...entry, departure_time: '16:30' }, { departure_time: '17:00' }),
        ],
      },
    };
    const original = [entry];
    expect(projectFieldRows(original, 'time_entries', [pending])).toEqual([{ ...entry, departure_time: '17:00' }]);
    expect(original[0].departure_time).toBeNull();
    expect(projectFieldRows(original, 'time_entries', [{ ...pending, error: 'Refus' }])).toBe(original);
    expect(projectFieldRows(original, 'journal_entries', [pending])).toBe(original);
  });

  it('accepts an already applied update after a lost response and respects array order', () => {
    expect(sameFieldValue([{ id: 'one', done: true }], [{ done: true, id: 'one' }])).toBe(true);
    expect(sameFieldValue(['one', 'two'], ['two', 'one'])).toBe(false);
    expect(sameFieldValue({ done: true }, { done: false })).toBe(false);
  });
});
