import { describe, expect, it } from 'vitest';
import {
  getSyncQueueCounts,
  hasReplayableQueuedOperations,
  inventoryOutcomeTranslationKey,
  isInventoryQueuedOperation,
} from '../lib/syncQueuePolicy';

describe('sync queue policy', () => {
  it('does not count deterministic server rejections as pending work', () => {
    const queue = [
      { terminal: true, terminalStatus: 'insufficient_stock', attemptCount: 1 },
      { terminal: false, attemptCount: 0 },
      { attemptCount: 3 },
    ];

    expect(getSyncQueueCounts(queue)).toEqual({
      pending: 2,
      rejected: 1,
      stuck: 2,
    });
  });

  it('does not retry a queue containing only terminal failures', () => {
    expect(hasReplayableQueuedOperations([
      { terminal: true },
      { terminal: true, attemptCount: 4 },
    ])).toBe(false);

    expect(hasReplayableQueuedOperations([
      { terminal: true },
      { attemptCount: 4 },
    ])).toBe(true);
  });

  it('recognizes inventory RPCs and localizes known server outcomes', () => {
    expect(isInventoryQueuedOperation({ rpc: { fn: 'record_inventory_movement' } })).toBe(true);
    expect(isInventoryQueuedOperation({ rpc: { fn: 'update_inventory_product' } })).toBe(true);
    expect(isInventoryQueuedOperation({ rpc: { fn: 'create_reserve_with_photos' } })).toBe(false);
    expect(inventoryOutcomeTranslationKey('insufficient_stock')).toBe(
      'networkQueue.inventoryOutcome.insufficient_stock',
    );
    expect(inventoryOutcomeTranslationKey('future_status')).toBeNull();
  });
});
