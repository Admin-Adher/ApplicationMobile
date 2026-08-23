import { describe, expect, it } from 'vitest';
import { reconstructSyncQueue, type QueueAddition } from '../lib/syncQueueReconstruction';
import type { PassEntryKind, PassEntryResult } from '../lib/syncPassScheduler';

type Op = Record<string, any>;

const movement = (id: string, over: Op = {}): Op => ({
  id,
  queueEntryId: `q-${id}`,
  table: 'inventory_movements',
  op: 'rpc',
  rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'P1', quantity: 5 } } },
  ...over,
});

const quarantine = (operation: Op, reason: 'duplicate_id_mismatch') => ({
  ...operation,
  quarantined: true,
  quarantineReason: reason,
});

function entry(
  originalIndex: number,
  kind: PassEntryKind,
  resolved: Op,
  nextAttemptAt: string | null = null,
): PassEntryResult<Op> {
  return { token: originalIndex, originalIndex, resolved, kind, nextAttemptAt };
}

/** Le MEME predicat que celui remis a l'ordonnanceur. */
const isReplayable = (operation: Op) => operation.terminal !== true && operation.quarantined !== true;

let identityCounter = 0;
const newQueueEntryId = () => `repare-${(identityCounter += 1)}`;

const rebuild = (
  snapshot: Op[],
  entries: PassEntryResult<Op>[],
  additions?: QueueAddition<Op>[],
) => reconstructSyncQueue({
  snapshot,
  entries,
  additions,
  isReplayable,
  markQuarantined: quarantine,
  newQueueEntryId,
});

describe('each outcome lands on its own physical entry', () => {
  it('removes ONLY the applied entry when two share a business id', () => {
    // Retirer par `id` supprimait les DEUX apres l'execution d'une seule.
    const first = movement('meme', { queueEntryId: 'q-1' });
    const second = movement('meme', { queueEntryId: 'q-2' });

    const { queue, removed } = rebuild(
      [first, second],
      [entry(0, 'applied', first), entry(1, 'deferred', second)],
    );

    expect(queue.map(o => o.queueEntryId)).toEqual(['q-2']);
    expect(removed).toBe(1);
  });

  it('replaces the entry with its enriched version, in place', () => {
    // Reprendre le snapshot ferait re-televerser des photos deja envoyees.
    const before = movement('a', { data: { photos: ['file://locale.jpg'] } });
    const after = { ...before, data: { photos: ['https://distante.jpg'] } };
    const other = movement('b');

    const { queue } = rebuild([before, other], [entry(0, 'deferred', after), entry(1, 'applied', other)]);

    expect(queue).toHaveLength(1);
    expect(queue[0].data.photos).toEqual(['https://distante.jpg']);
  });

  it('follows a rebase that changed its business id but not its token', () => {
    const before = movement('op-1', { queueEntryId: 'q-fixe' });
    const rebased = { ...before, id: 'op-2', baseVersion: 9 };

    const { queue } = rebuild([before], [entry(0, 'deferred', rebased)]);

    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('op-2');
    expect(queue[0].queueEntryId).toBe('q-fixe');
  });

  it('keeps an untouched entry from the SNAPSHOT, not from the journal', () => {
    // Le journal ne promet AUCUNE version d'origine : l'ordonnanceur transmet
    // l'operation a `execute`, qui peut la muter en place.
    //
    // `runSyncPass` ne produit pas aujourd'hui une ligne `untouched` dont le
    // `resolved` diverge — une entree jamais tentee n'a rien pu enrichir. Mais
    // `reconstructSyncQueue` est une fonction publique : son contrat doit tenir
    // pour toute entree, et c'est la seule facon de prouver de quelle source
    // elle lit.
    const a = movement('a');
    const b = movement('b');
    const corrompue = { ...b, data: { mute: true } };

    const { queue } = rebuild([a, b], [entry(0, 'applied', a), entry(1, 'untouched', corrompue)]);

    expect(queue).toEqual([b]);
    expect(queue[0]).toBe(b);
    expect(queue[0].data).toBeUndefined();
  });

  it.each([
    ['terminal', 'terminal' as PassEntryKind],
    ['conflict', 'conflict' as PassEntryKind],
    ['abandon', 'abandon' as PassEntryKind],
  ])('keeps a %s entry at its position', (_label, kind) => {
    const a = movement('a');
    const b = movement('b');
    const c = movement('c');

    const { queue } = rebuild(
      [a, b, c],
      [entry(0, 'applied', a), entry(1, kind, b), entry(2, 'untouched', c)],
    );

    expect(queue.map(o => o.id)).toEqual(['b', 'c']);
  });

  it('takes the deadline from the JOURNAL, not from the operation', () => {
    // Le test precedent placait la meme echeance aux deux endroits : il restait
    // vert meme si le reconstructeur ignorait totalement le journal — ce qu'il
    // faisait. L'echeance calculee par la politique aurait ete perdue.
    const a = movement('a');
    const sansEcheance = { ...a };

    const { queue } = rebuild([a], [entry(0, 'deferred', sansEcheance, '2026-08-23T12:30:00.000Z')]);

    expect(queue[0].nextAttemptAt).toBe('2026-08-23T12:30:00.000Z');
  });

  it('erases a deadline the journal says is gone', () => {
    const a = movement('a', { nextAttemptAt: '2026-08-23T11:00:00.000Z' });

    const { queue } = rebuild([a], [entry(0, 'deferred', a, null)]);

    expect(queue[0].nextAttemptAt).toBeUndefined();
  });

  it.each([
    ['terminal', 'terminal' as PassEntryKind],
    ['conflict', 'conflict' as PassEntryKind],
  ])('strips the retry state from a %s outcome', (_label, kind) => {
    // « Refusee » et « prochaine tentative dans 30 s » sur la meme ligne : le
    // diagnostic devenait contradictoire.
    const a = movement('a', {
      nextAttemptAt: '2026-08-23T11:00:00.000Z',
      retrySource: 'client_backoff',
    });

    const { queue } = rebuild([a], [entry(0, kind, a, '2026-08-23T12:00:00.000Z')]);

    expect(queue[0].nextAttemptAt).toBeUndefined();
    expect(queue[0].retrySource).toBeUndefined();
  });
});

