import { afterEach, describe, expect, it, vi } from 'vitest';
import { genEntityId } from '../lib/utils';

describe('offline entity ids', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps entropy when two entities are created at the same millisecond', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_787_522_300_000);
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.123456)
      .mockReturnValueOnce(0.654321);

    const first = genEntityId('VIS');
    const second = genEntityId('VIS');

    expect(first).toMatch(/^VIS-1787522300000[a-z0-9]{1,6}$/i);
    expect(second).toMatch(/^VIS-1787522300000[a-z0-9]{1,6}$/i);
    expect(first).not.toBe(second);
  });

  it('normalizes prefixes without creating a double separator', () => {
    expect(genEntityId('lot-custom-')).toMatch(/^LOT-CUSTOM-\d+[a-z0-9]+$/i);
  });
});
