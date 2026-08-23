import { describe, expect, it } from 'vitest';
import { runSyncPass } from '../lib/syncPassScheduler';
import type { RetryQueueOperationLike } from '../lib/syncRetryPolicy';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const idOf = (operation: RetryQueueOperationLike) => String(operation.id);
const frozenClock = () => NOW;

function movement(id: string, productId: string, minutesAgo: number): RetryQueueOperationLike {
  return {
    id,
    queuedAt: iso(NOW - minutesAgo * 60_000),
    table: 'inventory_movements',
    rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: productId } } },
  };
}

/** Horloge qui avance : indispensable pour eprouver la fermeture de groupe. */
function movingClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; },
  };
}

/** Aucun test ici ne doit laisser echapper une exception non prevue. */
const unexpected = (_operation: RetryQueueOperationLike, error: unknown): never => {
  throw error;
};

describe('a deferred group stays closed for the whole pass', () => {
  it('does not retry a deferred operation when the clock passes its deadline', async () => {
    // Une echeance fabriquee ne suffisait pas : sur une passe longue, l horloge
    // depassait l echeance reelle et rendait l operation a nouveau eligible,
    // consommant une tentative de plus avant meme le reveil global. Une horloge
    // figee masquait completement ce cas.
    const clock = movingClock(NOW);
    const executed: string[] = [];

    const result = await runSyncPass({
      operations: [movement('a1', 'A', 10), movement('b1', 'B', 9)],
      now: clock.now,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        if (idOf(operation) === 'a1') {
          // Echeance a une seconde...
          return { kind: 'deferred', nextAttemptAt: iso(clock.now() + 1_000) };
        }
        // ...que le traitement de b1 depasse largement.
        clock.advance(10_000);
        return { kind: 'applied' };
      },
    });

    expect(executed).toEqual(['a1', 'b1']);
    expect(executed.filter(id => id === 'a1')).toHaveLength(1);
    expect(result.processed).toBe(2);
  });

  it('keeps the group closed against a following operation that is due', async () => {
    const clock = movingClock(NOW);
    const executed: string[] = [];

    await runSyncPass({
      operations: [movement('a1', 'A', 10), movement('a2', 'A', 9)],
      now: clock.now,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        clock.advance(60_000);
        return { kind: 'deferred', nextAttemptAt: iso(clock.now() + 1_000) };
      },
    });

    // a2 ne doit jamais depasser a1, meme une minute plus tard.
    expect(executed).toEqual(['a1']);
  });
});

describe('operations transformed during execution', () => {
  it('carries the enriched version into the deferred report', async () => {
    // Le moteur remplace les photos locales par leurs URLs distantes avant de
    // reessayer : perdre cette version ferait re-televerser des fichiers deja
    // envoyes.
    const original = movement('a1', 'A', 10);
    const enriched = { ...original, data: { photo_url: 'https://distant/photo.jpg' } };

    const result = await runSyncPass({
      operations: [original],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => ({ kind: 'deferred', operation: enriched, nextAttemptAt: iso(NOW + 30_000) }),
    });

    expect(result.deferred[0].operation).toBe(enriched);
  });

  it('carries it into applied and terminal too', async () => {
    const a1 = movement('a1', 'A', 10);
    const enriched = { ...a1, data: { prepared: true } };

    const applied = await runSyncPass({
      operations: [a1],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => ({ kind: 'applied', operation: enriched }),
    });
    expect(applied.applied[0]).toBe(enriched);

    const rejected = await runSyncPass({
      operations: [a1],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => ({ kind: 'terminal', operation: enriched }),
    });
    expect(rejected.terminal[0]).toBe(enriched);
  });

  it('returns an untouched operation exactly as it came in', async () => {
    const a1 = movement('a1', 'A', 10);
    const a2 = movement('a2', 'A', 9);

    const result = await runSyncPass({
      operations: [a1, a2],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => ({ kind: 'deferred', operation: { ...a1, data: { prepared: true } } }),
    });

    expect(result.untouched).toEqual([a2]);
    // Le jeton interne ne doit jamais sortir du module.
    expect(Object.keys(result.untouched[0])).not.toContain('__passToken');
  });
});

describe('identity is internal, never the business id', () => {
  it('handles two operations sharing an id independently', async () => {
    // Retirer par identifiant metier supprimait les DEUX entrees : la seconde
    // disparaissait sans avoir ete ni executee ni refusee — precisement le
    // defaut que ce moteur cherche a eviter.
    const first = { ...movement('op-123', 'A', 10), data: { n: 1 } };
    const second = { ...movement('op-123', 'B', 9), data: { n: 2 } };
    const executed: unknown[] = [];

    const result = await runSyncPass({
      operations: [first, second],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(operation.data);
        return { kind: 'applied' };
      },
    });

    expect(result.processed).toBe(2);
    expect(executed).toEqual([{ n: 1 }, { n: 2 }]);
    expect(result.untouched).toHaveLength(0);
  });

  it('does not lose the twin when the first one is deferred', async () => {
    const first = { ...movement('op-123', 'A', 10), data: { n: 1 } };
    const second = { ...movement('op-123', 'B', 9), data: { n: 2 } };

    const result = await runSyncPass({
      operations: [first, second],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => (
        (operation.data as { n: number }).n === 1 ? { kind: 'deferred' } : { kind: 'applied' }
      ),
    });

    expect(result.deferred).toHaveLength(1);
    expect(result.applied).toHaveLength(1);
    expect(result.untouched).toHaveLength(0);
  });
});

describe('an execution that throws', () => {
  it('does not discard everything already done', async () => {
    // Une seule branche non protegee parmi les 46 du moteur ferait sinon
    // rejeter toute la passe, et l appelant devrait deviner ce qui avait ete
    // applique avant de persister.
    const result = await runSyncPass({
      operations: [movement('a1', 'A', 10), movement('b1', 'B', 9), movement('c1', 'C', 8)],
      now: frozenClock,
      execute: async operation => {
        if (idOf(operation) === 'b1') throw new Error('branche non protegee');
        return { kind: 'applied' };
      },
      onExecuteError: () => ({ kind: 'deferred', nextAttemptAt: iso(NOW + 30_000) }),
    });

    expect(result.applied.map(idOf)).toEqual(['a1', 'c1']);
    expect(result.deferred.map(entry => idOf(entry.operation))).toEqual(['b1']);
    expect(result.abandoned).toBe(false);
  });

  it('lets the classifier stop the pass when the failure is global', async () => {
    const result = await runSyncPass({
      operations: [movement('a1', 'A', 10), movement('b1', 'B', 9)],
      now: frozenClock,
      execute: async () => { throw new Error('session perdue'); },
      onExecuteError: () => ({ kind: 'abandon', reason: 'authentication' }),
    });

    expect(result.abandonReason).toBe('authentication');
    expect(result.processed).toBe(1);
    expect(result.untouched.map(idOf)).toEqual(['b1']);
  });
});