describe('entries the scheduler never saw stay where they were', () => {
  it('keeps a pre-existing terminal at its position', () => {
    // Elle n'entre jamais dans l'ordonnanceur : aucune ligne de journal. Sans
    // ce parcours du snapshot COMPLET, elle disparaitrait.
    const refused = movement('refusee', { terminal: true, terminalStatus: 'forbidden' });
    const pending = movement('a');

    const { queue } = rebuild([refused, pending], [entry(1, 'deferred', pending)]);

    expect(queue.map(o => o.id)).toEqual(['refusee', 'a']);
  });

  it('keeps a quarantined entry at its position, never executed', () => {
    const blocked = movement('bloquee', { quarantined: true, quarantineReason: 'duplicate_id_mismatch' });
    const pending = movement('a');

    const { queue } = rebuild([blocked, pending], [entry(1, 'applied', pending)]);

    expect(queue).toHaveLength(1);
    expect(queue[0].quarantined).toBe(true);
  });

  it('indexes by originalIndex, tolerating the gaps those entries leave', () => {
    // Les tokens ont des TROUS : indexer par la position de la ligne dans
    // `entries` decalerait chaque issue d'un cran.
    const refused = movement('refusee', { terminal: true });
    const blocked = movement('bloquee', { quarantined: true });
    const pending = movement('a');

    const { queue } = rebuild([refused, blocked, pending], [entry(2, 'applied', pending)]);

    expect(queue.map(o => o.id)).toEqual(['refusee', 'bloquee']);
  });
});

describe('what appeared during the pass is kept, in event order', () => {
  const addition = (sequence: number, source: QueueAddition<Op>['source'], operation: Op) => (
    { sequence, source, operation }
  );

  it('keeps a concurrent enqueue', () => {
    const a = movement('a');
    const fresh = movement('enfilee-pendant');

    const { queue } = rebuild(
      [a],
      [entry(0, 'applied', a)],
      [addition(0, 'concurrent_enqueue', fresh)],
    );

    expect(queue.map(o => o.id)).toEqual(['enfilee-pendant']);
  });

  it('keeps a spawned photo patch exactly once', () => {
    const reserve = movement('reserve');
    const patch = movement('patch-photo');

    const { queue } = rebuild(
      [reserve],
      [entry(0, 'applied', reserve)],
      [addition(0, 'spawned', patch)],
    );

    expect(queue.filter(o => o.id === 'patch-photo')).toHaveLength(1);
  });

  it('interleaves spawned and enqueued by sequence, not by category', () => {
    // « Tous les engendres puis tous les enfiles » ferait passer une saisie
    // faite AVANT le patch photo apres lui.
    const a = movement('a');

    const { queue } = rebuild(
      [a],
      [entry(0, 'applied', a)],
      [
        addition(2, 'concurrent_enqueue', movement('T3')),
        addition(0, 'concurrent_enqueue', movement('T1')),
        addition(1, 'spawned', movement('T2')),
      ],
    );

    expect(queue.map(o => o.id)).toEqual(['T1', 'T2', 'T3']);
  });

  it('places additions after everything the snapshot kept', () => {
    const a = movement('a');

    const { queue } = rebuild(
      [a],
      [entry(0, 'deferred', a)],
      [addition(0, 'concurrent_enqueue', movement('apres'))],
    );

    expect(queue.map(o => o.id)).toEqual(['a', 'apres']);
  });
});

