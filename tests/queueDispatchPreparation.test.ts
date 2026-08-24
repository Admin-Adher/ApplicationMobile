import { describe, expect, it, vi } from 'vitest';
import { prepareQueueForDispatch } from '../lib/queueDispatchPreparation';
import { isUnambiguouslyPurgeableOperation } from '../lib/manualQueuePurge';

type Op = { id: string; dispatchState?: 'never_started' | 'unknown' | 'started' };

const needsProof = (operation: Op) => operation.dispatchState !== 'started';
const markStarted = (operation: Op): Op => ({ ...operation, dispatchState: 'started' });

/** Ecriture dont on choisit le moment de resolution. */
function controllableWrite() {
  const pending: { next: Op[]; settle: (error?: unknown) => void }[] = [];
  const writeStrict = vi.fn((next: Op[]) => new Promise<void>((resolve, reject) => {
    pending.push({ next, settle: error => (error ? reject(error) : resolve()) });
  }));
  return { writeStrict, pending };
}

/** Laisse la boucle de recalcul avancer sans horloge factice. */
async function flush() {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
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

    const prepared = await prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict,
      publish: () => {},
    });

    expect(prepared.proofWritten).toBe(false);
    expect(writeStrict).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', 'unknown' as const],
    ['never_started', 'never_started' as const],
    ['absent', undefined],
  ])('demands the proof for an entry in state %s', async (_label, dispatchState) => {
    const writeStrict = vi.fn(async () => {});
    let current: Op[] = [{ id: 'a', dispatchState }];

    const prepared = await prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict,
      publish: next => { current = next; },
    });

    expect(prepared.proofWritten).toBe(true);
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

  it('refuses to hand back a snapshot for an obsolete generation, even with nothing to write', async () => {
    // Sans ecriture a faire, la barriere rendait autrefois son verdict sans
    // rien verifier : une passe preemptee repartait avec la file du compte
    // suivant.
    const current: Op[] = [{ id: 'a', dispatchState: 'started' }];

    await expect(prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict: async () => {},
      publish: () => {},
      assertCurrent: () => { throw new Error('Passe obsolete.'); },
    })).rejects.toThrow('Passe obsolete.');
  });
});

describe('the pass runs the queue whose durability was just established', () => {
  /**
   * Reproduit la composition reelle : barriere -> snapshot -> boucle.
   *
   * `enqueueOperation` publie en memoire et ne lance qu'une sauvegarde
   * best-effort, ni attendue ni garantie. Relire l'etat courant apres la
   * barriere transmettait donc au moteur des entrees dont rien n'assurait la
   * presence sur le disque.
   */
  async function runPass(input: { initial: Op[]; enqueuedAfterBarrier?: Op }) {
    let current: Op[] = input.initial;

    const prepared = await prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict: async () => {},
      publish: next => { current = next; },
    });

    if (input.enqueuedAfterBarrier) current = [...current, input.enqueuedAfterBarrier];

    return { prepared, executed: prepared.operations.map(operation => operation.id), current };
  }

  it('leaves out an entry enqueued after a barrier that had nothing to write', async () => {
    const { prepared, executed, current } = await runPass({
      initial: [{ id: 'a', dispatchState: 'started' }],
      enqueuedAfterBarrier: { id: 'b', dispatchState: 'unknown' },
    });

    expect(prepared.proofWritten).toBe(false);
    expect(executed).toEqual(['a']);
    // B n'est pas perdue : elle reste dans l'etat courant, sera conservee comme
    // ajout concurrent, et franchira la barriere a la passe suivante.
    expect(current.map(operation => operation.id)).toEqual(['a', 'b']);
  });

  it('leaves out an entry enqueued right after a successful strict write', async () => {
    const { prepared, executed, current } = await runPass({
      initial: [{ id: 'a', dispatchState: 'unknown' }],
      enqueuedAfterBarrier: { id: 'b', dispatchState: 'unknown' },
    });

    expect(prepared.proofWritten).toBe(true);
    expect(executed).toEqual(['a']);
    expect(prepared.operations[0].dispatchState).toBe('started');
    expect(current.find(operation => operation.id === 'b')?.dispatchState).toBe('unknown');
  });

  it('carries the proof for every entry it hands to the pass', async () => {
    // L'invariant final : rien de ce que la boucle recoit ne peut partir sans
    // qu'une ecriture stricte l'ait precede.
    const { prepared } = await runPass({
      initial: [
        { id: 'a', dispatchState: 'unknown' },
        { id: 'b', dispatchState: 'never_started' },
        { id: 'c', dispatchState: 'started' },
      ],
    });

    for (const operation of prepared.operations) {
      expect(operation.dispatchState).toBe('started');
    }
  });

  it('includes an entry enqueued DURING the strict write, once its own proof is written', async () => {
    // Le cas limite oppose : arrivee avant la fin de l'ecriture, B entre dans le
    // recalcul, donc sa preuve est persistee avec celle de A. Elle a le droit de
    // partir dans cette passe-ci.
    const { writeStrict, pending } = controllableWrite();
    let current: Op[] = [{ id: 'a', dispatchState: 'unknown' }];

    const running = prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict,
      publish: next => { current = next; },
    });

    await flush();
    expect(writeStrict).toHaveBeenCalledTimes(1);

    // Nouvelle REFERENCE : c'est ce que le helper compare pour detecter la
    // saisie concurrente.
    current = [...current, { id: 'b', dispatchState: 'unknown' }];
    pending[0].settle();
    await flush();

    expect(pending).toHaveLength(2);
    pending[1].settle();
    const prepared = await running;

    expect(pending[1].next).toEqual([
      { id: 'a', dispatchState: 'started' },
      { id: 'b', dispatchState: 'started' },
    ]);
    expect(prepared.operations.map(operation => operation.id)).toEqual(['a', 'b']);
    for (const operation of prepared.operations) {
      expect(operation.dispatchState).toBe('started');
    }
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

    const prepared = await prepareQueueForDispatch<Op>({
      readCurrent: () => current,
      needsProof,
      markStarted,
      writeStrict: async () => {},
      publish: next => { current = next; },
    });

    expect(isUnambiguouslyPurgeableOperation(current[0])).toBe(false);
    // Et c'est bien l'exemplaire marque que la passe recoit.
    expect(isUnambiguouslyPurgeableOperation(prepared.operations[0])).toBe(false);
  });
});
