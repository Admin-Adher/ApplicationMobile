import { describe, expect, it, vi } from 'vitest';
import {
  QueuePurgeBusyError,
  QueuePurgeOwnershipError,
  isUnambiguouslyPurgeableOperation,
  runManualQueuePurge,
} from '../lib/manualQueuePurge';

type Op = { entryId: string; attempted?: boolean };

const op = (entryId: string, attempted = false): Op => ({ entryId, attempted });

function harness(over: Partial<Parameters<typeof runManualQueuePurge<Op>>[0]> = {}) {
  let current: Op[] = [op('a'), op('b')];
  const events: string[] = [];

  const base = {
    isSyncing: () => false,
    acquire: () => { events.push('verrou pris'); },
    release: () => { events.push('verrou rendu'); },
    isOwner: () => true,
    readCurrent: () => current,
    entryIdOf: (operation: Op) => operation.entryId,
    isPurgeable: () => true,
    backup: async () => { events.push('sauvegarde'); },
    persist: async (compute: (c: readonly Op[]) => Op[]) => {
      events.push('persiste');
      current = compute(current);
      return current;
    },
    reconcile: async () => { events.push('reconcilie'); },
    reset: (outcome: string) => { events.push(`remise a zero ${outcome}`); },
  };

  return {
    events,
    setCurrent: (next: Op[]) => { current = next; },
    getCurrent: () => current,
    run: () => runManualQueuePurge<Op>({ ...base, ...over }),
  };
}

describe('the purge refuses to start on a running pass', () => {
  it('throws instead of preempting', async () => {
    // `AbortController` coupe le transport client, il n'annule pas une
    // transaction PostgreSQL : le serveur peut avoir commite juste avant de
    // constater la fermeture. Supprimer l'operation detruirait alors la seule
    // trace locale de son `operation_id`.
    const h = harness({ isSyncing: () => true });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeBusyError);
    expect(h.events).toEqual([]);
  });

  it('proceeds when nothing is in flight', async () => {
    // Verrou sur la premisse : tout refuser ferait passer le test ci-dessus.
    const h = harness();
    await h.run();

    expect(h.events).toContain('persiste');
  });
});

describe('the lock is taken before the first await', () => {
  it('acquires before backing anything up', async () => {
    // Sauvegarder d'abord laissait une fenetre pendant laquelle une passe
    // pouvait demarrer, une operation etre engendree, ou une reponse reseau
    // reconstruire la file.
    const h = harness();
    await h.run();

    expect(h.events.indexOf('verrou pris')).toBeLessThan(h.events.indexOf('sauvegarde'));
    expect(h.events[0]).toBe('verrou pris');
  });

  it('releases it even when the write fails', async () => {
    const h = harness({ persist: async () => { throw new Error('disque plein'); } });

    await expect(h.run()).rejects.toThrow('disque plein');
    expect(h.events).toContain('remise a zero failed');
    expect(h.events[h.events.length - 1]).toBe('verrou rendu');
  });
});