describe('duplicates are re-examined after the additions', () => {
  it('merges an addition that repeats an identical kept entry', () => {
    const kept = movement('op-1', { queueEntryId: 'q-1' });
    const same = movement('op-1', { queueEntryId: 'q-2' });

    const { queue, deduplicated } = rebuild(
      [kept],
      [entry(0, 'deferred', kept)],
      [{ sequence: 0, source: 'concurrent_enqueue', operation: same }],
    );

    expect(queue).toHaveLength(1);
    expect(deduplicated).toBe(1);
  });

  it('quarantines an addition that contradicts a kept entry', () => {
    const kept = movement('op-1', { queueEntryId: 'q-1' });
    const divergent = movement('op-1', {
      queueEntryId: 'q-2',
      rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'P1', quantity: 99 } } },
    });

    const { queue, quarantined } = rebuild(
      [kept],
      [entry(0, 'deferred', kept)],
      [{ sequence: 0, source: 'concurrent_enqueue', operation: divergent }],
    );

    expect(queue).toHaveLength(2);
    expect(queue.every(o => o.quarantined === true)).toBe(true);
    expect(quarantined).toBe(2);
  });

  it('never deduplicates what it cannot compare', () => {
    const circular: Op = movement('op-1', { queueEntryId: 'q-1' });
    circular.data = circular;
    const other: Op = movement('op-1', { queueEntryId: 'q-2' });
    other.data = other;

    const { queue, quarantined } = rebuild(
      [circular, other],
      [entry(0, 'deferred', circular), entry(1, 'deferred', other)],
    );

    expect(queue).toHaveLength(2);
    expect(quarantined).toBe(2);
  });
});

