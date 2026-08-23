import { describe, expect, it, vi } from 'vitest';
import { publishAfterDurableWrite } from '../lib/queuePublication';

type Op = { id: string };

/** Ecriture dont on choisit le moment de resolution. */
function controllableWrite() {
  const pending: { value: Op[]; settle: (error?: unknown) => void }[] = [];
  const write = vi.fn((value: Op[]) => new Promise<void>((resolve, reject) => {
    pending.push({ value, settle: error => (error ? reject(error) : resolve()) });
  }));
  return { write, pending };
}

describe('nothing is published before the disk is up to date', () => {
  it('publishes only after the write resolves', async () => {
    const events: string[] = [];
    const { write, pending } = controllableWrite();
    let current: Op[] = [{ id: 'A' }];

    const running = publishAfterDurableWrite<Op>({
      readCurrent: () => current,
      compute: () => [],
      write: value => { events.push('ecrit'); return write(value); },
      publish: () => { events.push('publie'); current = []; },
    });

    await Promise.resolve();
    expect(events).toEqual(['ecrit']);
    pending[0].settle();
    await running;

    expect(events).toEqual(['ecrit', 'publie']);
  });

  it('publishes nothing when the write rejects', async () => {
    const current: Op[] = [{ id: 'A' }];
    const publish = vi.fn();

    await expect(publishAfterDurableWrite<Op>({
      readCurrent: () => current,
      compute: () => [],
      write: async () => { throw new Error('disque plein'); },
      publish,
    })).rejects.toThrow('disque plein');

    expect(publish).not.toHaveBeenCalled();
    // L'appelant conserve son etat : rien n'a ete supprime.
    expect(current).toEqual([{ id: 'A' }]);
  });
});

describe('an entry created during the write survives it', () => {
  it('recomputes and rewrites behind the queue that moved', async () => {
    // LE scenario : la chaine serialise le disque, pas la publication memoire.
    // Sans ce recalcul, la persistance de B se terminait APRES la publication
    // d'une file vide — B disparaissait de l'interface, et la sauvegarde
    // suivante l'effacait du disque.
    const { write, pending } = controllableWrite();
    let current: Op[] = [{ id: 'A' }];
    let published: Op[] | null = null;

    const purge = new Set(['A']);
    const running = publishAfterDurableWrite<Op>({
      readCurrent: () => current,
      compute: existing => existing.filter(operation => !purge.has(operation.id)),
      write,
      publish: next => { published = next; current = next; },
    });

    await Promise.resolve();
    // B arrive pendant que la premiere ecriture court.
    current = [{ id: 'A' }, { id: 'B' }];
    pending[0].settle();
    await Promise.resolve();
    await Promise.resolve();

    // Une seconde ecriture est partie, calculee sur la file la plus recente.
    expect(write).toHaveBeenCalledTimes(2);
    expect(pending[1].value).toEqual([{ id: 'B' }]);
    pending[1].settle();
    await running;

    expect(published).toEqual([{ id: 'B' }]);
    expect(current).toEqual([{ id: 'B' }]);
  });

  it('does not recompute when the queue stayed still', async () => {
    // Verrou sur la premisse : recalculer toujours ferait passer le test
    // ci-dessus sans rien prouver.
    const write = vi.fn(async () => {});
    const current: Op[] = [{ id: 'A' }];

    await publishAfterDurableWrite<Op>({
      readCurrent: () => current,
      compute: () => [],
      write,
      publish: () => {},
    });

    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe('a queue that never settles stops the operation', () => {
  it('gives up instead of looping forever', async () => {
    let generation = 0;
    // La file change a CHAQUE lecture : aucune tentative ne peut aboutir.
    const readCurrent = () => [{ id: `gen-${(generation += 1)}` }];

    await expect(publishAfterDurableWrite<Op>({
      readCurrent,
      compute: () => [],
      write: async () => {},
      publish: () => {},
      maxAttempts: 3,
    })).rejects.toThrow(/evolue continuellement/);
  });
});
