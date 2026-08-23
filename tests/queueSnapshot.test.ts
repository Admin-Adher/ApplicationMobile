import { describe, expect, it } from 'vitest';
import { cloneQueuedOperationsStrict } from '../lib/queueSnapshot';
import { runSyncPass } from '../lib/syncPassScheduler';
import { reconstructSyncQueue } from '../lib/syncQueueReconstruction';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
const isReplayable = (operation: any) => operation.terminal !== true;
const quarantine = (operation: any) => ({ ...operation, quarantined: true });
let counter = 0;
const newQueueEntryId = () => `repare-${(counter += 1)}`;

describe('a reconstruction snapshot must be independent', () => {
  it('shares nothing with the array handed to the scheduler', () => {
    const shared = { value: 1 };
    const original = [{ id: 'A', data: shared }, { id: 'B', data: shared }];

    const clone = cloneQueuedOperationsStrict(original);
    (clone[0].data as any).value = 2;

    expect(original[0].data.value).toBe(1);
    expect(clone[1].data).not.toBe(clone[0].data);
  });

  it('demonstrates what happens WITHOUT that independence', async () => {
    // Le cas le plus insidieux n'est pas l'operation executee — sa version
    // enrichie est rendue par le journal — mais sa VOISINE : deux entrees
    // peuvent partager un objet imbrique. Muter celui de la premiere modifie
    // la seconde, jamais tentee, et sa version « d'origine » devient fausse.
    const shared = { value: 1 };
    const snapshot: any[] = [
      { id: 'A', queueEntryId: 'q-a', queuedAt: new Date(NOW - 60_000).toISOString(), table: 't', data: shared },
      { id: 'B', queueEntryId: 'q-b', queuedAt: new Date(NOW - 30_000).toISOString(), table: 't', data: shared },
    ];

    await runSyncPass({
      operations: snapshot,
      now: () => NOW,
      onExecuteError: (_operation, error) => { throw error; },
      execute: async operation => {
        (operation as any).data.value = 2;
        return { kind: 'applied' };
      },
      maxOperations: 1,
    });

    // B n'a jamais ete tentee, et pourtant son payload a change.
    expect(snapshot[1].data.value).toBe(2);
  });

  it('protects the untried neighbour when the snapshot is cloned first', async () => {
    const shared = { value: 1 };
    const source: any[] = [
      { id: 'A', queueEntryId: 'q-a', queuedAt: new Date(NOW - 60_000).toISOString(), table: 't', data: shared },
      { id: 'B', queueEntryId: 'q-b', queuedAt: new Date(NOW - 30_000).toISOString(), table: 't', data: shared },
    ];

    // Deux structures distinctes, prises AVANT tout reseau.
    const reconstructionSnapshot = cloneQueuedOperationsStrict(source);
    const workingOperations = cloneQueuedOperationsStrict(reconstructionSnapshot);

    const pass = await runSyncPass({
      operations: workingOperations,
      now: () => NOW,
      onExecuteError: (_operation, error) => { throw error; },
      execute: async operation => {
        (operation as any).data.value = 2;
        return { kind: 'applied' };
      },
      maxOperations: 1,
    });

    const rebuilt = reconstructSyncQueue({
      snapshot: reconstructionSnapshot,
      entries: pass.entries,
      isReplayable,
      markQuarantined: quarantine,
      newQueueEntryId,
    });

    // A est appliquee et sort ; B subsiste avec la valeur du snapshot initial.
    expect(rebuilt.queue.map(o => o.id)).toEqual(['B']);
    expect((rebuilt.queue[0] as any).data.value).toBe(1);
  });
});

describe('the clone fails closed', () => {
  it('refuses a circular payload rather than copying part of it', () => {
    const circular: any = { id: 'a' };
    circular.self = circular;

    expect(() => cloneQueuedOperationsStrict([circular])).toThrow(/Instantane de file impossible/);
  });

  it('mirrors exactly what JSON persistence will store', () => {
    // Le clone passe par JSON — et non `structuredClone` — parce que la file
    // est persistee en JSON : un `structuredClone` conserverait des valeurs que
    // la persistance perdrait, et le snapshot ne correspondrait plus au disque.
    const [clone] = cloneQueuedOperationsStrict([{ id: 'a', absent: undefined, texte: 'x', liste: [1, 2] }]);

    expect(clone).toEqual({ id: 'a', texte: 'x', liste: [1, 2] });
    expect('absent' in clone).toBe(false);
  });

  it('returns an empty array unchanged', () => {
    expect(cloneQueuedOperationsStrict([])).toEqual([]);
  });
});
