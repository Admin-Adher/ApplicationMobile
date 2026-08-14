export interface PendingIdQueuedOperation {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  data?: any;
  rpc?: { fn: string; args?: Record<string, any> };
  filter?: { column: string; value: string };
}

/** Returns rows whose local cache must remain authoritative during replay. */
export function pendingIdsForTable(
  queue: readonly PendingIdQueuedOperation[],
  table: string,
): Set<string> {
  const ids = new Set<string>();
  for (const operation of queue) {
    const rpcFn = operation.op === 'rpc' ? operation.rpc?.fn : undefined;
    if (table === 'reserves' && rpcFn === 'append_reserve_status_event') {
      const reserveId = operation.rpc?.args?.p_event?.reserve_id ?? operation.data?.id ?? operation.filter?.value;
      if (reserveId) ids.add(String(reserveId));
      continue;
    }
    if (table === 'reserves' && rpcFn === 'apply_reserve_patch') {
      const reserveId = operation.rpc?.args?.p_reserve_id ?? operation.data?.id ?? operation.filter?.value;
      if (reserveId) ids.add(String(reserveId));
      continue;
    }
    if (table === 'site_plans' && rpcFn === 'replace_site_plan_file_safely') {
      const planId = operation.rpc?.args?.p_plan_id ?? operation.data?.id ?? operation.filter?.value;
      if (planId) ids.add(String(planId));
      continue;
    }
    if (rpcFn === 'link_reserves_to_visite' || rpcFn === 'unlink_reserves_from_visite') {
      if (table === 'visites') {
        if (operation.data?.visite_id) ids.add(String(operation.data.visite_id));
        if (rpcFn === 'link_reserves_to_visite' && Array.isArray(operation.data?.previous_visite_ids)) {
          operation.data.previous_visite_ids.forEach((id: any) => {
            if (id) ids.add(String(id));
          });
        }
      }
      if (table === 'reserves' && Array.isArray(operation.data?.reserve_ids)) {
        operation.data.reserve_ids.forEach((id: any) => {
          if (id) ids.add(String(id));
        });
      }
      continue;
    }
    if (operation.table !== table) continue;
    if ((operation.op === 'insert' || operation.op === 'upsert') && operation.data?.id) {
      ids.add(String(operation.data.id));
    } else if (operation.op === 'update' && operation.filter?.column === 'id' && operation.filter.value) {
      ids.add(String(operation.filter.value));
    }
  }
  return ids;
}