describe('an obsolete invocation touches nothing', () => {
  it('stops when the account changed during the backup', async () => {
    let owner = true;
    const persist = vi.fn(async (compute: (c: readonly Op[]) => Op[]) => compute([]));
    const h = harness({
      isOwner: () => owner,
      backup: async () => { owner = false; },
      persist,
    });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeOwnershipError);
    // Rien n'est ecrit sous la clef d'un compte qui n'est plus le notre.
    expect(persist).not.toHaveBeenCalled();
  });

  it('stops when the account changed during the write', async () => {
    let owner = true;
    const reconcile = vi.fn(async () => {});
    const h = harness({
      isOwner: () => owner,
      persist: async () => { owner = false; return []; },
      reconcile,
    });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeOwnershipError);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('neither resets nor releases the state of the account that took over', async () => {
    // L'ancienne purge liberait sinon le verrou d'une passe qui ne lui
    // appartient pas, et ecrasait le statut du nouveau compte.
    let owner = true;
    const reset = vi.fn();
    const release = vi.fn();
    const h = harness({
      isOwner: () => owner,
      backup: async () => { owner = false; },
      reset,
      release,
    });

    await expect(h.run()).rejects.toBeInstanceOf(QueuePurgeOwnershipError);
    expect(reset).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('does reset and release while it is still the owner', async () => {
    // Verrou sur la premisse.
    const reset = vi.fn();
    const release = vi.fn();
    const h = harness({ reset, release });

    await h.run();

    expect(reset).toHaveBeenCalledWith('succeeded');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('an ambiguous operation is never deleted', () => {
  it('keeps what was already attempted', async () => {
    // Une ecriture deja tentee peut avoir abouti sans que sa reponse soit
    // parvenue. La supprimer laisserait le cache optimiste en desaccord avec le
    // serveur, sans plus aucune operation pour reparer l'ecart.
    const h = harness({ isPurgeable: (operation: Op) => !operation.attempted });
    h.setCurrent([op('jamais-tentee'), op('deja-tentee', true)]);

    const { removed, kept } = await h.run();

    expect(removed.map(o => o.entryId)).toEqual(['jamais-tentee']);
    expect(kept.map(o => o.entryId)).toEqual(['deja-tentee']);
  });

  it('reconciles only what actually left the queue', async () => {
    const reconciled: Op[][] = [];
    const h = harness({
      isPurgeable: (operation: Op) => !operation.attempted,
      reconcile: async removed => { reconciled.push([...removed]); },
    });
    h.setCurrent([op('partie'), op('gardee', true)]);

    await h.run();

    expect(reconciled).toEqual([[op('partie')]]);
  });

  it('reconciles nothing when the write kept everything', async () => {
    // La persistance peut rendre une file inchangee — recalcul apres un enqueue
    // concurrent, par exemple. On n'annule alors aucun effet local.
    const reconcile = vi.fn(async () => {});
    const h = harness({ persist: async () => h.getCurrent(), reconcile });

    await h.run();

    expect(reconcile).toHaveBeenCalledWith([]);
  });
});

describe('entries without a physical identity are kept', () => {
  it('never removes what it cannot prove is the same entry', async () => {
    const h = harness({ entryIdOf: () => null });
    h.setCurrent([op('a'), op('b')]);

    const { removed, kept } = await h.run();

    expect(removed).toEqual([]);
    expect(kept).toHaveLength(2);
  });
});

describe('only two situations are free of ambiguity', () => {
  it('allows an operation that was never sent', () => {
    expect(isUnambiguouslyPurgeableOperation({})).toBe(true);
    expect(isUnambiguouslyPurgeableOperation({ attemptCount: 0 })).toBe(true);
  });

  it('allows an operation the server explicitly refused', () => {
    // Son effet local a deja ete reconcilie a la reception du refus.
    expect(isUnambiguouslyPurgeableOperation({ terminal: true, attemptCount: 5 })).toBe(true);
  });

  it.each([
    ['un compteur de tentatives', { attemptCount: 1 }],
    ['une derniere tentative', { lastAttemptAt: '2026-08-23T12:00:00.000Z' }],
    ['un dernier echec', { lastFailureAt: '2026-08-23T12:00:00.000Z' }],
  ])('refuses an operation carrying %s', (_label, operation) => {
    // Une ecriture tentee peut avoir abouti sans que sa reponse soit parvenue :
    // la supprimer laisserait le cache local en desaccord avec le serveur.
    expect(isUnambiguouslyPurgeableOperation(operation)).toBe(false);
  });

  it('ignores a corrupted attempt counter rather than trusting it', () => {
    // Une valeur illisible ne prouve pas qu'aucune tentative n'a eu lieu, mais
    // elle ne prouve pas non plus le contraire : on se rabat sur les
    // horodatages, seuls temoins fiables d'un envoi.
    expect(isUnambiguouslyPurgeableOperation({ attemptCount: 'trois' as never })).toBe(true);
    expect(isUnambiguouslyPurgeableOperation({
      attemptCount: 'trois' as never,
      lastAttemptAt: '2026-08-23T12:00:00.000Z',
    })).toBe(false);
  });
});
