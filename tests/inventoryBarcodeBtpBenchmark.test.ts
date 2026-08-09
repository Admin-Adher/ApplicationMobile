import { describe, expect, it } from 'vitest';
import { isValidGtin, selectWebSearchMatch } from '../lib/inventoryBarcodeCore';
import { inventoryBtpBenchmark } from './fixtures/inventoryBtpBenchmark';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

describe('BTP barcode benchmark', () => {
  for (const sample of inventoryBtpBenchmark) {
    it(`${sample.brand}: ${sample.gtin} is resolved to the exact variant`, () => {
      expect(isValidGtin(sample.gtin)).toBe(true);
      const match = selectWebSearchMatch(sample.results, sample.gtin);
      expect(match, `No exact match for ${sample.brand}`).not.toBeNull();
      expect(match?.variantComplete).toBe(true);
      expect(normalize(match?.brand ?? ''), `Brand missing for ${sample.brand}`).toBe(normalize(sample.brand));
      const designation = normalize(match?.designation ?? '');
      for (const token of sample.expectedTokens) {
        expect(designation, `${sample.brand} is missing ${token}: ${match?.designation}`)
          .toContain(normalize(token));
      }
    });
  }

  it('does not turn a generic catalogue year or a near GTIN into a product', () => {
    expect(selectWebSearchMatch([{
      title: 'ACCESSORIES 2026',
      description: 'A catalogue containing barcode 4059952650235 and thousands of products.',
      url: 'https://manufacturer.example/catalogue-2026.pdf',
    }], '4059952650234')).toBeNull();

    expect(selectWebSearchMatch([{
      title: 'ACCESSORIES 2026',
      description: 'Barcode 4059952650234.',
      url: 'https://manufacturer.example/catalogue-2026.pdf',
    }], '4059952650234')).toBeNull();
  });
});
