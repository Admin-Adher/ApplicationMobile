export interface SyncQueueOperationLike {
  terminal?: boolean;
  attemptCount?: number;
  rpc?: { fn?: string };
}

export interface SyncQueueCounts {
  pending: number;
  rejected: number;
  stuck: number;
}

const INVENTORY_RPC_NAMES = new Set([
  'record_inventory_movement',
  'update_inventory_product',
]);

const INVENTORY_OUTCOME_TRANSLATION_KEYS: Record<string, string> = {
  insufficient_stock: 'networkQueue.inventoryOutcome.insufficient_stock',
  forbidden: 'networkQueue.inventoryOutcome.forbidden',
  invalid_payload: 'networkQueue.inventoryOutcome.invalid_payload',
  not_found: 'networkQueue.inventoryOutcome.not_found',
  product_not_found: 'networkQueue.inventoryOutcome.product_not_found',
  duplicate_product: 'networkQueue.inventoryOutcome.duplicate_product',
  server_rejected: 'networkQueue.inventoryOutcome.server_rejected',
};

export function isReplayableQueuedOperation(operation: SyncQueueOperationLike): boolean {
  return operation.terminal !== true;
}

export function hasReplayableQueuedOperations(queue: SyncQueueOperationLike[]): boolean {
  return queue.some(isReplayableQueuedOperation);
}

export function getSyncQueueCounts(queue: SyncQueueOperationLike[]): SyncQueueCounts {
  let pending = 0;
  let rejected = 0;
  let stuck = 0;

  for (const operation of queue) {
    if (operation.terminal) {
      rejected += 1;
      stuck += 1;
      continue;
    }

    pending += 1;
    if ((operation.attemptCount ?? 0) >= 3) stuck += 1;
  }

  return { pending, rejected, stuck };
}

export function isInventoryQueuedOperation(operation: SyncQueueOperationLike): boolean {
  return !!operation.rpc?.fn && INVENTORY_RPC_NAMES.has(operation.rpc.fn);
}

export function inventoryOutcomeTranslationKey(status: string | null | undefined): string | null {
  if (!status) return null;
  return INVENTORY_OUTCOME_TRANSLATION_KEYS[status] ?? null;
}
