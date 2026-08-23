import { describe, expect, it } from 'vitest';
import {
  queueOperationFingerprint,
  resolveDuplicateQueueIds,
} from '../lib/syncQueueIdentity';

type Op = Record<string, any>;

const movement = (id: string, over: Op = {}): Op => ({
  id,
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

const resolve = (operations: Op[]) => resolveDuplicateQueueIds(operations, quarantine);

describe('the business fingerprint ignores retry history', () => {
  it('treats two differently-retried copies as the same write', () => {
    // Sinon la quarantaine se declencherait sur des doublons parfaitement
    // benins : meme saisie, simplement reessayee un nombre de fois different.
    const fresh = movement('op-1');
    const tried = movement('op-1', {
      attemptCount: 4,
      lastError: 'HTTP 503',
      lastFailureAt: '2026-08-23T12:00:00.000Z',
      lastFailureFingerprint: '|503|http <n>',
      failureClass: 'server_unavailable',
      retrySource: 'client_backoff',
      nextAttemptAt: '2026-08-23T12:05:00.000Z',
      queuedAt: '2026-08-23T11:00:00.000Z',
    });

    expect(queueOperationFingerprint(fresh)).toBe(queueOperationFingerprint(tried));
  });

  it('separates two writes that differ by a single business value', () => {
    const five = movement('op-1');
    const six = movement('op-1', {
      rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'P1', quantity: 6 } } },
    });

    expect(queueOperationFingerprint(five)).not.toBe(queueOperationFingerprint(six));
  });

  it('does not depend on key order', () => {
    const a = { table: 't', op: 'update', data: { alpha: 1, beta: 2 }, filter: { column: 'id', value: 'x' } };
    const b = { filter: { value: 'x', column: 'id' }, data: { beta: 2, alpha: 1 }, op: 'update', table: 't' };

    expect(queueOperationFingerprint(a)).toBe(queueOperationFingerprint(b));
  });

  it.each([
    ['baseVersion', { baseVersion: 3 }, { baseVersion: 4 }],
    ['filtre', { filter: { column: 'id', value: 'a' } }, { filter: { column: 'id', value: 'b' } }],
    ['patch de photo', { photoPatch: { action: 'delete' } }, { photoPatch: { action: 'upsert' } }],
    ['clef de fusion', { coalesceKey: 'a' }, { coalesceKey: 'b' }],
  ])('separates writes differing by %s', (_label, left, right) => {
    expect(queueOperationFingerprint(left)).not.toBe(queueOperationFingerprint(right));
  });

  it('reports an unreadable payload rather than truncating it', () => {
    // Tronquer rendrait deux payloads DIFFERENTS identiques, donc fusionnables.
    // On rend `null` : l'egalite n'est pas prouvable.
    const circular: Op = { table: 't' };
    circular.data = circular;

    expect(() => queueOperationFingerprint(circular)).not.toThrow();
    expect(queueOperationFingerprint(circular)).toBeNull();
  });

  it('quarantines rather than merging when the content cannot be compared', () => {
    const circular: Op = { id: 'op-1', table: 't' };
    circular.data = circular;
    const other: Op = { id: 'op-1', table: 't' };
    other.data = other;

    const { operations, resolutions } = resolve([circular, other]);

    expect(resolutions).toEqual([{ kind: 'quarantined', id: 'op-1', entries: 2 }]);
    expect(operations).toHaveLength(2);
  });
});

describe('identical content behind one identifier is deduplicated', () => {
  it('keeps a single entry and reports how many it removed', () => {
    const { operations, resolutions } = resolve([movement('op-1'), movement('op-1'), movement('op-2')]);

    expect(operations.map(o => o.id)).toEqual(['op-1', 'op-2']);
    expect(resolutions).toEqual([{ kind: 'deduplicated', id: 'op-1', removed: 1 }]);
    expect(operations.some(o => o.quarantined)).toBe(false);
  });

  it('keeps the copy carrying the richer history', () => {
    // Jeter celle qui porte l'historique ferait perdre la trace de ce qui a
    // deja ete tente, et le compteur repartirait de zero.
    const bare = movement('op-1');
    const tried = movement('op-1', { attemptCount: 3, lastError: 'HTTP 503', failureClass: 'server_unavailable' });

    expect(resolve([bare, tried]).operations[0].attemptCount).toBe(3);
    // L'ordre d'arrivee ne change pas le choix.
    expect(resolve([tried, bare]).operations[0].attemptCount).toBe(3);
  });

  it('keeps the survivor at the position of the first occurrence', () => {
    // Deplacer l'entree la ferait passer derriere une autre ecriture sur le
    // meme produit, et le solde final serait faux.
    const { operations } = resolve([movement('a'), movement('b'), movement('a')]);

    expect(operations.map(o => o.id)).toEqual(['a', 'b']);
  });
});

describe('divergent content behind one identifier is quarantined', () => {
  const divergent = () => [
    movement('op-1'),
    movement('op-1', {
      rpc: { fn: 'record_inventory_movement', args: { p_movement: { product_id: 'P1', quantity: 99 } } },
    }),
  ];

  it('keeps every entry, executes none, deletes none', () => {
    // Deux ecritures reelles se disputent un identifiant idempotent. En
    // executer une choisirait arbitrairement laquelle perdre ; en supprimer une
    // detruirait une saisie.
    const { operations, resolutions } = resolve(divergent());

    expect(operations).toHaveLength(2);
    expect(operations.every(o => o.quarantined === true)).toBe(true);
    expect(operations.every(o => o.quarantineReason === 'duplicate_id_mismatch')).toBe(true);
    expect(resolutions).toEqual([{ kind: 'quarantined', id: 'op-1', entries: 2 }]);
  });

  it('leaves unrelated operations untouched and in place', () => {
    const { operations } = resolve([movement('keep-1'), ...divergent(), movement('keep-2')]);

    expect(operations.map(o => o.id)).toEqual(['keep-1', 'op-1', 'op-1', 'keep-2']);
    expect(operations.filter(o => o.quarantined)).toHaveLength(2);
    expect(operations[0].quarantined).toBeUndefined();
    expect(operations[3].quarantined).toBeUndefined();
  });

  it('handles both policies in the same queue', () => {
    const { resolutions } = resolve([
      movement('same'), movement('same'),
      ...divergent(),
    ]);

    expect(resolutions).toEqual([
      { kind: 'deduplicated', id: 'same', removed: 1 },
      { kind: 'quarantined', id: 'op-1', entries: 2 },
    ]);
  });
});

describe('a queue without duplicates is returned untouched', () => {
  it('changes nothing and reports nothing', () => {
    const input = [movement('a'), movement('b'), movement('c')];
    const { operations, resolutions } = resolve(input);

    expect(operations).toEqual(input);
    expect(resolutions).toEqual([]);
  });

  it('never merges entries that carry no identifier', () => {
    // Sans identifiant, rien ne permet d'affirmer qu'il s'agit du meme envoi.
    const { operations, resolutions } = resolve([movement(''), movement('')]);

    expect(operations).toHaveLength(2);
    expect(resolutions).toEqual([]);
  });
});
