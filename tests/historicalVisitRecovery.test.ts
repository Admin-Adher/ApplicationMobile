import { describe, expect, it } from 'vitest';
import {
  HISTORICAL_VISIT_RECOVERY_INTENT,
  blockRecoveredVisitDependencies,
  planHistoricalVisitRecovery,
  prepareRecoveredVisitQueue,
  recoveredVisitMatchesPersistedIdentity,
  releaseRecoveredVisitDependencies,
  reviveRecoveredVisitDependencies,
  summarizeHistoricalVisitRecovery,
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
        status: 'planned',
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

  it('uses the authenticated profile tenant when an old reserve payload omitted it', () => {
    const plan = planHistoricalVisitRecovery({
      queue: [reserveFailure({ organization_id: null })],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.repairs[0]).toMatchObject({
      organizationSource: 'active_profile',
      payload: { organization_id: orgId },
    });
  });

  it('uses a unique queued tenant when the authenticated profile has none', () => {
    const plan = planHistoricalVisitRecovery({
      queue: [reserveFailure()],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: null,
    });

    expect(plan.skipped).toEqual([]);
    expect(plan.repairs[0]).toMatchObject({
      organizationSource: 'queue_payload',
      payload: { organization_id: orgId },
    });
    expect(summarizeHistoricalVisitRecovery(plan, false)).toMatchObject({
      evaluated: true,
      candidateCount: 1,
      plannedCount: 1,
      profileOrganizationAvailable: false,
      queuedOrganizationFallbackCount: 1,
      skippedReasons: {},
    });
  });

  it('merges the persisted reserve payload with incomplete legacy RPC args', () => {
    const operation: any = reserveFailure();
    operation.data = {
      id: 'RES-1',
      visite_id: 'VIS-17875223',
      chantier_id: 'CHANTIER-1',
      organization_id: orgId,
    };
    operation.rpc.args.p_reserve = { id: 'RES-1', visite_id: 'VIS-17875223' };

    const plan = planHistoricalVisitRecovery({
      queue: [operation],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: null,
    });

    expect(plan.repairs[0]).toMatchObject({
      organizationSource: 'queue_payload',
      payload: {
        organization_id: orgId,
        chantier_id: 'CHANTIER-1',
      },
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

    const ambiguousTenant = planHistoricalVisitRecovery({
      queue: [
        reserveFailure(),
        { ...reserveFailure({ organization_id: '22222222-2222-4222-8222-222222222222' }), id: 'queue-reserve-2' },
      ],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: null,
    });
    expect(ambiguousTenant.repairs).toEqual([]);
    expect(ambiguousTenant.skipped[0]?.reason).toBe('organization_ambiguous');

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
    const whitespaceId = reserveFailure({ visite_id: 'VIS-17875223 ' });
    const unrelatedForeignKey = reserveFailure();
    unrelatedForeignKey.lastError = '[23503] chantier_id violates a foreign key constraint';

    expect(planHistoricalVisitRecovery({
      queue: [noFailure, modernId, whitespaceId, unrelatedForeignKey],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    }).repairs).toEqual([]);
  });

  it('recovers a legacy visit when the reserve payload lost visite_id but its queued link corroborates it', () => {
    const create = reserveFailure({ visite_id: undefined });
    create.lastError = '[23503] — HTTP 409 — insert on reserves violates reserves_tenant_visite_fkey';
    const link = {
      id: 'queue-link',
      queuedAt: '2026-08-23T16:06:21.000Z',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
      },
      lastError: '[42501] — HTTP 403 — Reserves introuvables ou hors perimetre',
      terminal: true,
    };

    const plan = planHistoricalVisitRecovery({
      queue: [create, link],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toHaveLength(1);
    expect(plan.repairs[0]).toMatchObject({
      visitId: 'VIS-17875223',
      dependencyKeys: ['queue-reserve', 'queue-link'],
      payload: {
        id: 'VIS-17875223',
        chantier_id: 'CHANTIER-1',
        organization_id: orgId,
      },
    });
    expect(plan.evidence).toEqual({
      createReserveOperationCount: 1,
      linkOperationCount: 1,
      legacyVisitReferenceCount: 1,
      missingVisitFailureCount: 1,
      foreignKeyFailureCount: 1,
      terminalForeignKeyRecoveryCount: 0,
      foreignKeyContradictionCount: 0,
      reserveLinkCorrelationCount: 1,
      ambiguousReserveLinkCount: 0,
    });
  });

  it('uses an exact reserve/link correlation when PostgREST retained only SQLSTATE 23503', () => {
    const create = reserveFailure();
    create.lastError = '[23503] — HTTP 409';
    const link = {
      id: 'queue-link',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
      },
      lastError: '[42501] — HTTP 403',
    };

    const plan = planHistoricalVisitRecovery({
      queue: [create, link],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toHaveLength(1);
    expect(plan.evidence.missingVisitFailureCount).toBe(0);
    expect(plan.evidence.foreignKeyFailureCount).toBe(1);
    expect(plan.evidence.reserveLinkCorrelationCount).toBe(1);
  });

  it('recovers the live opaque 23503 only after both exact dependencies became terminal', () => {
    const create = {
      ...reserveFailure(),
      queueEntryId: 'entry-create',
      lastError: '[23503] — HTTP 409 — Erreur du serveur',
      terminal: true,
      terminalStatus: 'server_rejected',
      sameFailureCount: 3,
    };
    const link = {
      id: 'queue-link',
      queueEntryId: 'entry-link',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
      },
      lastError: '[42501] — HTTP 403 — Reserves introuvables ou hors perimetre',
      terminal: true,
      terminalStatus: 'server_rejected',
      sameFailureCount: 3,
    };

    const plan = planHistoricalVisitRecovery({
      queue: [create, link],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });
    const revived = reviveRecoveredVisitDependencies([create, link], plan.repairs);

    expect(plan.repairs).toHaveLength(1);
    expect(plan.repairs[0]?.dependencyKeys).toEqual(['entry-create', 'entry-link']);
    expect(plan.evidence).toMatchObject({
      foreignKeyFailureCount: 1,
      terminalForeignKeyRecoveryCount: 1,
      foreignKeyContradictionCount: 0,
      reserveLinkCorrelationCount: 1,
      ambiguousReserveLinkCount: 0,
    });
    expect(revived).toEqual([
      expect.objectContaining({ queueEntryId: 'entry-create', sameFailureCount: 0 }),
      expect.objectContaining({ queueEntryId: 'entry-link', sameFailureCount: 0 }),
    ]);
    expect(revived.every(operation => !operation.terminal && !operation.terminalStatus)).toBe(true);
  });

  it.each([
    ['create not terminal', { createTerminal: false, createFailures: 3, createStatus: 'server_rejected', linkTerminal: true, linkFailures: 3, linkStatus: 'server_rejected' }],
    ['create below threshold', { createTerminal: true, createFailures: 2, createStatus: 'server_rejected', linkTerminal: true, linkFailures: 3, linkStatus: 'server_rejected' }],
    ['create has another terminal status', { createTerminal: true, createFailures: 3, createStatus: 'forbidden', linkTerminal: true, linkFailures: 3, linkStatus: 'server_rejected' }],
    ['link not terminal', { createTerminal: true, createFailures: 3, createStatus: 'server_rejected', linkTerminal: false, linkFailures: 3, linkStatus: 'server_rejected' }],
    ['link below threshold', { createTerminal: true, createFailures: 3, createStatus: 'server_rejected', linkTerminal: true, linkFailures: 2, linkStatus: 'server_rejected' }],
    ['link has another terminal status', { createTerminal: true, createFailures: 3, createStatus: 'server_rejected', linkTerminal: true, linkFailures: 3, linkStatus: 'forbidden' }],
  ])('keeps an opaque 23503 closed when %s', (_label, state) => {
    const create = {
      ...reserveFailure(),
      lastError: '[23503] — HTTP 409 — Erreur du serveur',
      terminal: state.createTerminal,
      terminalStatus: state.createStatus,
      sameFailureCount: state.createFailures,
    };
    const link = {
      id: 'queue-link',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
      },
      lastError: '[42501] — HTTP 403',
      terminal: state.linkTerminal,
      terminalStatus: state.linkStatus,
      sameFailureCount: state.linkFailures,
    };

    const plan = planHistoricalVisitRecovery({
      queue: [create, link],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.evidence.terminalForeignKeyRecoveryCount).toBe(0);
  });

  it('does not infer a visit from a code-only 23503 when the create payload lost its visit reference', () => {
    const create = reserveFailure({ visite_id: undefined });
    create.lastError = '[23503] — HTTP 409';
    const link = {
      id: 'queue-link',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
      },
      lastError: '[42501] — HTTP 403',
    };

    const plan = planHistoricalVisitRecovery({
      queue: [create, link],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.evidence.reserveLinkCorrelationCount).toBe(1);
  });

  it('does not let a different named foreign key borrow a matching visit link', () => {
    const contradictoryErrors = [
      '[23503] — HTTP 409 — chantier_id violates a foreign key constraint',
      '[23503] — HTTP 409 — constraint "reserves_tenant_chantier_fkey"',
      '[23503] — HTTP 409 — Key is not present in table "chantiers"',
    ];

    for (const lastError of contradictoryErrors) {
      const create = {
        ...reserveFailure(),
        lastError,
        terminal: true,
        terminalStatus: 'server_rejected',
        sameFailureCount: 3,
      };
      const link = {
        id: 'queue-link',
        table: 'visite_reserve_links',
        op: 'rpc',
        rpc: {
          fn: 'link_reserves_to_visite',
          args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
        },
        lastError: '[42501] — HTTP 403',
        terminal: true,
        sameFailureCount: 3,
      };

      const plan = planHistoricalVisitRecovery({
        queue: [create, link],
        cachedVisits: [],
        cachedReserves: [],
        organizationId: orgId,
      });

      expect(plan.repairs, lastError).toEqual([]);
      expect(plan.evidence.foreignKeyContradictionCount, lastError).toBe(1);
      expect(plan.evidence.terminalForeignKeyRecoveryCount, lastError).toBe(0);
    }
  });

  it('keeps a generic 23503 fail-closed when no link names the same reserve', () => {
    const create = reserveFailure({ visite_id: undefined });
    create.lastError = '[23503] — HTTP 409';
    const unrelatedLink = {
      id: 'queue-link',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-OTHER'] },
      },
      lastError: '[42501] — HTTP 403',
    };

    const plan = planHistoricalVisitRecovery({
      queue: [create, unrelatedLink],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.evidence.reserveLinkCorrelationCount).toBe(0);
  });

  it('refuses an ambiguous reserve linked to two distinct historical visits', () => {
    const create = reserveFailure({ visite_id: undefined });
    create.lastError = '[23503] — HTTP 409 — reserves_tenant_visite_fkey';
    const link = (id: string, visitId: string) => ({
      id,
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: visitId, p_reserve_ids: ['RES-1'] },
      },
      lastError: '[42501] — HTTP 403',
    });

    const plan = planHistoricalVisitRecovery({
      queue: [create, link('queue-link-a', 'VIS-17875223'), link('queue-link-b', 'VIS-17875224')],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.evidence.reserveLinkCorrelationCount).toBe(0);
    expect(plan.evidence.ambiguousReserveLinkCount).toBe(1);
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

  it('upgrades an exact recovery parent persisted by the previous OTA without duplicating it', () => {
    const create = {
      ...reserveFailure(),
      queueEntryId: 'entry-create',
      lastError: '[23503] — HTTP 409 — Erreur du serveur',
      terminal: true,
      terminalStatus: 'server_rejected',
      sameFailureCount: 3,
    };
    const link = {
      id: 'queue-link',
      queueEntryId: 'entry-link',
      table: 'visite_reserve_links',
      op: 'rpc',
      rpc: {
        fn: 'link_reserves_to_visite',
        args: { p_visite_id: 'VIS-17875223', p_reserve_ids: ['RES-1'] },
      },
      terminal: true,
      terminalStatus: 'server_rejected',
      sameFailureCount: 3,
    };
    const legacyParent = {
      id: 'queue-parent',
      queueEntryId: 'entry-parent',
      table: 'visites',
      op: 'insert',
      data: {
        id: 'VIS-17875223',
        organization_id: orgId,
        chantier_id: 'CHANTIER-1',
      },
      recoveryIntent: HISTORICAL_VISIT_RECOVERY_INTENT,
      terminal: true,
      terminalStatus: 'server_rejected',
      lastError: '[42501] — HTTP 403',
      attemptCount: 3,
      sameFailureCount: 3,
    };

    const plan = planHistoricalVisitRecovery({
      queue: [create, link, legacyParent],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });
    const prepared = prepareRecoveredVisitQueue([create, link, legacyParent], plan.repairs);

    expect(plan.repairs).toHaveLength(1);
    expect(plan.repairs[0]).toMatchObject({
      visitId: 'VIS-17875223',
      dependencyKeys: ['entry-create', 'entry-link'],
      reuseQueuedParent: true,
    });
    expect(prepared).toHaveLength(3);
    expect(prepared[0]).toMatchObject({ recoveryBlockedByVisitId: 'VIS-17875223', terminal: true });
    expect(prepared[1]).toMatchObject({ recoveryBlockedByVisitId: 'VIS-17875223', terminal: true });
    expect(prepared[2]).toMatchObject({
      id: 'queue-parent',
      recoveryIntent: HISTORICAL_VISIT_RECOVERY_INTENT,
      recoveryDependencyKeys: ['entry-create', 'entry-link'],
      attemptCount: 0,
      sameFailureCount: 0,
    });
    expect(prepared[2]).not.toHaveProperty('terminal');
    expect(prepared[2]).not.toHaveProperty('lastError');

    // Si ce parent echoue apres migration, le marqueur deja persiste interdit
    // un second rearmement automatique a l'hydratation suivante.
    const failedAfterMigration = prepared.map(operation => (
      operation.id === 'queue-parent'
        ? {
          ...operation,
          terminal: true,
          terminalStatus: 'server_rejected',
          lastError: '[42501] — HTTP 403',
          attemptCount: 3,
          sameFailureCount: 3,
        }
        : operation
    ));
    const planAfterMigrationFailure = planHistoricalVisitRecovery({
      queue: failedAfterMigration,
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });
    const preparedAgain = prepareRecoveredVisitQueue(
      failedAfterMigration,
      planAfterMigrationFailure.repairs,
    );
    expect(planAfterMigrationFailure.repairs).toHaveLength(1);
    expect(preparedAgain[2]).toMatchObject({
      terminal: true,
      terminalStatus: 'server_rejected',
      recoveryDependencyKeys: ['entry-create', 'entry-link'],
      attemptCount: 3,
      sameFailureCount: 3,
    });
  });

  it('refuses to reuse a recovery parent with another tenant or chantier', () => {
    const mismatchedParent = {
      table: 'visites',
      op: 'insert',
      data: {
        id: 'VIS-17875223',
        organization_id: orgId,
        chantier_id: 'CHANTIER-OTHER',
      },
      recoveryIntent: HISTORICAL_VISIT_RECOVERY_INTENT,
    };
    const plan = planHistoricalVisitRecovery({
      queue: [reserveFailure(), mismatchedParent],
      cachedVisits: [],
      cachedReserves: [],
      organizationId: orgId,
    });

    expect(plan.repairs).toEqual([]);
    expect(plan.skipped).toEqual([{ visitId: 'VIS-17875223', reason: 'recovery_parent_mismatch' }]);
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
    const { lastError: _lastError, ...cleanReserveFailure } = reserveFailure();
    expect(reviveRecoveredVisitDependencies([terminalFailure], plan.repairs)).toEqual([{
      ...cleanReserveFailure,
      queueEntryId: 'entry-reserve',
      attemptCount: 0,
      sameFailureCount: 0,
    }]);
  });

  it('keeps recovered children blocked durably until the exact parent is applied', () => {
    const create = {
      ...reserveFailure(),
      queueEntryId: 'entry-create',
      terminal: true,
      terminalStatus: 'server_rejected',
      terminalOutcome: { status: 'failed' },
      nextAttemptAt: '2026-08-27T00:00:00.000Z',
      failureClass: 'deterministic',
      retrySource: 'automatic',
      sameFailureCount: 3,
    };
    const unrelated = {
      ...reserveFailure({ id: 'RES-OTHER', visite_id: 'VIS-17875224' }),
      id: 'queue-unrelated',
      queueEntryId: 'entry-unrelated',
      terminal: true,
    };
    const repair = {
      visitId: 'VIS-17875223',
      payload: {},
      source: 'dependent_reserves' as const,
      organizationSource: 'active_profile' as const,
      dependencyKeys: ['entry-create'],
    };

    const blocked = blockRecoveredVisitDependencies([create, unrelated], [repair]);
    expect(blocked[0]).toMatchObject({
      queueEntryId: 'entry-create',
      recoveryBlockedByVisitId: 'VIS-17875223',
      terminal: true,
      sameFailureCount: 3,
    });
    expect(blocked[1]).toEqual(unrelated);

    // Un autre parent ou une autre cle locale ne peut jamais liberer l'enfant.
    expect(releaseRecoveredVisitDependencies(blocked, 'VIS-17875224', ['entry-create'])).toEqual(blocked);
    expect(releaseRecoveredVisitDependencies(blocked, 'VIS-17875223', ['entry-unrelated'])).toEqual(blocked);

    const released = releaseRecoveredVisitDependencies(blocked, 'VIS-17875223', ['entry-create']);
    const { lastError: _lastError, ...cleanReserveFailure } = reserveFailure();
    expect(released[0]).toEqual({
      ...cleanReserveFailure,
      queueEntryId: 'entry-create',
      attemptCount: 0,
      sameFailureCount: 0,
    });
    expect(released[1]).toEqual(unrelated);
  });

  it('releases a legacy child even when queueEntryId was assigned after planning', () => {
    const legacyCreate = {
      ...reserveFailure(),
      terminal: true,
      terminalStatus: 'server_rejected',
      sameFailureCount: 3,
    };
    const repair = {
      visitId: 'VIS-17875223',
      payload: {},
      source: 'dependent_reserves' as const,
      organizationSource: 'active_profile' as const,
      // Le planner n'avait encore que l'ancien `id` a cet instant.
      dependencyKeys: ['queue-reserve'],
    };
    const [blocked] = blockRecoveredVisitDependencies([legacyCreate], [repair]);
    const migrated = { ...blocked, queueEntryId: 'new-local-identity' };
    const { lastError: _lastError, ...cleanReserveFailure } = reserveFailure();

    expect(releaseRecoveredVisitDependencies(
      [migrated],
      'VIS-17875223',
      ['queue-reserve'],
    )).toEqual([{
      ...cleanReserveFailure,
      queueEntryId: 'new-local-identity',
      attemptCount: 0,
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
      // Apres plusieurs essais, l'erreur du lien a evolue : la creation de
      // reserve reste la preuve que la visite parente manque.
      lastError: '[42501] — HTTP 403 — Reserves introuvables ou hors perimetre',
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
