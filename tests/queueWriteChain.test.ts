import { describe, expect, it, vi } from 'vitest';
import { createQueueWriteChain } from '../lib/queueWriteChain';

describe('a strict write really rejects', () => {
  it('propagates the storage failure to its caller', async () => {
    // L'implementation precedente journalisait puis RESOLVAIT : un `await` sur
    // cette promesse attendait un succes fabrique, et l'ecriture reseau partait
    // alors que l'identite preparee n'avait jamais atteint le disque.
    const setItem = vi.fn(async () => { throw new Error('AsyncStorage indisponible'); });
    const chain = createQueueWriteChain(setItem);

    await expect(chain.write('k', 'v')).rejects.toThrow('AsyncStorage indisponible');
  });

  it('resolves when the write lands', async () => {
    // Verrou sur la premisse : rejeter toujours ferait passer le test ci-dessus
    // sans rien prouver.
    const setItem = vi.fn(async () => {});
    const chain = createQueueWriteChain(setItem);

    await expect(chain.write('k', 'v')).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalledWith('k', 'v');
  });

  it('reports the failure once, to the observer', async () => {
    const onError = vi.fn();
    const chain = createQueueWriteChain(async () => { throw new Error('disque plein'); }, onError);

    await chain.write('k', 'v').catch(() => {});
    await Promise.resolve();

    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe('one failure never poisons the chain', () => {
  it('runs the next write after a rejected one', async () => {
    // Sans le maillon d'absorption, toute ecriture suivante heriterait du rejet
    // et la file cesserait definitivement d'etre persistee.
    let failNext = true;
    const setItem = vi.fn(async () => {
      if (failNext) { failNext = false; throw new Error('echec transitoire'); }
    });
    const chain = createQueueWriteChain(setItem);

    await chain.write('k', 'v1').catch(() => {});
    await expect(chain.write('k', 'v2')).resolves.toBeUndefined();
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('keeps writes in order, never letting an older one land last', async () => {
    // Deux enqueue rapproches : une ancienne version de la file finissant apres
    // la plus recente ferait ressusciter des operations deja retirees.
    const landed: string[] = [];
    const resolvers: (() => void)[] = [];
    const setItem = vi.fn((_key: string, value: string) => new Promise<void>(resolve => {
      resolvers.push(() => { landed.push(value); resolve(); });
    }));
    const chain = createQueueWriteChain(setItem);

    const first = chain.write('k', 'v1');
    const second = chain.write('k', 'v2');

    // La chaine passe par une micro-tache avant d'appeler `setItem`.
    await Promise.resolve();
    await Promise.resolve();
    // La seconde ecriture n'a meme pas demarre tant que la premiere court.
    expect(setItem).toHaveBeenCalledTimes(1);
    resolvers[0]();
    await first;
    // La seconde ne demarre qu'apres l'aboutissement de la premiere.
    await Promise.resolve();
    await Promise.resolve();
    expect(setItem).toHaveBeenCalledTimes(2);
    resolvers[1]();
    await second;

    expect(landed).toEqual(['v1', 'v2']);
  });
});

describe('a best-effort write never rejects', () => {
  it('swallows the failure for the historical paths', async () => {
    const chain = createQueueWriteChain(async () => { throw new Error('disque plein'); });

    await expect(chain.writeBestEffort('k', 'v')).resolves.toBeUndefined();
  });

  it('still serialises with the strict writes', async () => {
    const landed: string[] = [];
    const chain = createQueueWriteChain(async (_key, value) => { landed.push(value); });

    await Promise.all([
      chain.writeBestEffort('k', 'v1'),
      chain.write('k', 'v2'),
    ]);

    expect(landed).toEqual(['v1', 'v2']);
  });
});
