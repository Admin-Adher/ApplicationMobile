import { describe, expect, it } from 'vitest';
import {
  planHistoricalVisitRecovery,
  recoveredVisitMatchesPersistedIdentity,
  reviveRecoveredVisitDependencies,
} from '../lib/historicalVisitRecovery';
import { queueReplayPriority } from '../lib/syncQueueDependencies';

const orgId = '11111111-1111-4111-8111-111111111111';

function reserveFailure(overrides: Record<string, any> = {}) {
  return {
    id: 'queue-reserve',
    queuedAt: '2026-08-23T16:06:21.000Z',
    table: 'reserves',
    op: 'rpc',
    rpc: {
      fn: 'create_reserve_with_photos',
      args: {
        p_reserve: {
          id: 'RES-1',
          visite_id: 'VIS-17875223',
          chantier_id: 'CHANTIER-1',
          organization_id: orgId,
          ...overrides,
        },
      },
    },
    lastError: '[23503] reserves_tenant_visite_fkey — Key is not present in table "visites".',
  };
}

describe('historical visit recovery', () => {
  it('recreates the exact cached visit before its dependent reserves', () => {
    const plan = planHistoricalVisitRecovery({
      queue: [reserveFailure()],
      cachedVisits: [{
        id: 'VIS-17875223',
        chantierId: 'CHANTIER-1',
        title: 'Visite façade',
        date: '2026-08-23',
        conducteur: 'Adrien',
        status: 'open',
        reserveIds: ['RES-1'],
        createdAt: '2026-08-23T16:00:00.000Z',
      }],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.repairs).toHaveLength(1);
    expect(plan.repairs[0]).toMatchObject({
      visitId: 'VIS-17875223',
      source: 'visit_cache',
      dependencyKeys: ['queue-reserve'],
    });
    expect(plan.repairs[0].payload).toMatchObject({
      id: 'VIS-17875223',
      chantier_id: 'CHANTIER-1',
      organization_id: orgId,
      title: 'Visite façade',
    });
  });

  it('builds a minimal recovery visit from consistent dependent reserve data', () => {
    const plan = planHistoricalVisitRecovery({
      queue: [reserveFailure()],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
      userName: 'Chef chantier',
      now: '2026-08-26T10:00:00.000Z',
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.repairs[0]).toMatchObject({ visitId: 'VIS-17875223', source: 'dependent_reserves' });
    expect(plan.repairs[0].payload).toMatchObject({
      chantier_id: 'CHANTIER-1',
      organization_id: orgId,
      conducteur: 'Chef chantier',
      date: '2026-08-23',
      reserve_ids: ['RES-1'],
    });
  });

  it('refuses a link-only recovery when no queued payload proves the tenant', () => {
    const plan = planHistoricalVisitRecovery({
      queue: [{
        id: 'queue-link',
        queuedAt: '2026-08-23T16:06:21.000Z',
        table: 'visite_reserve_links',
        op: 'rpc',
        rpc: {
          fn: 'link_reserves_to_visite',
          args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
        },
        lastError: '[P0002] — HTTP 500 — Visite introuvable: VIS-17875223',
      }],
      cachedVisits: [],
      cachedReserves: [{
        id: 'RES-1',
        chantierId: 'CHANTIER-1',
        visiteId: 'VIS-17875223',
      } as any],
      organizationId: orgId,
      userName: 'Chef chantier',
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe('organization_unproven');
  });

  it('refuses recovery when tenant or chantier evidence is ambiguous', () => {
    const wrongTenant = planHistoricalVisitRecovery({
      queue: [reserveFailure({ organization_id: '22222222-2222-4222-8222-222222222222' })],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });
    expect(wrongTenant.repairs).toEqual([]);
    expect(wrongTenant.skipped[0]?.reason).toBe('organization_mismatch');

    const ambiguousChantier = planHistoricalVisitRecovery({
      queue: [
        reserveFailure(),
        { ...reserveFailure({ id: 'RES-2', chantier_id: 'CHANTIER-2' }), id: 'queue-reserve-2' },
      ],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });
    expect(ambiguousChantier.repairs).toEqual([]);
    expect(ambiguousChantier.skipped[0]?.reason).toBe('chantier_ambiguous');
  });

  it('does not fabricate a parent without a proven legacy missing-visit failure', () => {
    const noFailure = reserveFailure();
    noFailure.lastError = 'timeout';
    const modernId = reserveFailure({ visite_id: 'VIS-1787522300000-random' });
    const unrelatedForeignKey = reserveFailure();
    unrelatedForeignKey.lastError = '[23503] chantier_id violates a foreign key constraint';

    expect(planHistoricalVisitRecovery({
      queue: [noFailure, modernId, unrelatedForeignKey],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    }).repairs).toEqual([]);
  });

  it('does not duplicate a visit insert already present in the queue', () => {
    const plan = planHistoricalVisitRecovery({
      queue: [
        reserveFailure(),
        { table: 'visites', op: 'insert', data: { id: 'VIS-17875223' } },
      ],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });
    expect(plan.repairs).toEqual([]);
  });

  it('plans recovery for a dependency already made terminal by repeated failures', () => {
    const terminalFailure = {
      ...reserveFailure(),
      queueEntryId: 'entry-reserve',
      terminal: true,
      terminalStatus: 'deterministic_failure',
      terminalOutcome: { status: 'failed' },
      nextAttemptAt: '2026-08-27T00:00:00.000Z',
      failureClass: 'deterministic',
      retrySource: 'automatic',
      sameFailureCount: 155,
    };
    const plan = planHistoricalVisitRecovery({
      queue: [terminalFailure],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toHaveLength(1);
    expect(plan.repairs[0]?.dependencyKeys).toEqual(['entry-reserve']);
    expect(reviveRecoveredVisitDependencies([terminalFailure], plan.repairs)).toEqual([{
      ...reserveFailure(),
      queueEntryId: 'entry-reserve',
      sameFailureCount: 0,
    }]);
  });

  it('turns the exact historical reserve/link failure into a parent-first replay', () => {
    const create = {
      ...reserveFailure(),
      queueEntryId: 'entry-create',
      terminal: true,
      sameFailureCount: 155,
    };
    const link = {
      id: 'queue-link',
      queueEntryId: 'entry-link',
      queuedAt: '2026-08-23T16:06:21.000Z',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
      },
      lastError: '[P0002] — HTTP 500 — Visite introuvable: VIS-17875223',
      terminal: true,
      sameFailureCount: 151,
    };
    const plan = planHistoricalVisitRecovery({
      queue: [create, link],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
      userName: 'Jefe de obra',
      recoveryTitle: 'Visita recuperada',
      recoveryNotes: 'Visita reconstruida automáticamente desde la cola sin conexión.',
    });
    const revived = reviveRecoveredVisitDependencies([create, link], plan.repairs);
    const replay = [
      ...revived,
      { table: 'visites', op: 'insert', data: plan.repairs[0].payload },
    ].sort((left, right) => queueReplayPriority(left) - queueReplayPriority(right));

    expect(plan.repairs[0].payload.title).toBe('Visita recuperada (VIS-17875223)');
    expect(revived.every(operation => !operation.terminal)).toBe(true);
    expect(replay.map(operation => operation.table)).toEqual([
      'visites',
      'reserves',
      'visite_reserve_links',
    ]);
  });
});

describe('recovered visit duplicate verification', () => {
  it('accepts only the same visit, tenant and chantier identity', () => {
    const queued = { id: 'VIS-17875223', organization_id: orgId, chantier_id: 'CHANTIER-1' };
    expect(recoveredVisitMatchesPersistedIdentity(queued, {
      ...queued,
      title: 'Edited on another device',
    })).toBe(true);
    expect(recoveredVisitMatchesPersistedIdentity(queued, {
      ...queued,
      organization_id: '22222222-2222-4222-8222-222222222222',
    })).toBe(false);
    expect(recoveredVisitMatchesPersistedIdentity(queued, {
      ...queued,
      chantier_id: 'CHANTIER-2',
    })).toBe(false);
  });
});
