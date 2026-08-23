import { describe, expect, it, vi } from 'vitest';
import { runSyncPass, type PassOperationOutcome } from '../lib/syncPassScheduler';
import type { RetryQueueOperationLike } from '../lib/syncRetryPolicy';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const idOf = (operation: RetryQueueOperationLike) => String(operation.id);

/** Mouvement de stock sur un produit donne. */
function movement(id: string, productId: string, minutesAgo: number): RetryQueueOperationLike {
  return {
    id,
    queuedAt: iso(NOW - minutesAgo * 60_000),
    table: 'inventory_movements',
    rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: productId } } },
  };
}

/** Horloge figee : l'ordonnanceur ne doit jamais lire l'heure lui-meme. */
const frozenClock = () => NOW;

/** Horloge qui avance : indispensable pour eprouver la fermeture de groupe. */
function movingClock(startMs: number) {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; },
  };
}

/** Aucun test ci-dessous ne doit laisser echapper une exception d'execution. */
const unexpected = (_operation: RetryQueueOperationLike, error: unknown): never => {
  throw error;
};

describe('group throughput', () => {
  it('drains 30 movements on one product within a single pass', async () => {
    // LA garantie. Une photographie unique des tetes n'en traiterait qu'une par
    // passe : trente mouvements auraient demande trente passes, soit une version
    // attenuee du bug d'origine.
    const operations = Array.from({ length: 30 }, (_, index) => movement(`m${index}`, 'P1', 30 - index));
    const executed: string[] = [];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        return { kind: 'applied' };
      },
    });

    expect(result.processed).toBe(30);
    expect(result.applied).toHaveLength(30);
    expect(result.untouched).toHaveLength(0);
    expect(result.abandoned).toBe(false);
    // Aucun doublon, aucune perte.
    expect(new Set(executed).size).toBe(30);
    // Et dans l'ordre de mise en file.
    expect(executed).toEqual(operations.map(idOf));
  });

  it('drains independent products without losing either group', async () => {
    const operations = [
      movement('a1', 'A', 10), movement('a2', 'A', 9), movement('a3', 'A', 8),
      movement('b1', 'B', 7), movement('b2', 'B', 6),
    ];
    const executed: string[] = [];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => { executed.push(idOf(operation)); return { kind: 'applied' }; },
    });

    // La politique priorise l anciennete et la priorite metier, PAS un
    // round-robin equitable : le nom precedent affirmait une alternance que les
    // assertions ne verifiaient pas.
    expect(result.processed).toBe(5);
    expect(new Set(executed).size).toBe(5);
    expect(result.applied).toHaveLength(5);
    expect(result.untouched).toHaveLength(0);
  });
});

describe('business ordering', () => {
  it('never lets a newer write overtake its deferred head', async () => {
    const operations = [
      movement('a1', 'A', 10),
      movement('a2', 'A', 9),
      movement('b1', 'B', 8),
    ];
    const executed: string[] = [];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        // a1 echoue et repart plus tard : son groupe doit se fermer.
        return idOf(operation) === 'a1'
          ? { kind: 'deferred', nextAttemptAt: iso(NOW + 120_000) }
          : { kind: 'applied' };
      },
    });

    expect(executed).toEqual(['a1', 'b1']);
    // a2 est exigible, mais passer devant a1 corromprait le solde du produit.
    expect(executed).not.toContain('a2');
    expect(result.untouched.map(idOf)).toEqual(['a2']);
    expect(result.deferred).toEqual([
      { operation: operations[0], nextAttemptAt: iso(NOW + 120_000) },
    ]);
  });

  it('closes the group even when the failure carries no deadline', async () => {
    // Sans echeance exploitable, la boucle reprendrait l'operation a l'infini.
    const operations = [movement('a1', 'A', 10), movement('a2', 'A', 9)];
    let calls = 0;

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => { calls += 1; return { kind: 'deferred' }; },
    });

    expect(calls).toBe(1);
    expect(result.deferred[0].nextAttemptAt).toBeNull();
    expect(result.untouched.map(idOf)).toEqual(['a2']);
  });

  it('opens the group as soon as its head leaves, whatever the reason', async () => {
    const operations = [movement('a1', 'A', 10), movement('a2', 'A', 9)];
    const executed: string[] = [];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        // Un refus definitif libere la suite du groupe tout autant qu'un succes.
        return idOf(operation) === 'a1' ? { kind: 'terminal' } : { kind: 'applied' };
      },
    });

    expect(executed).toEqual(['a1', 'a2']);
    expect(result.terminal.map(idOf)).toEqual(['a1']);
    expect(result.applied.map(idOf)).toEqual(['a2']);
  });
});

