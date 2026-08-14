export interface SyncQueueOperationLike {
  table?: string;
  terminal?: boolean;
  terminalStatus?: string;
  terminalOutcome?: SyncQueueTerminalOutcome;
  attemptCount?: number;
  rpc?: { fn?: string };
}

export type SyncQueueOperationDomain = 'inventory' | 'reserve' | 'plan' | 'generic';

export interface SyncQueueTerminalOutcome {
  domain: SyncQueueOperationDomain;
  status: string;
  message?: string;
  operationId?: string;
  productId?: string;
  movementId?: string;
  stockBefore?: number;
  stockAfter?: number;
  serverStock?: number;
  direction?: 'in' | 'out' | 'transfer' | 'adjustment';
  productName?: string;
  productReference?: string;
  quantity?: number;
  unit?: string;
  chantierId?: string;
  chantierName?: string;
  occurredAt?: string;
}

export interface SyncQueueCounts {
  pending: number;
  rejected: number;
  stuck: number;
  /** Operations requiring attention, without double-counting terminal failures. */
  attention: number;
}

const INVENTORY_RPC_NAMES = new Set([
  'record_inventory_movement',
  'update_inventory_product',
]);

const RESERVE_RPC_NAMES = new Set([
  'append_reserve_status_event',
  'apply_reserve_patch',
  'create_reserve_with_photos',
]);

const PLAN_RPC_NAMES = new Set([
  'create_site_plan_revision_with_reserve_migration',
  'replace_site_plan_file_safely',
]);

const INVENTORY_OUTCOME_TRANSLATION_KEYS: Record<string, string> = {
  insufficient_stock: 'networkQueue.inventoryOutcome.insufficient_stock',
  forbidden: 'networkQueue.inventoryOutcome.forbidden',
  invalid_payload: 'networkQueue.inventoryOutcome.invalid_payload',
  not_found: 'networkQueue.inventoryOutcome.not_found',
  product_not_found: 'networkQueue.inventoryOutcome.product_not_found',
  duplicate_product: 'networkQueue.inventoryOutcome.duplicate_product',
  duplicate_operation_mismatch: 'networkQueue.inventoryOutcome.duplicate_operation_mismatch',
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
      continue;
    }

    pending += 1;
    if ((operation.attemptCount ?? 0) >= 3) stuck += 1;
  }

  return { pending, rejected, stuck, attention: rejected + stuck };
}

export function getSyncQueueOperationDomain(operation: SyncQueueOperationLike): SyncQueueOperationDomain {
  const rpcName = operation.rpc?.fn;
  if (rpcName && INVENTORY_RPC_NAMES.has(rpcName)) return 'inventory';
  if (rpcName && RESERVE_RPC_NAMES.has(rpcName)) return 'reserve';
  if (rpcName && PLAN_RPC_NAMES.has(rpcName)) return 'plan';

  if (operation.table === 'inventory_products' || operation.table === 'inventory_movements') return 'inventory';
  if (operation.table === 'reserves' || operation.table === 'photos') return 'reserve';
  if (operation.table === 'site_plans') return 'plan';
  if (operation.terminalOutcome?.domain) return operation.terminalOutcome.domain;
  return 'generic';
}

export function isInventoryQueuedOperation(operation: SyncQueueOperationLike): boolean {
  return getSyncQueueOperationDomain(operation) === 'inventory';
}

export function inventoryOutcomeTranslationKey(operation: SyncQueueOperationLike): string | null;
export function inventoryOutcomeTranslationKey(
  status: string | null | undefined,
  operation?: SyncQueueOperationLike,
): string | null;
export function inventoryOutcomeTranslationKey(
  operationOrStatus: SyncQueueOperationLike | string | null | undefined,
  legacyOperation?: SyncQueueOperationLike,
): string | null {
  const operation = typeof operationOrStatus === 'object' && operationOrStatus !== null
    ? operationOrStatus
    : legacyOperation;
  if (!operation || getSyncQueueOperationDomain(operation) !== 'inventory') return null;

  const status = typeof operationOrStatus === 'string'
    ? operationOrStatus
    : operation.terminalOutcome?.status ?? operation.terminalStatus;
  if (!status) return null;
  return INVENTORY_OUTCOME_TRANSLATION_KEYS[status] ?? null;
}
