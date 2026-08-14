import { describe, expect, it } from 'vitest';
import { pendingIdsForTable } from '../lib/offlineQueuePendingIds';
import { mergeWithCache } from '../lib/offlineCacheMerge';

describe('offline cache pending site-plan snapshots', () => {
  it('keeps the latest cached plan while its guarded replacement retry is queued', () => {
    const queue = [{
      table: 'site_plans',
      op: 'rpc' as const,
      data: { id: 'plan-1', annotations: [] },
      rpc: {
        fn: 'replace_site_plan_file_safely',
        args: { p_plan_id: 'plan-1', p_patch: { annotations: [] } },
      },
    }];
    const pendingIds = pendingIdsForTable(queue, 'site_plans');
    const staleServer = [{ id: 'plan-1', name: 'Plan', annotations: [{ id: 'stale' }] }];
    const latestCache = [{ id: 'plan-1', name: 'Plan', annotations: [] }];

    expect([...pendingIds]).toEqual(['plan-1']);
    expect(mergeWithCache(staleServer, latestCache, pendingIds)).toEqual(latestCache);
  });

  it('does not treat the guarded plan RPC as pending for another table', () => {
    const queue = [{
      table: 'site_plans',
      op: 'rpc' as const,
      rpc: { fn: 'replace_site_plan_file_safely', args: { p_plan_id: 'plan-1' } },
    }];
    expect(pendingIdsForTable(queue, 'reserves').size).toBe(0);
  });
});