describe('global scopes stop everything', () => {
  it.each([
    ['backend', 'backend'],
    ['authentication', 'authentication'],
  ] as const)('stops the pass on a %s scope', async (_label, reason) => {
    const operations = [movement('a1', 'A', 10), movement('b1', 'B', 9), movement('c1', 'C', 8)];
    const executed: string[] = [];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        return { kind: 'abandon', reason } as PassOperationOutcome<RetryQueueOperationLike>;
      },
    });

    // Un 429 ou un 401 concerne tout le client : envoyer les suivantes ne
    // recolterait que les memes refus.
    expect(executed).toEqual(['a1']);
    expect(result.abandoned).toBe(true);
    expect(result.abandonReason).toBe(reason);
    expect(result.untouched.map(idOf)).toEqual(['b1', 'c1']);
    // L operation declenchante a bien ete tentee : elle est differee, pas
    // rangee parmi celles qu on n a jamais touchees.
    expect(result.deferred).toEqual([{ operation: operations[0], nextAttemptAt: null }]);
    expect(result.untouched.map(idOf)).not.toContain('a1');
  });

  it('stops immediately when a newer pass takes over', async () => {
    const operations = [movement('a1', 'A', 10), movement('b1', 'B', 9)];
    let current = true;

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      isCurrentGeneration: () => current,
      execute: async () => { current = false; return { kind: 'applied' }; },
    });

    expect(result.processed).toBe(1);
    expect(result.abandonReason).toBe('preempted');
  });
});

describe('the entry journal carries physical identity', () => {
  it('emits exactly one line per snapshot entry, in order', async () => {
    const operations = [movement('a1', 'A', 10), movement('a2', 'A', 9), movement('b1', 'B', 8)];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => (
        idOf(operation) === 'a1' ? { kind: 'deferred', nextAttemptAt: iso(NOW + 60_000) } : { kind: 'applied' }
      ),
    });

    expect(result.entries.map(entry => [entry.token, entry.kind])).toEqual([
      [0, 'deferred'],
      [1, 'untouched'],
      [2, 'applied'],
    ]);
    expect(result.entries.map(entry => entry.originalIndex)).toEqual([0, 1, 2]);
    expect(result.entries[0].nextAttemptAt).toBe(iso(NOW + 60_000));
  });

  it('keeps the token stable when the operation changes identity', async () => {
    // Un rebase change volontairement d'identifiant. Retrouver l'entree par son
    // `id` la manquerait, et la reconstruction insererait un doublon.
    const operations = [movement('avant', 'A', 10)];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => ({
        kind: 'deferred',
        operation: { ...operation, id: 'apres-rebase' },
        nextAttemptAt: null,
      }),
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].token).toBe(0);
    expect(idOf(result.entries[0].resolved)).toBe('apres-rebase');
    // La version d'AVANT la passe reste celle du snapshot de l'appelant.
    expect(idOf(operations[0])).toBe('avant');
  });

  it('separates two entries sharing one identifier', async () => {
    // LA raison d'etre du jeton : retirer par `id` supprimait les DEUX entrees
    // apres l'execution d'une seule.
    const operations = [movement('meme', 'A', 10), movement('meme', 'A', 9)];
    let first = true;

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => {
        if (first) { first = false; return { kind: 'applied' }; }
        return { kind: 'deferred', nextAttemptAt: null };
      },
    });

    expect(result.entries.map(entry => entry.kind)).toEqual(['applied', 'deferred']);
  });

  it('marks the operation that stopped the pass as abandoned, not merely deferred', async () => {
    const operations = [movement('a1', 'A', 10), movement('b1', 'B', 9)];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => ({ kind: 'abandon', reason: 'backend', nextAttemptAt: iso(NOW + 120_000) }),
    });

    expect(result.entries.map(entry => entry.kind)).toEqual(['abandon', 'untouched']);
    expect(result.entries[0].nextAttemptAt).toBe(iso(NOW + 120_000));
  });

  it('promises no original version, because execute may mutate in place', async () => {
    // Un champ `original` serait une promesse que la structure ne tient pas :
    // l'ordonnanceur transmet l'operation elle-meme, et rien n'empeche
    // `execute` d'en muter un payload imbrique. Le reconstructeur doit donc
    // utiliser SON propre snapshot, pris avant la passe.
    const snapshot = [{ ...movement('a1', 'A', 10), data: { value: 1 } }];

    const result = await runSyncPass({
      operations: snapshot,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        (operation as any).data.value = 2;
        return { kind: 'deferred', operation, nextAttemptAt: null };
      },
    });

    // Demonstration de la mutation possible : c'est bien pour cela qu'aucune
    // version d'origine n'est promise.
    expect((snapshot[0] as any).data.value).toBe(2);
    expect(result.entries[0]).not.toHaveProperty('original');
    expect(result.entries[0].token).toBe(0);
  });

  it('skips operations already terminal, leaving no journal line for them', async () => {
    // Elles ne sont pas transmises a l'ordonnanceur : c'est au snapshot P5 de
    // les conserver a leur place, pas au journal de les inventer.
    const operations = [
      { ...movement('refusee', 'A', 10), terminal: true },
      movement('a1', 'A', 9),
    ];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => ({ kind: 'applied' }),
    });

    expect(result.entries.map(entry => entry.token)).toEqual([1]);
  });
});

