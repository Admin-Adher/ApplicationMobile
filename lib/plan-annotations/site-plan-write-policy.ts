export type SitePlanWriteSnapshot = {
  ownerId: string | null;
  planId: string;
  updatePayload: Record<string, unknown>;
  retryPayload: Record<string, unknown>;
  fileChanged: boolean;
};

export interface QueuedSitePlanSnapshotLike {
  coalesceKey?: string;
  rpc?: { fn?: string };
}

export function sitePlanWriteKey(ownerId: string | null | undefined, planId: string): string {
  return `${ownerId ?? 'anonymous'}:${String(planId)}`;
}

export function sitePlanSnapshotCoalesceKey(
  ownerId: string | null | undefined,
  planId: string,
): string {
  return `site-plan-snapshot:${sitePlanWriteKey(ownerId, planId)}`;
}

/**
 * Preserves the guarded file-replacement requirement across snapshots that
 * arrive while a previous write is still running. The newest complete payload
 * always wins; only the safety bit is cumulative until the queue succeeds.
 */
export function mergeSitePlanWriteSnapshots(
  previous: SitePlanWriteSnapshot,
  next: SitePlanWriteSnapshot,
): SitePlanWriteSnapshot {
  if (previous.ownerId !== next.ownerId || previous.planId !== next.planId) return next;
  return {
    ...next,
    fileChanged: previous.fileChanged || next.fileChanged,
  };
}

export function queuedSitePlanSnapshotRequiresFileReplacement(
  operations: readonly QueuedSitePlanSnapshotLike[],
  coalesceKey: string,
): boolean {
  return operations.some(operation => (
    operation.coalesceKey === coalesceKey
    && operation.rpc?.fn === 'replace_site_plan_file_safely'
  ));
}
