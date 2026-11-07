import { describe, expect, it } from 'vitest';
import { reserveBatchOperation } from '../vercel-app/lib/reserve-batch';

const row = { id: 'reserve', version: 4, status: 'open', company: 'A', companies: ['A'], deadline: '2026-11-10' };
const context = { owner: 'owner', organization: 'org', author: 'Camille', id: 'operation', at: '2026-11-07T10:00:00Z', closedOn: '2026-11-07', createdAt: 1 };

describe('grouped reserve changes', () => {
  it('uses the versioned form transaction for status and its stable event', () => {
    const operation = reserveBatchOperation(row, { field: 'status', value: 'closed' }, context)!;
    expect(operation).toMatchObject({ kind: 'reserve_edit_full', payload: {
      id: 'operation', version: 4, reserveId: 'reserve', patch: {},
      event: { from_status: 'open', to_status: 'closed', actor_name: 'Camille', closed_at: '2026-11-07', history_entry: { id: 'operation' } },
    } });
    expect(reserveBatchOperation({ ...row, status: 'closed' }, { field: 'status', value: 'open' }, context)?.payload.event)
      .toMatchObject({ closed_at: null });
  });
  it('assigns companies through the protected form RPC without copying signatures or replacing history', () => {
    const operation = reserveBatchOperation({ ...row, enterprise_signature: 'old', history: ['existing'] }, { field: 'company', value: 'B' }, context)!;
    expect(operation.kind).toBe('reserve_edit_full');
    expect(operation.payload.patch).toEqual({ companies: ['B'], history: [expect.objectContaining({ id: 'operation', oldValue: 'A', newValue: 'B' })] });
    expect(operation.payload).not.toHaveProperty('event');
    expect(operation.payload.patch).not.toHaveProperty('enterprise_signature');
  });
  it('keeps the local closing date when the UTC timestamp belongs to the previous day', () => {
    const operation = reserveBatchOperation(row, { field: 'status', value: 'closed' }, { ...context, at: '2026-11-06T23:30:00Z' });
    expect(operation?.payload.event).toMatchObject({ closed_at: '2026-11-07' });
  });
  it('skips unchanged values but replaces a multi-company assignment explicitly', () => {
    expect(reserveBatchOperation(row, { field: 'company', value: 'A' }, context)).toBeNull();
    expect(reserveBatchOperation(row, { field: 'deadline', value: row.deadline }, context)).toBeNull();
    expect(reserveBatchOperation(row, { field: 'status', value: row.status }, context)).toBeNull();
    expect(reserveBatchOperation({ ...row, companies: ['A', 'B'] }, { field: 'company', value: 'A' }, context)).not.toBeNull();
  });
});
