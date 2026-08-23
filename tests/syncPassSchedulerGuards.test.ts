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

const unexpected = (_operation: RetryQueueOperationLike, error: unknown): never => {
  throw error;
};

describe('a deferral closes the group it was selected from', () => {
  it('blocks the original key even when the enriched operation moves group', async () => {
    // `execute` peut renvoyer une version transformee. Rien dans le contrat
    // generique ne garantit que sa cle d ordre reste stable : bloquer seulement
    // la cle resultante laisserait le groupe d origine ouvert, et l operation
    // suivante de ce groupe pourrait passer devant sa tete differee.
    const a1 = movement('a1', 'A', 10);
    const a2 = movement('a2', 'A', 9);
    const executed: string[] = [];

    const result = await runSyncPass({
      operations: [a1, a2],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        return {
          kind: 'deferred',
          // Meme operation, mais rattachee a un autre produit.
          operation: {
            ...operation,
            rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'B' } } },
          },
          nextAttemptAt: iso(NOW + 60_000),
        };
      },
    });

    expect(executed).toEqual(['a1']);
    expect(result.untouched.map(idOf)).toEqual(['a2']);
  });

  it('also blocks the destination key, so the moved group stays closed too', async () => {
    const a1 = movement('a1', 'A', 10);
    const b1 = movement('b1', 'B', 9);
    const executed: string[] = [];

    await runSyncPass({
      operations: [a1, b1],
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        if (idOf(operation) !== 'a1') return { kind: 'applied' };
        return {
          kind: 'deferred',
          operation: {
            ...operation,
            rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'B' } } },
          },
        };
      },
    });

    // a1 est desormais rattachee au produit B : b1 doit attendre elle aussi.
    expect(executed).toEqual(['a1']);
  });
});

describe('an exception can never mark an operation applied', () => {
  it('keeps a failed execution in the queue as deferred', async () => {
    // Une reponse perdue apres un commit serveur doit rester differee avec le
    // meme operation_id : c est l idempotence serveur qui tranchera au rejeu,
    // jamais une supposition du client.
    const result = await runSyncPass({
      operations: [movement('a1', 'A', 10)],
      now: frozenClock,
      execute: async () => { throw new Error('reponse perdue apres commit'); },
      onExecuteError: () => ({ kind: 'deferred', nextAttemptAt: iso(NOW + 30_000) }),
    });

    expect(result.applied).toHaveLength(0);
    expect(result.deferred.map(entry => idOf(entry.operation))).toEqual(['a1']);
  });

  it('still allows a proven terminal refusal from the classifier', async () => {
    // Un refus deterministe reste exprimable : seule `applied` est interdite.
    const result = await runSyncPass({
      operations: [movement('a1', 'A', 10)],
      now: frozenClock,
      execute: async () => { throw new Error('payload invalide'); },
      onExecuteError: () => ({ kind: 'terminal' }),
    });

    expect(result.terminal.map(idOf)).toEqual(['a1']);
    expect(result.applied).toHaveLength(0);
  });
});
