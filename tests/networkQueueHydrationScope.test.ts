import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../context/NetworkContext.tsx', import.meta.url).href),
  'utf8',
);

describe('tenant-aware queue hydration', () => {
  it('defers anonymous hydration while cold-start authentication is unresolved', () => {
    expect(source).toContain('const { user, isLoading: isAuthLoading } = useAuth();');

    const hydrationEffect = source.indexOf('// ── Hydrate queue when user.id changes');
    const authGuard = source.indexOf('if (!userId && isAuthLoading) return;', hydrationEffect);
    const targetKey = source.indexOf('const targetKey = userId ?', authGuard);

    expect(hydrationEffect).toBeGreaterThan(-1);
    expect(authGuard).toBeGreaterThan(hydrationEffect);
    expect(targetKey).toBeGreaterThan(authGuard);
    expect(source).toContain(
      '}, [userId, userOrganizationId, isAuthLoading, loadQueue]);',
    );
  });

  it('reloads on organization arrival only for a legacy recovery queue', () => {
    expect(source).toContain('const targetScope = queueHydrationScopeKey(');
    expect(source).toContain('queueNeedsHistoricalVisitRecoveryEvaluation(queueRef.current)');
    expect(source).toContain('if (lastLoadedScopeRef.current === targetScope) return;');
    expect(source).toContain(
      '}, [userId, userOrganizationId, isAuthLoading, loadQueue]);',
    );
  });

  it('does not read the large visit and reserve caches for normal mutations', () => {
    const eligibility = source.indexOf(
      'historicalEvaluationRequired = queueNeedsHistoricalVisitRecoveryEvaluation(eligibleQueue);',
    );
    const guardedPlanner = source.indexOf('if (userId && historicalEvaluationRequired) {', eligibility);
    const cacheRead = source.indexOf('readCache<Visite>(VISITES_CACHE_KEY, userId)', guardedPlanner);
    const planner = source.indexOf('const recovery = planHistoricalVisitRecovery({', cacheRead);

    expect(eligibility).toBeGreaterThan(-1);
    expect(guardedPlanner).toBeGreaterThan(eligibility);
    expect(cacheRead).toBeGreaterThan(guardedPlanner);
    expect(planner).toBeGreaterThan(cacheRead);
  });

  it('backs up the exact user-authorized terminal entries before omitting them', () => {
    const dismissal = source.indexOf(
      'const authorizedDismissal = dismissAuthorizedTerminalQueueEntries(coalesced);',
    );
    const backup = source.indexOf(
      "await backupQueue(authorizedDismissal.dismissed, 'user-authorized-terminal-dismissal');",
      dismissal,
    );
    const eligible = source.indexOf(
      'const eligibleQueue = authorizedDismissal.kept;',
      backup,
    );

    expect(dismissal).toBeGreaterThan(-1);
    expect(backup).toBeGreaterThan(dismissal);
    expect(eligible).toBeGreaterThan(backup);
  });

  it('records the completed scope only after the tenant-aware repair path', () => {
    const recovery = source.indexOf('const recovery = planHistoricalVisitRecovery({');
    const ownershipCheck = source.indexOf('assertHydrationOwner();', recovery);
    const completedScope = source.indexOf('lastLoadedScopeRef.current = queueHydrationScopeKey(');

    expect(recovery).toBeGreaterThan(-1);
    expect(ownershipCheck).toBeGreaterThan(recovery);
    expect(completedScope).toBeGreaterThan(ownershipCheck);
  });

  it('reevaluates only legacy recovery evidence before a manual retry', () => {
    const retry = source.indexOf('const retrySync = useCallback(async () => {');
    const gate = source.indexOf(
      'queueNeedsHistoricalVisitRecoveryEvaluation(queueRef.current)',
      retry,
    );
    const rehydrate = source.indexOf('await loadQueueRef.current?.();', retry);
    const replay = source.indexOf('await processSyncQueueRef.current();', retry);

    expect(retry).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(retry);
    expect(rehydrate).toBeGreaterThan(gate);
    expect(replay).toBeGreaterThan(rehydrate);
  });
});
