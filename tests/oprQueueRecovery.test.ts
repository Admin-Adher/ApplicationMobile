import { describe, expect, it } from 'vitest';
import { normalizeOprPayloadForSupabase } from '../lib/mappers';
import { recoverRejectedOprWrite } from '../lib/oprQueueRecovery';

const frenchTimestamp = '17/09/2026 15:39';
const isoTimestamp = new Date(2026, 8, 17, 15, 39).toISOString();
const operation = {
  id: 'queue-entry',
  queueEntryId: 'physical-entry',
  dispatchState: 'started',
  table: 'oprs',
  op: 'insert',
  terminal: true,
  terminalStatus: 'server_rejected',
  lastError: `[22008] — HTTP 400 — date/time field value out of range: "${frenchTimestamp}"`,
  attemptCount: 3,
  sameFailureCount: 3,
  nextAttemptAt: '2026-09-17T20:00:00Z',
  data: {
    id: 'OPR-existing',
    chantier_id: 'original-site',
    created_at: frenchTimestamp,
    date: '17/09/2026',
    signed_at: null,
    items: [{ id: 'original-item' }],
  },
};

describe('OPR creation timestamp', () => {
  it('converts the historical local timestamp while retaining the displayed date', () => {
    expect(normalizeOprPayloadForSupabase(operation.data)).toEqual({
      ...operation.data, created_at: isoTimestamp,
    });
    const canonical = { created_at: isoTimestamp };
    expect(normalizeOprPayloadForSupabase(canonical)).toBe(canonical);
    const impossible = { created_at: '31/02/2026 15:39' };
    expect(normalizeOprPayloadForSupabase(impossible)).toBe(impossible);
  });

  it('replays a proven 22008 rejection once using the same operation and OPR IDs', () => {
    const repaired = recoverRejectedOprWrite(operation);

    expect(repaired).toEqual({
      ...operation,
      data: { ...operation.data, created_at: isoTimestamp },
      terminal: false,
      terminalStatus: undefined,
      lastError: undefined,
      attemptCount: undefined,
      sameFailureCount: undefined,
      nextAttemptAt: undefined,
    });
    expect(recoverRejectedOprWrite(repaired)).toBe(repaired);
    expect(operation.data.created_at).toBe(frenchTimestamp);
  });

  it.each([
    { table: 'visites' },
    { op: 'update' },
    { lastError: '[42501] — HTTP 403 — permission denied' },
    { lastError: '[22008] — date/time field value out of range: "18/09/2026 15:39"' },
    { purgeState: 'pending' },
    { data: { ...operation.data, id: '' } },
  ])('leaves unrelated or unsafe entries untouched (%j)', patch => {
    const entry = { ...operation, ...patch };
    expect(recoverRejectedOprWrite(entry)).toBe(entry);
  });
});
