import { describe, expect, it } from 'vitest';
import { ensureQueueEntryIdentities } from '../lib/queueEntryIdentity';

/** Forme minimale d'une entree de file, `id` metier compris. */
interface Entry {
  id: string;
  queueEntryId?: string;
}

const entries = (...items: Entry[]): Entry[] => items;

const sequential = () => {
  let counter = 0;
  return () => `entry-${(counter += 1)}`;
};

describe('every entry carries a unique local identity', () => {
  it('assigns one to a queue persisted before the field existed', () => {
    // La migration doit precéder tout appel reseau : une operation preparee
    // pendant une passe doit pouvoir etre retrouvee exactement.
    const { operations, assigned, repaired } = ensureQueueEntryIdentities(
      entries({ id: 'a' }, { id: 'b' }),
      sequential(),
    );

    expect(operations.map(o => o.queueEntryId)).toEqual(['entry-1', 'entry-2']);
    expect({ assigned, repaired }).toEqual({ assigned: 2, repaired: 0 });
  });

  it('leaves an existing identity untouched', () => {
    const input = entries({ id: 'a', queueEntryId: 'deja-la' });
    const { operations, assigned, repaired } = ensureQueueEntryIdentities(input, sequential());

    expect(operations[0]).toBe(input[0]);
    expect({ assigned, repaired }).toEqual({ assigned: 0, repaired: 0 });
  });

  it('repairs a collision without ever touching the business id', () => {
    // Une collision d'identite LOCALE n'a aucun effet sur l'idempotence
    // serveur : on la repare, contrairement a un `id` metier duplique qui,
    // lui, merite la quarantaine.
    const { operations, repaired } = ensureQueueEntryIdentities(
      entries(
        { id: 'metier-1', queueEntryId: 'meme' },
        { id: 'metier-2', queueEntryId: 'meme' },
      ),
      sequential(),
    );

    expect(operations[0].queueEntryId).toBe('meme');
    expect(operations[1].queueEntryId).toBe('entry-1');
    expect(operations.map(o => o.id)).toEqual(['metier-1', 'metier-2']);
    expect(repaired).toBe(1);
  });

  it('keeps two entries distinct even when they share a business id', () => {
    const { operations } = ensureQueueEntryIdentities(
      entries({ id: 'meme' }, { id: 'meme' }),
      sequential(),
    );

    expect(new Set(operations.map(o => o.queueEntryId)).size).toBe(2);
  });

  it.each([
    ['une chaine vide', ''],
    ['undefined', undefined],
  ])('treats %s as absent', (_label, value) => {
    const { operations, assigned } = ensureQueueEntryIdentities(
      entries({ id: 'a', queueEntryId: value }),
      sequential(),
    );

    expect(operations[0].queueEntryId).toBe('entry-1');
    expect(assigned).toBe(1);
  });

  it('never hands out an identity the generator already produced', () => {
    // `newId` peut, en principe, rendre deux fois la meme valeur.
    let calls = 0;
    const collidingGenerator = () => {
      calls += 1;
      return calls <= 2 ? 'collision' : `unique-${calls}`;
    };

    const { operations } = ensureQueueEntryIdentities(
      entries({ id: 'a' }, { id: 'b' }),
      collidingGenerator,
    );

    expect(new Set(operations.map(o => o.queueEntryId)).size).toBe(2);
  });

  it('returns the same array content when nothing needs fixing', () => {
    // Verrou sur la premisse : tout regenerer ferait passer les tests ci-dessus
    // sans rien prouver, et casserait l'identite a chaque hydratation.
    const input = entries({ id: 'a', queueEntryId: 'x' }, { id: 'b', queueEntryId: 'y' });
    const { operations, assigned, repaired } = ensureQueueEntryIdentities(input, sequential());

    expect(operations).toEqual(input);
    expect({ assigned, repaired }).toEqual({ assigned: 0, repaired: 0 });
  });
});
