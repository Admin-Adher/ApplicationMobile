import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../context/NetworkContext.tsx', import.meta.url).href),
  'utf8',
);

describe('tenant-aware queue hydration', () => {
  it('does not treat the user-only hydration as final before organization arrives', () => {
    expect(source).toContain('const targetScope = queueHydrationScopeKey(');
    expect(source).toContain('if (lastLoadedScopeRef.current === targetScope) return;');
    expect(source).toContain('}, [userId, userOrganizationId, loadQueue]);');
  });

  it('records the completed scope only after the tenant-aware repair path', () => {
    const recovery = source.indexOf('const recovery = planHistoricalVisitRecovery({');
    const ownershipCheck = source.indexOf('assertHydrationOwner();', recovery);
    const completedScope = source.indexOf('lastLoadedScopeRef.current = queueHydrationScopeKey(');

    expect(recovery).toBeGreaterThan(-1);
    expect(ownershipCheck).toBeGreaterThan(recovery);
    expect(completedScope).toBeGreaterThan(ownershipCheck);
  });

  it('reevaluates durable recovery evidence before a manual retry', () => {
    const retry = source.indexOf('const retrySync = useCallback(async () => {');
    const rehydrate = source.indexOf('await loadQueueRef.current?.();', retry);
    const replay = source.indexOf('await processSyncQueueRef.current();', retry);

    expect(retry).toBeGreaterThan(-1);
    expect(rehydrate).toBeGreaterThan(retry);
    expect(replay).toBeGreaterThan(rehydrate);
  });
});
