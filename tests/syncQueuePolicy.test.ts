import { describe, expect, it } from 'vitest';
import {
  getSyncQueueCounts,
  getSyncQueueOperationDomain,
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
      stuck: 1,
      attention: 2,
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

  it('recognizes operation domains and only localizes inventory outcomes', () => {
    const inventory = {
      rpc: { fn: 'record_inventory_movement' },
      terminalStatus: 'insufficient_stock',
    };
    const reserve = {
      table: 'reserves',
      rpc: { fn: 'append_reserve_status_event' },
      terminalStatus: 'forbidden',
    };

    expect(isInventoryQueuedOperation(inventory)).toBe(true);
    expect(isInventoryQueuedOperation({ rpc: { fn: 'update_inventory_product' } })).toBe(true);
    expect(isInventoryQueuedOperation({ rpc: { fn: 'create_reserve_with_photos' } })).toBe(false);
    expect(getSyncQueueOperationDomain(inventory)).toBe('inventory');
    expect(getSyncQueueOperationDomain(reserve)).toBe('reserve');
    expect(getSyncQueueOperationDomain({ table: 'site_plans' })).toBe('plan');
    expect(getSyncQueueOperationDomain({ table: 'messages' })).toBe('generic');
    expect(inventoryOutcomeTranslationKey(inventory)).toBe(
      'networkQueue.inventoryOutcome.insufficient_stock',
    );
    expect(inventoryOutcomeTranslationKey(reserve)).toBeNull();
    expect(inventoryOutcomeTranslationKey({
      ...reserve,
      terminalOutcome: { domain: 'inventory' as const, status: 'forbidden' },
    })).toBeNull();
    expect(inventoryOutcomeTranslationKey('forbidden')).toBeNull();
    expect(inventoryOutcomeTranslationKey('insufficient_stock', inventory)).toBe(
      'networkQueue.inventoryOutcome.insufficient_stock',
    );
    expect(inventoryOutcomeTranslationKey({
      ...inventory,
      terminalStatus: 'duplicate_operation_mismatch',
    })).toBe('networkQueue.inventoryOutcome.duplicate_operation_mismatch');
    expect(inventoryOutcomeTranslationKey({ ...inventory, terminalStatus: 'future_status' })).toBeNull();
  });

  it('never retries terminal outcomes and does not also count them as stuck', () => {
    const queue = [
      { terminal: true, attemptCount: 7, terminalOutcome: { domain: 'inventory' as const, status: 'duplicate_operation_mismatch' } },
      { attemptCount: 3 },
    ];

    expect(hasReplayableQueuedOperations(queue)).toBe(true);
    expect(getSyncQueueCounts(queue)).toEqual({
      pending: 1,
      rejected: 1,
      stuck: 1,
      attention: 2,
    });
  });
});
