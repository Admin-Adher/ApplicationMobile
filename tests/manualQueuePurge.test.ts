import { describe, expect, it, vi } from 'vitest';
import {
  PURGE_PENDING_RECONCILIATION,
  QueuePurgeBusyError,
  QueuePurgeOwnershipError,
  isUnambiguouslyPurgeableOperation,
  resumePendingQueuePurge,
  runManualQueuePurge,
} from '../lib/manualQueuePurge';

type Op = {
  entryId: string;
  dispatchState?: 'never_started' | 'started';
  terminal?: boolean;
  purgeState?: string;
};

const op = (entryId: string, over: Partial<Op> = {}): Op => ({
  entryId,
  dispatchState: 'never_started',
  ...over,
});

function harness(over: Partial<Parameters<typeof runManualQueuePurge<Op>>[0]> = {}) {
  let current: Op[] = [op('a'), op('b')];
  const events: string[] = [];
  const persisted: Op[][] = [];

  const base = {
    isSyncing: () => false,
    acquire: () => { events.push('verrou pris'); },
    release: () => { events.push('verrou rendu'); },
    isOwner: () => true,
    readCurrent: () => current,
    entryIdOf: (operation: Op) => operation.entryId,
    isPurgeable: isUnambiguouslyPurgeableOperation,
    hasCompensator: () => true,
    backup: async () => { events.push('sauvegarde'); },
    persist: async (compute: (c: readonly Op[]) => Op[]) => {
      current = compute(current);
      persisted.push(current.map(entry => ({ ...entry })));
      events.push('persiste');
      return current;
    },
    markPending: (operation: Op) => ({ ...operation, purgeState: PURGE_PENDING_RECONCILIATION }),
    reconcile: async () => { events.push('reconcilie'); },
    reset: (outcome: string) => { events.push(`remise a zero ${outcome}`); },
  };

  return {
    events,
    persisted,
    setCurrent: (next: Op[]) => { current = next; },
    getCurrent: () => current,
    run: () => runManualQueuePurge<Op>({ ...base, ...over }),
  };
}

describe('only a durable proof of never having been sent allows deletion', () => {
  it('allows an operation whose durable state says it never started', () => {
    expect(isUnambiguouslyPurgeableOperation({ dispatchState: 'never_started' })).toBe(true);
  });

  it.each([
    ['started', { dispatchState: 'started' as const }],
    ['absent — file heritee', {}],
    ['corrompu', { dispatchState: 'peut-etre' as never }],
  ])('keeps an operation whose state is %s', (_label, operation) => {
    // Absence de preuve d'envoi n'est pas preuve d'absence d'envoi : une
    // metadonnee illisible ou une file anterieure au champ ne demontrent rien.
    expect(isUnambiguouslyPurgeableOperation(operation)).toBe(false);
  });

  it('keeps a terminal refusal, whatever its dispatch state', () => {
    // `terminal` dit que le sort SERVEUR est connu ; il ne dit rien de la
    // coherence de l'etat local, et rien ne prouve que sa reconciliation a
    // abouti. Ces entrees ont leur propre parcours d'acquittement.
    expect(isUnambiguouslyPurgeableOperation({
      terminal: true,
      dispatchState: 'never_started',
    })).toBe(false);
  });
});

describe('the purge refuses to start on a running pass', () => {
  it('throws instead of preempting', async () => {
    // `AbortController` coupe le transport client, il n'annule pas une
    // transaction PostgreSQL : le serveur peut avoir commite juste avant.
    const h = harness({ isSyncing: () => true });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeBusyError);
    expect(h.events).toEqual([]);
  });

  it('proceeds when nothing is in flight', async () => {
    const h = harness();
    await h.run();

    expect(h.events).toContain('persiste');
  });
});

describe('the lock is taken before the first await', () => {
  it('acquires before backing anything up', async () => {
    const h = harness();
    await h.run();

    expect(h.events[0]).toBe('verrou pris');
    expect(h.events.indexOf('verrou pris')).toBeLessThan(h.events.indexOf('sauvegarde'));
  });

  it('releases it even when a phase fails', async () => {
    const h = harness({ reconcile: async () => { throw new Error('cache indisponible'); } });

    await expect(h.run()).rejects.toThrow('cache indisponible');
    expect(h.events).toContain('remise a zero failed');
    expect(h.events[h.events.length - 1]).toBe('verrou rendu');
  });
});

describe('the deletion is transactional', () => {
  it('marks pending BEFORE reconciling, and removes only after', async () => {
    const h = harness();
    await h.run();

    // Marquage, reconciliations, puis suppression.
    expect(h.events).toEqual([
      'verrou pris', 'sauvegarde', 'persiste',
      'reconcilie', 'reconcilie',
      'persiste',
      'remise a zero succeeded', 'verrou rendu',
    ]);
    expect(h.persisted[0].every(entry => entry.purgeState === PURGE_PENDING_RECONCILIATION)).toBe(true);
    expect(h.persisted[1]).toEqual([]);
  });

  it('keeps the entry when reconciliation fails', async () => {
    // Supprimer d'abord laissait le stock optimiste en desaccord avec le
    // serveur, sans plus aucune operation pour reparer l'ecart.
    const h = harness({ reconcile: async () => { throw new Error('cache indisponible'); } });

    await expect(h.run()).rejects.toThrow('cache indisponible');

    expect(h.getCurrent()).toHaveLength(2);
    expect(h.getCurrent().every(entry => entry.purgeState === PURGE_PENDING_RECONCILIATION)).toBe(true);
  });

  it('stops at the first reconciliation failure, keeping the rest', async () => {
    let calls = 0;
    const h = harness({
      reconcile: async () => {
        calls += 1;
        if (calls === 2) throw new Error('cache indisponible');
      },
    });

    await expect(h.run()).rejects.toThrow('cache indisponible');
    expect(calls).toBe(2);
    // Aucune suppression : la phase 3 n'a jamais eu lieu.
    expect(h.getCurrent()).toHaveLength(2);
  });
});