describe('convergence and reporting', () => {
  it('lets a conflict leave the working set without a deadline', async () => {
    // Un conflit est rendu a la logique metier de rebase : il ne doit ni
    // bloquer son groupe, ni recevoir une echeance de reessai.
    const operations = [movement('a1', 'A', 10), movement('a2', 'A', 9)];
    const executed: string[] = [];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => {
        executed.push(idOf(operation));
        return idOf(operation) === 'a1' ? { kind: 'conflict' } : { kind: 'applied' };
      },
    });

    expect(executed).toEqual(['a1', 'a2']);
    expect(result.conflicts.map(idOf)).toEqual(['a1']);
    expect(result.deferred).toHaveLength(0);
    expect(result.abandoned).toBe(false);
  });

  it('cannot spin: every outcome either removes or defers the operation', async () => {
    // La convergence est STRUCTURELLE, pas surveillee : applied, terminal et
    // conflict retirent l operation ; deferred la rend ineligible ; abandon
    // arrete la passe. `maxOperations` n est donc qu une ceinture de securite,
    // atteignable seulement sur une file legitimement enorme.
    for (const kind of ['applied', 'terminal', 'conflict', 'deferred'] as const) {
      const result = await runSyncPass({
        operations: [movement('a1', 'A', 10)],
        now: frozenClock,
        onExecuteError: unexpected,
        maxOperations: 3,
        execute: async () => ({ kind } as PassOperationOutcome<RetryQueueOperationLike>),
      });

      expect(result.processed, kind).toBe(1);
      expect(result.abandonReason, kind).not.toBe('operation_budget');
    }
  });

  it('honours the operation budget', async () => {
    const operations = Array.from({ length: 50 }, (_, i) => movement(`m${i}`, `P${i}`, 50 - i));

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      maxOperations: 7,
      execute: async () => ({ kind: 'applied' }),
    });

    expect(result.processed).toBe(7);
    expect(result.abandonReason).toBe('operation_budget');
    expect(result.untouched).toHaveLength(43);
  });

  it('skips operations already refused before the pass', async () => {
    const operations = [
      { ...movement('refusee', 'A', 10), terminal: true },
      movement('a1', 'A', 9),
    ];
    const executed: string[] = [];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async operation => { executed.push(idOf(operation)); return { kind: 'applied' }; },
    });

    expect(executed).toEqual(['a1']);
    expect(result.untouched).toHaveLength(0);
  });

  it('never leaks the in-pass deadline into the reported operations', async () => {
    // L'echeance interne rend l'operation ineligible pour le reste de la passe ;
    // la persister ferait attendre 24 h a une operation qui doit repartir vite.
    const operations = [movement('a1', 'A', 10), movement('a2', 'A', 9)];

    const result = await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      execute: async () => ({ kind: 'deferred' }),
    });

    expect(result.deferred[0].operation.nextAttemptAt).toBeUndefined();
    expect(result.untouched[0].nextAttemptAt).toBeUndefined();
  });

  it('reports progress against the initial replayable count', async () => {
    const onProgress = vi.fn();
    const operations = [movement('a1', 'A', 10), movement('b1', 'B', 9)];

    await runSyncPass({
      operations,
      now: frozenClock,
      onExecuteError: unexpected,
      onProgress,
      execute: async () => ({ kind: 'applied' }),
    });

    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it('does nothing on an empty queue', async () => {
    const execute = vi.fn();
    const result = await runSyncPass({ operations: [], now: frozenClock, onExecuteError: unexpected, execute });

    expect(execute).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
    expect(result.abandoned).toBe(false);
  });

  it('does not touch an operation whose deadline is still ahead', async () => {
    const execute = vi.fn();
    const result = await runSyncPass({
      operations: [{ ...movement('a1', 'A', 10), nextAttemptAt: iso(NOW + 60_000) }],
      now: frozenClock,
      onExecuteError: unexpected,
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.untouched.map(idOf)).toEqual(['a1']);
  });
});
