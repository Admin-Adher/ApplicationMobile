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

  it.each([
    ['une Date', { data: { at: new Date('2026-01-01') } }],
    ['une Map', { data: { m: new Map([['a', 1]]) } }],
    ['un Set', { data: { s: new Set([1]) } }],
    ['une RegExp', { data: { r: /x/ } }],
    ['NaN', { data: { n: Number.NaN } }],
    ['Infini', { data: { n: Number.POSITIVE_INFINITY } }],
  ])('refuses to compare %s', (_label, operation) => {
    // `Object.entries(new Date(...))` rend `{}` : deux dates DIFFERENTES
    // produiraient la meme empreinte et seraient fusionnees — saisie perdue.
    // `NaN` et `Infinity` deviennent `null` en JSON, indiscernables d'un vrai
    // `null`.
    expect(queueOperationFingerprint(operation as any)).toBeNull();
  });

  it('accepts everything a JSON round-trip preserves', () => {
    // Verrou sur la premisse : tout refuser ferait passer le test ci-dessus
    // sans rien prouver.
    expect(queueOperationFingerprint({
      table: 't',
      op: 'update',
      data: { texte: 'x', nombre: 4.5, vrai: true, vide: null, liste: [1, 'a', { k: 2 }] },
      baseVersion: 3,
    })).not.toBeNull();
  });

  it('never lets a hole in an array pass for an absent element', () => {
    // `map` ne visite pas les cases absentes : `new Array(1)` et `[]`
    // produisaient tous deux `[]`, donc deux payloads DIFFERENTS partageaient
    // une empreinte et pouvaient etre fusionnes.
    const empty = queueOperationFingerprint({ data: { liste: [] } });
    const sparse = queueOperationFingerprint({ data: { liste: new Array(1) } });

    expect(empty).not.toBeNull();
    expect(sparse).toBeNull();
  });

  it('gives up quickly on a huge sparse array', () => {
    // Les cases absentes ne consomment aucun noeud : sans borne sur la
    // longueur, ce payload contournait entierement le budget.
    const started = Date.now();

    expect(queueOperationFingerprint({ data: { liste: new Array(5_000_000) } } as any)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('gives up on a single oversized string without building it whole', () => {
    // Le controle de longueur intervenait APRES construction : une seule chaine
    // metier de plusieurs dizaines de megaoctets bloquait le fil avant d'etre
    // rejetee.
    expect(queueOperationFingerprint({ data: { texte: 'x'.repeat(300_000) } })).toBeNull();
  });

  it('gives up on a payload too large to compare within budget', () => {
    // Une file corrompue ne doit pas bloquer le fil pendant l'hydratation.
    const huge = { data: { liste: Array.from({ length: 50_000 }, (_, i) => i) } };

    expect(queueOperationFingerprint(huge as any)).toBeNull();
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

  it('deduplicates two physical entries sharing ONE object reference', () => {
    // Raisonner par reference annulait la protection physique : les deux
    // positions portaient la meme cle, donc rien n'etait ni remplace ni retire
    // et le module annoncait `removed: 1` en rendant deux entrees.
    const operation = movement('op-1');
    const { operations, resolutions } = resolve([operation, operation]);

    expect(operations).toHaveLength(1);
    expect(resolutions).toEqual([{ kind: 'deduplicated', id: 'op-1', removed: 1 }]);
  });

  it('merges the state instead of picking one copy whole', () => {
    // L'une detient le `queuedAt` le plus ancien, l'autre l'echec le plus
    // recent : n'en garder qu'une perd la moitie de l'etat.
    const early = movement('op-1', {
      queuedAt: '2026-08-23T10:00:00.000Z',
      attemptCount: 1,
      nextAttemptAt: '2026-08-23T12:00:00.000Z',
    });
    const late = movement('op-1', {
      queuedAt: '2026-08-23T11:00:00.000Z',
      attemptCount: 4,
      lastAttemptAt: '2026-08-23T11:30:00.000Z',
      lastFailureAt: '2026-08-23T11:30:00.000Z',
      lastError: 'HTTP 503',
      failureClass: 'server_unavailable',
      lastHttpStatus: 503,
      sameFailureCount: 2,
      nextAttemptAt: '2026-08-23T12:30:00.000Z',
    });

    const merged = resolve([early, late]).operations[0];

    expect(merged.queuedAt).toBe('2026-08-23T10:00:00.000Z');
    expect(merged.attemptCount).toBe(4);
    expect(merged.lastAttemptAt).toBe('2026-08-23T11:30:00.000Z');
    // La plus TARDIVE : raccourcir une echeance renverrait trop tot.
    expect(merged.nextAttemptAt).toBe('2026-08-23T12:30:00.000Z');
    // Bloc d'erreur coherent, pris d'un seul tenant.
    expect(merged.lastError).toBe('HTTP 503');
    expect(merged.failureClass).toBe('server_unavailable');
    expect(merged.lastHttpStatus).toBe(503);
    expect(merged.sameFailureCount).toBe(2);
  });

  it('never mixes a message with another failure class', () => {
    const older = movement('op-1', {
      lastFailureAt: '2026-08-23T10:00:00.000Z',
      lastError: 'timeout',
      failureClass: 'timeout',
      lastHttpStatus: undefined,
    });
    const newer = movement('op-1', {
      lastFailureAt: '2026-08-23T11:00:00.000Z',
      lastError: 'HTTP 403',
      failureClass: 'permanent_candidate',
      lastHttpStatus: 403,
    });

    const merged = resolve([older, newer]).operations[0];

    expect(merged.lastError).toBe('HTTP 403');
    expect(merged.failureClass).toBe('permanent_candidate');
    expect(merged.lastHttpStatus).toBe(403);
  });

  it('propagates terminality and strips the deadline it invalidates', () => {
    const pending = movement('op-1', { nextAttemptAt: '2026-08-23T12:30:00.000Z', retrySource: 'client_backoff' });
    const refused = movement('op-1', { terminal: true, terminalStatus: 'insufficient_stock' });

    const merged = resolve([pending, refused]).operations[0];

    expect(merged.terminal).toBe(true);
    expect(merged.terminalStatus).toBe('insufficient_stock');
    // Une operation refusee n'a aucune prochaine tentative.
    expect(merged.nextAttemptAt).toBeUndefined();
    expect(merged.retrySource).toBeUndefined();
  });

  it('ignores unparseable timestamps rather than propagating them', () => {
    const broken = movement('op-1', { queuedAt: 'pas une date', attemptCount: -3 });
    const sound = movement('op-1', { queuedAt: '2026-08-23T10:00:00.000Z', attemptCount: 2 });

    const merged = resolve([broken, sound]).operations[0];

    expect(merged.queuedAt).toBe('2026-08-23T10:00:00.000Z');
    expect(merged.attemptCount).toBe(2);
  });

  it('keeps the survivor at the position of the first occurrence', () => {
    // Deplacer l'entree la ferait passer derriere une autre ecriture sur le
    // meme produit, et le solde final serait faux.
    const { operations } = resolve([movement('a'), movement('b'), movement('a')]);

    expect(operations.map(o => o.id)).toEqual(['a', 'b']);
  });
});

describe('an authoritative state is never assembled from two verdicts', () => {
  it('quarantines copies carrying different terminal statuses', () => {
    // Le statut venait d'une copie et le resultat metier d'une autre : deux
    // recherches independantes produisaient une operation refusee pour un motif
    // qui n'est pas le sien — et `terminalOutcome` pilote le rollback de stock.
    const { operations, resolutions } = resolve([
      movement('op-1', { terminal: true, terminalStatus: 'forbidden' }),
      movement('op-1', { terminal: true, terminalStatus: 'insufficient_stock' }),
    ]);

    expect(resolutions).toEqual([{ kind: 'quarantined', id: 'op-1', entries: 2 }]);
    expect(operations).toHaveLength(2);
  });

  it('quarantines copies carrying different terminal outcomes', () => {
    const { resolutions } = resolve([
      movement('op-1', { terminalOutcome: { domain: 'inventory', status: 'forbidden' } }),
      movement('op-1', { terminalOutcome: { domain: 'inventory', status: 'not_found' } }),
    ]);

    expect(resolutions[0].kind).toBe('quarantined');
  });

  it('merges when only one copy carries the verdict', () => {
    // Verrou sur la premisse : tout mettre en quarantaine ferait passer les
    // deux tests ci-dessus sans rien prouver.
    const { operations, resolutions } = resolve([
      movement('op-1'),
      movement('op-1', { terminal: true, terminalStatus: 'forbidden' }),
    ]);

    expect(resolutions[0].kind).toBe('deduplicated');
    expect(operations[0].terminalStatus).toBe('forbidden');
  });

  it('treats a status or an outcome as terminality, even without the flag', () => {
    const merged = resolve([
      movement('op-1'),
      movement('op-1', { terminalStatus: 'forbidden' }),
    ]).operations[0];

    expect(merged.terminal).toBe(true);
  });

  it('never leaves a quarantine without a reason', () => {
    // Une operation bloquee sans motif ne peut etre ni expliquee ni arbitree.
    const merged = resolve([
      movement('op-1'),
      movement('op-1', { quarantined: true, quarantineReason: 'duplicate_id_mismatch' }),
    ]).operations[0];

    expect(merged.quarantined).toBe(true);
    expect(merged.quarantineReason).toBe('duplicate_id_mismatch');
  });

  it('erases a corrupted value no copy can replace', () => {
    // La base vient de la premiere copie : une valeur invalide y survivait des
    // lors qu'aucune autre n'en fournissait une valide.
    const merged = resolve([
      movement('op-1', { attemptCount: 'quatre', queuedAt: 'pas une date', nextAttemptAt: 'jamais' }),
      movement('op-1', { attemptCount: 'cinq', queuedAt: 'non plus' }),
    ]).operations[0];

    expect(merged.attemptCount).toBeUndefined();
    expect(merged.queuedAt).toBeUndefined();
    expect(merged.nextAttemptAt).toBeUndefined();
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
