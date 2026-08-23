import { sitePlanSnapshotCoalesceKey } from './plan-annotations/site-plan-write-policy';

import { mustSurviveCoalescing } from './syncQueuePolicy';

export interface CoalescibleQueuedOperation {
  coalesceKey?: string;
  /** Etats proteges : voir `mustSurviveCoalescing`. */
  purgeState?: string;
  terminal?: boolean;
  quarantined?: boolean;
}

export interface MigratableQueuedOperation extends CoalescibleQueuedOperation {
  table?: string;
  op?: string;
  filter?: { column?: string; value?: unknown };
  data?: Record<string, unknown>;
  rpc?: { fn?: string; args?: Record<string, unknown> };
}

const SITE_PLAN_REPLACEMENT_RPC = 'replace_site_plan_file_safely';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sitePlanIdForSnapshot(operation: MigratableQueuedOperation): string | null {
  if (operation.table !== 'site_plans') return null;
  if (operation.op === 'update' && operation.filter?.column === 'id') {
    const value = String(operation.filter.value ?? '').trim();
    return value || null;
  }
  if (operation.op === 'rpc' && operation.rpc?.fn === SITE_PLAN_REPLACEMENT_RPC) {
    const value = String(operation.rpc.args?.p_plan_id ?? '').trim();
    return value || null;
  }
  return null;
}

/**
 * Keeps only the newest snapshot for explicitly coalescible queue entries.
 * Operations without a key (inserts, deletes, RPCs, deltas) are preserved
 * verbatim and in order.
 */
export function coalesceQueuedOperations<T extends CoalescibleQueuedOperation>(
  operations: readonly T[],
): T[] {
  const newestIndexByKey = new Map<string, number>();
  operations.forEach((operation, index) => {
    // Une entree PROTEGEE ne participe pas : elle ne peut ni remplacer une
    // autre, ni etre remplacee. Emportee par le coalescing, une purge marquee
    // `pending_reconciliation` disparaitrait avant que son effet local soit
    // repare, et un refus non acquitte perdrait sa trace.
    if (mustSurviveCoalescing(operation)) return;
    const key = String(operation.coalesceKey ?? '').trim();
    if (key) newestIndexByKey.set(key, index);
  });

  return operations.filter((operation, index) => {
    if (mustSurviveCoalescing(operation)) return true;
    const key = String(operation.coalesceKey ?? '').trim();
    return !key || newestIndexByKey.get(key) === index;
  });
}

/**
 * Upgrades full site-plan snapshots persisted by versions that predate
 * coalesceKey. Anonymous keys are re-scoped when the queue is adopted by the
 * authenticated owner. If any snapshot in a group requires guarded file
 * replacement, that safety requirement is carried onto the newest payload.
 */
export function migrateAndCoalesceSitePlanSnapshots<T extends MigratableQueuedOperation>(
  operations: readonly T[],
  ownerId: string | null | undefined,
): T[] {
  const scopedOwnerId = String(ownerId ?? '').trim();
  if (!scopedOwnerId) return coalesceQueuedOperations(operations);

  const normalized = operations.map(operation => {
    const planId = sitePlanIdForSnapshot(operation);
    if (!planId) return operation;
    const anonymousKey = sitePlanSnapshotCoalesceKey(null, planId);
    const currentKey = String(operation.coalesceKey ?? '').trim();
    if (currentKey && currentKey !== anonymousKey) return operation;
    return {
      ...operation,
      coalesceKey: sitePlanSnapshotCoalesceKey(scopedOwnerId, planId),
    } as T;
  });

  const guardedKeys = new Set<string>();
  normalized.forEach(operation => {
    const key = String(operation.coalesceKey ?? '').trim();
    const legacyGuardedUpdate = operation.table === 'site_plans'
      && operation.op === 'update'
      && operation.data?.__replace_file_safely === true;
    if (
      key.startsWith('site-plan-snapshot:')
      && operation.table === 'site_plans'
      && (
        legacyGuardedUpdate
        || (operation.op === 'rpc' && operation.rpc?.fn === SITE_PLAN_REPLACEMENT_RPC)
      )
    ) {
      guardedKeys.add(key);
    }
  });

  const newestIndexByKey = new Map<string, number>();
  normalized.forEach((operation, index) => {
    const key = String(operation.coalesceKey ?? '').trim();
    if (key) newestIndexByKey.set(key, index);
  });

  const upgraded = normalized.map((operation, index) => {
    const key = String(operation.coalesceKey ?? '').trim();
    if (!guardedKeys.has(key) || newestIndexByKey.get(key) !== index) return operation;
    const planId = sitePlanIdForSnapshot(operation);
    const rawPayload = isRecord(operation.data)
      ? operation.data
      : isRecord(operation.rpc?.args?.p_patch)
        ? operation.rpc!.args!.p_patch as Record<string, unknown>
        : null;
    if (!planId || !rawPayload) return operation;
    const payload = { ...rawPayload };
    delete payload.__replace_file_safely;
    return {
      ...operation,
      table: 'site_plans',
      op: 'rpc',
      filter: undefined,
      data: payload,
      rpc: {
        fn: SITE_PLAN_REPLACEMENT_RPC,
        args: {
          p_plan_id: planId,
          p_patch: payload,
          p_reason: operation.rpc?.args?.p_reason ?? 'mobile_upgrade_site_plan_snapshot',
        },
      },
    } as T;
  });

  return coalesceQueuedOperations(upgraded);
}
