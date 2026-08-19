import { describe, expect, it } from 'vitest';
import { collectInventoryLabels, preferInventoryLabel } from '../lib/inventoryScanMemory';

describe('inventory scan memory', () => {
  it('ranks known suppliers and keeps typing a new one possible', () => {
    expect(collectInventoryLabels([
      'Legrand',
      'legrand',
      'Nicoll',
      '  ',
      'Legrand',
      'Rexel',
    ])).toEqual(['Legrand', 'Nicoll', 'Rexel']);
    expect(collectInventoryLabels(['Legrand', 'Nicoll', 'Rexel'], 're')).toEqual(['Rexel']);
    expect(preferInventoryLabel('', 'Legrand')).toBe('Legrand');
    expect(preferInventoryLabel('Nicoll', 'Legrand')).toBe('Nicoll');
  });
});
