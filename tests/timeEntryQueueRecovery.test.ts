import { describe, expect, it } from 'vitest';
import { recoverRejectedTimeEntryWrite } from '../lib/timeEntryQueueRecovery';

const operation = {
  id: 'logical-operation', queueEntryId: 'physical-operation', dispatchState: 'started',
  table: 'time_entries', op: 'insert', terminal: true, terminalStatus: 'server_rejected',
  attemptCount: 3, sameFailureCount: 3, nextAttemptAt: '2026-11-07T16:00:00Z',
  lastError: "[PGRST204] — HTTP 400 — Could not find the 'updated_at' column of 'time_entries' in the schema cache",
  data: { id: 'TIME-local', organization_id: 'original-org', worker_name: 'Samir', updated_by: 'Chef', updated_at: null },
};

describe('pointage missing-column recovery', () => {
  it('retries the same operation and pointage once, preserving every field', () => {
    const repaired = recoverRejectedTimeEntryWrite(operation);
    expect(repaired).toMatchObject({ id: operation.id, queueEntryId: operation.queueEntryId,
      data: operation.data, terminal: false, timeEntryMetadataRecoveryVersion: 1 });
    expect(repaired.attemptCount).toBeUndefined();
    expect(repaired.lastError).toBeUndefined();
    expect(operation.terminal).toBe(true);
    expect(recoverRejectedTimeEntryWrite({ ...repaired, terminal: true,
      terminalStatus: 'server_rejected', lastError: operation.lastError })).toMatchObject({ terminal: true });
  });

  it('recovers an update by id after the equivalent SQL missing-column error', () => {
    const repaired = recoverRejectedTimeEntryWrite({ ...operation, op: 'update',
      filter: { column: 'id', value: 'TIME-local' }, lastError: '[42703] — column time_entries.updated_by does not exist' });
    expect(repaired.terminal).toBe(false);
    expect(repaired.filter).toEqual({ column: 'id', value: 'TIME-local' });
    expect(repaired.data).toEqual(operation.data);
  });

  it.each([
    { table: 'tasks' }, { op: 'delete' }, { terminal: false }, { purgeState: 'pending' },
    { lastError: '[42501] — permission denied for time_entries.updated_by' },
    { lastError: '[PGRST204] — Could not find the worker_name column of time_entries' },
    { lastError: '[PGRST204] — Could not find the updated_at column of other_table' },
    { data: { ...operation.data, id: '' } }, { timeEntryMetadataRecoveryVersion: 1 },
  ])('does not restart unrelated, already retried or unsafe entries (%j)', patch => {
    const entry = { ...operation, ...patch };
    expect(recoverRejectedTimeEntryWrite(entry)).toBe(entry);
  });
});