describe('an interrupted purge resumes at hydration', () => {
  it('reconciles then removes the entries left pending', async () => {
    let current: Op[] = [
      op('a', { purgeState: PURGE_PENDING_RECONCILIATION }),
      op('b'),
    ];
    const reconciled: string[] = [];

    const resumed = await resumePendingQueuePurge<Op>({
      readCurrent: () => current,
      isPending: operation => operation.purgeState === PURGE_PENDING_RECONCILIATION,
      entryIdOf: operation => operation.entryId,
      persist: async compute => { current = compute(current); return current; },
      reconcile: async operation => { reconciled.push(operation.entryId); },
    });

    expect(reconciled).toEqual(['a']);
    expect(resumed.map(o => o.entryId)).toEqual(['a']);
    expect(current.map(o => o.entryId)).toEqual(['b']);
  });

  it('leaves the entry pending when the reconciliation fails again', async () => {
    let current: Op[] = [op('a', { purgeState: PURGE_PENDING_RECONCILIATION })];

    await expect(resumePendingQueuePurge<Op>({
      readCurrent: () => current,
      isPending: operation => operation.purgeState === PURGE_PENDING_RECONCILIATION,
      entryIdOf: operation => operation.entryId,
      persist: async compute => { current = compute(current); return current; },
      reconcile: async () => { throw new Error('toujours indisponible'); },
    })).rejects.toThrow('toujours indisponible');

    // Reprenable au prochain demarrage, jamais supprimee sans reparation.
    expect(current).toHaveLength(1);
  });

  it('does nothing when no purge was interrupted', async () => {
    const persist = vi.fn();

    const resumed = await resumePendingQueuePurge<Op>({
      readCurrent: () => [op('a')],
      isPending: operation => operation.purgeState === PURGE_PENDING_RECONCILIATION,
      entryIdOf: operation => operation.entryId,
      persist,
      reconcile: async () => {},
    });

    expect(resumed).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('an obsolete invocation touches nothing', () => {
  it('stops when the account changed during the backup', async () => {
    let owner = true;
    const persist = vi.fn(async (compute: (c: readonly Op[]) => Op[]) => compute([]));
    const h = harness({ isOwner: () => owner, backup: async () => { owner = false; }, persist });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeOwnershipError);
    expect(persist).not.toHaveBeenCalled();
  });

  it('stops between two reconciliations', async () => {
    let owner = true;
    let calls = 0;
    const h = harness({
      isOwner: () => owner,
      reconcile: async () => { calls += 1; owner = false; },
    });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeOwnershipError);
    expect(calls).toBe(1);
  });

  it('neither resets nor releases the state of the account that took over', async () => {
    let owner = true;
    const reset = vi.fn();
    const release = vi.fn();
    const finalize = vi.fn();
    const h = harness({
      isOwner: () => owner,
      backup: async () => { owner = false; },
      reset,
      release,
      finalize,
    });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeOwnershipError);
    expect(reset).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('finalises while it is still the owner, on success AND on failure', async () => {
    const finalize = vi.fn();
    await harness({ finalize }).run();
    expect(finalize).toHaveBeenCalledWith('succeeded');

    const failing = harness({ finalize, reconcile: async () => { throw new Error('boum'); } });
    await expect(failing.run()).rejects.toThrow('boum');
    expect(finalize).toHaveBeenLastCalledWith('failed');
  });
});

describe('survivors are categorised, never lumped together', () => {
  it('separates ambiguous, identity-less, compensator-less and concurrent', async () => {
    // L'interface annoncait « deja envoyees » pour toutes les survivantes —
    // faux pour une saisie creee pendant la purge.
    const h = harness({
      hasCompensator: (operation: Op) => operation.entryId !== 'sans-compensateur',
      entryIdOf: (operation: Op) => (operation.entryId === 'anonyme' ? null : operation.entryId),
      persist: async compute => {
        const next = compute(h.getCurrent());
        // Une saisie apparait pendant la purge.
        const withAddition = next.some(o => o.entryId === 'pendant')
          ? next
          : [...next, op('pendant')];
        h.setCurrent(withAddition);
        return withAddition;
      },
    });
    h.setCurrent([
      op('supprimable'),
      op('deja-envoyee', { dispatchState: 'started' }),
      op('sans-compensateur'),
      op('anonyme'),
    ]);

    const result = await h.run();

    expect(result.removed.map(o => o.entryId)).toEqual(['supprimable']);
    expect(result.keptAmbiguous.map(o => o.entryId)).toEqual(['deja-envoyee']);
    expect(result.keptWithoutCompensator.map(o => o.entryId)).toEqual(['sans-compensateur']);
    expect(result.keptWithoutIdentity.map(o => o.entryId)).toEqual(['anonyme']);
    expect(result.concurrentAdditions.map(o => o.entryId)).toEqual(['pendant']);
  });

  it('never removes an entry it cannot identify physically', async () => {
    const h = harness({ entryIdOf: () => null });
    h.setCurrent([op('a'), op('b')]);

    const result = await h.run();

    expect(result.removed).toEqual([]);
    expect(result.keptWithoutIdentity).toHaveLength(2);
  });
});