describe('a broken contract stops the rebuild instead of guessing', () => {
  it.each([
    ['un index hors du snapshot', 5],
    ['un index negatif', -1],
  ])('refuses %s', (_label, index) => {
    const a = movement('a');

    expect(() => rebuild([a], [entry(index, 'applied', a)])).toThrow(/Reconstruction impossible/);
  });

  it('refuses two outcomes for the same entry', () => {
    const a = movement('a');

    expect(() => rebuild([a], [entry(0, 'applied', a), entry(0, 'deferred', a)]))
      .toThrow(/jeton 0 duplique/);
  });

  it('refuses a token that contradicts its own index', () => {
    // Les exposer separement sans verifier leur accord laissait passer une
    // ligne contradictoire, et l'issue s'appliquait a la mauvaise entree.
    const a = movement('a');
    const b = movement('b');

    expect(() => rebuild([a, b], [
      { token: 9, originalIndex: 0, kind: 'applied', resolved: a, nextAttemptAt: null },
      entry(1, 'untouched', b),
    ])).toThrow(/incoherent avec l'index/);
  });

  it('refuses a missing outcome for a replayable entry', () => {
    // Une omission de l'ordonnanceur passait pour une entree deja terminale :
    // l'operation etait conservee et rejouee indefiniment, sans signal.
    const a = movement('a');
    const b = movement('b');

    expect(() => rebuild([a, b], [entry(0, 'applied', a)]))
      .toThrow(/issue absente pour l'index 1/);
  });

  it('refuses an outcome for an entry the scheduler must not have seen', () => {
    const refused = movement('refusee', { terminal: true });

    expect(() => rebuild([refused], [entry(0, 'applied', refused)]))
      .toThrow(/entree non rejouable/);
  });

  it('refuses an unknown outcome kind instead of treating it as untouched', () => {
    const a = movement('a');

    expect(() => rebuild([a], [entry(0, 'inconnue' as PassEntryKind, a)]))
      .toThrow(/issue de journal inconnue/);
  });

  it('refuses a resolved version whose local identity drifted', () => {
    // Le rebase change `id`, `baseVersion` et le payload — jamais l'identite
    // locale. La laisser deriver ferait disparaitre l'ancrage physique.
    const a = movement('a', { queueEntryId: 'q-stable' });
    const derive = { ...a, queueEntryId: 'q-autre' };

    expect(() => rebuild([a], [entry(0, 'deferred', derive)]))
      .toThrow(/queueEntryId modifie/);
  });

  it.each([
    ['NaN', Number.NaN],
    ['negative', -1],
    ['fractionnaire', 1.5],
  ])('refuses an addition sequence that is %s', (_label, sequence) => {
    const a = movement('a');

    expect(() => rebuild(
      [a],
      [entry(0, 'applied', a)],
      [{ sequence, source: 'spawned', operation: movement('x') }],
    )).toThrow(/sequence d'addition invalide/);
  });

  it('refuses two additions claiming the same sequence', () => {
    // Le contrat annonce un ordre TOTAL : deux sequences egales feraient
    // dependre le resultat de l'ordre du tableau.
    const a = movement('a');

    expect(() => rebuild(
      [a],
      [entry(0, 'applied', a)],
      [
        { sequence: 3, source: 'spawned', operation: movement('x') },
        { sequence: 3, source: 'concurrent_enqueue', operation: movement('y') },
      ],
    )).toThrow(/sequence d'addition dupliquee/);
  });

  it('repairs a local identity collision an addition brought in', () => {
    // Une collision LOCALE se repare : contrairement a un `id` metier duplique,
    // elle n'a aucun effet sur l'idempotence serveur.
    const kept = movement('a', { queueEntryId: 'q-partage' });
    const addition = movement('b', { queueEntryId: 'q-partage' });

    const { queue, repairedIdentities } = rebuild(
      [kept],
      [entry(0, 'deferred', kept)],
      [{ sequence: 0, source: 'concurrent_enqueue', operation: addition }],
    );

    expect(new Set(queue.map(o => o.queueEntryId)).size).toBe(2);
    expect(queue[0].queueEntryId).toBe('q-partage');
    expect(repairedIdentities).toBe(1);
  });
});

describe('the whole pass converges', () => {
  it('empties the queue after thirty movements on one product', async () => {
    // LA garantie d'origine, verifiee sur la chaine complete : trente
    // mouvements executes, trente jetons retires, file finale vide.
    const { runSyncPass } = await import('../lib/syncPassScheduler');
    const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
    const snapshot = Array.from({ length: 30 }, (_, index) => ({
      ...movement(`m${index}`, { queueEntryId: `q-${index}` }),
      queuedAt: new Date(NOW - (30 - index) * 60_000).toISOString(),
    }));

    const result = await runSyncPass({
      operations: snapshot,
      now: () => NOW,
      onExecuteError: (_operation, error) => { throw error; },
      execute: async () => ({ kind: 'applied' }),
    });

    const rebuilt = reconstructSyncQueue({
      snapshot,
      entries: result.entries,
      isReplayable,
      markQuarantined: quarantine,
      newQueueEntryId,
    });

    expect(result.processed).toBe(30);
    expect(rebuilt.removed).toBe(30);
    expect(rebuilt.queue).toEqual([]);
  });

  it('keeps the untried ones when a preemption stops the pass', async () => {
    const { runSyncPass } = await import('../lib/syncPassScheduler');
    const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);
    const snapshot = Array.from({ length: 5 }, (_, index) => ({
      ...movement(`m${index}`, { queueEntryId: `q-${index}` }),
      queuedAt: new Date(NOW - (5 - index) * 60_000).toISOString(),
      rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: `P${index}` } } },
    }));

    let executed = 0;
    const result = await runSyncPass({
      operations: snapshot,
      now: () => NOW,
      onExecuteError: (_operation, error) => { throw error; },
      isCurrentGeneration: () => executed < 3,
      execute: async () => { executed += 1; return { kind: 'applied' }; },
    });

    const rebuilt = reconstructSyncQueue({
      snapshot,
      entries: result.entries,
      isReplayable,
      markQuarantined: quarantine,
      newQueueEntryId,
    });

    // Les succes restent retires, les non tentees subsistent a leur place.
    expect(rebuilt.removed).toBe(3);
    expect(rebuilt.queue.map(o => o.id)).toEqual(['m3', 'm4']);
  });
});
