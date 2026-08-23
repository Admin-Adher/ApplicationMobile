import { describe, expect, it, vi } from 'vitest';
import { prepareQueueForDispatch } from '../lib/queueDispatchPreparation';
import { isUnambiguouslyPurgeableOperation } from '../lib/manualQueuePurge';

type Op = { id: string; dispatchState?: 'never_started' | 'unknown' | 'started' };

const needsProof = (operation: Op) => operation.dispatchState !== 'started';
const markStarted = (operation: Op): Op => ({ ...operation, dispatchState: 'started' });

/** Ecriture dont on choisit le moment de resolution. */
function controllableWrite() {
  const pending: { settle: (error?: unknown) => void }[] = [];
  const writeStrict = vi.fn(() => new Promise<void>((resolve, reject) => {
    pending.push({ settle: error => (error ? reject(error) : resolve()) });
  }));
  return { writeStrict, pending };
}

describe('no request may leave before the proof is durable', () => {
  it('does not resolve while the strict write is still pending', async () => {
    // LE defaut ferme ici : marquer `started` des l'entree en file faisait
    // sauter cette barriere a la passe suivante, et la requete partait sans
    // qu'aucune trace durable n'existe.
    const { writeStrict, pending } = controllableWrite();
    let current: Op[] = [{ id: 'a', dispatchState: 'unknown' }];
    let settled = false;

    const running = prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict,
      publish: next => { current = next; },
    }).then(() => { settled = true; });

    await Promise.resolve();
    await Promise.resolve();

    expect(writeStrict).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    // Rien n'est publie tant que le disque n'a pas repondu.
    expect(current[0].dispatchState).toBe('unknown');

    pending[0].settle();
    await running;

    expect(settled).toBe(true);
    expect(current[0].dispatchState).toBe('started');
  });

  it('propagates the failure so the caller abandons the pass', async () => {
    let current: Op[] = [{ id: 'a', dispatchState: 'unknown' }];

    await expect(prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict: async () => { throw new Error('disque plein'); },
      publish: next => { current = next; },
    })).rejects.toThrow('disque plein');

    // L'operation garde son etat : rien n'a ete publie.
    expect(current[0].dispatchState).toBe('unknown');
  });

  it('writes nothing when every entry already carries the proof', async () => {
    const writeStrict = vi.fn(async () => {});
    // Reference STABLE : le helper compare le tableau avant et apres l'ecriture
    // pour detecter une saisie concurrente. Rendre un nouveau tableau a chaque
    // lecture ferait croire a un changement permanent.
    const current: Op[] = [{ id: 'a', dispatchState: 'started' }];

    const outcome = await prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict,
      publish: () => {},
    });

    expect(outcome).toBe('nothing-to-do');
    expect(writeStrict).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', 'unknown' as const],
    ['never_started', 'never_started' as const],
    ['absent', undefined],
  ])('demands the proof for an entry in state %s', async (_label, dispatchState) => {
    const writeStrict = vi.fn(async () => {});
    let current: Op[] = [{ id: 'a', dispatchState }];

    const outcome = await prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict,
      publish: next => { current = next; },
    });

    expect(outcome).toBe('ready');
    expect(writeStrict).toHaveBeenCalledTimes(1);
  });

  it('refuses to write for a generation that is no longer current', async () => {
    const writeStrict = vi.fn(async () => {});

    const current: Op[] = [{ id: 'a', dispatchState: 'unknown' }];

    await expect(prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict,
      publish: () => {},
      assertCurrent: () => { throw new Error('Passe obsolete.'); },
    })).rejects.toThrow('Passe obsolete.');

    expect(writeStrict).not.toHaveBeenCalled();
  });
});

describe('the three states say three different things', () => {
  it('only an explicit never_started allows deletion', () => {
    expect(isUnambiguouslyPurgeableOperation({ dispatchState: 'never_started' })).toBe(true);
  });

  it.each([
    ['unknown — sort anterieur inconnu', 'unknown' as const],
    ['started — preuve durable ecrite', 'started' as const],
  ])('keeps an entry in state %s', (_label, dispatchState) => {
    // `unknown` n'est pas une valeur par defaut commode : c'est l'aveu que le
    // sort de cette ecriture n'est pas connu, donc qu'elle ne peut pas etre
    // supprimee sans risquer d'effacer la trace d'un commit serveur.
    expect(isUnambiguouslyPurgeableOperation({ dispatchState })).toBe(false);
  });

  it('a proven never_started stops being purgeable once the pass has marked it', async () => {
    // La barriere de persistance change l'etat AVANT que le reseau puisse
    // partir : ce qui etait supprimable en toute securite cesse de l'etre au
    // moment exact ou une requete devient possible.
    let current: Op[] = [{ id: 'a', dispatchState: 'never_started' }];

    expect(isUnambiguouslyPurgeableOperation(current[0])).toBe(true);

    await prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict: async () => {},
      publish: next => { current = next; },
    });

    expect(isUnambiguouslyPurgeableOperation(current[0])).toBe(false);
  });
});
