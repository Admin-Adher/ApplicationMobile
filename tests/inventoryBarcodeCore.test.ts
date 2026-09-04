import { describe, expect, it, vi } from 'vitest';
import {
  canonicalizeGtin,
  cleanWebProductTitle,
  extractVariantDetails,
  extractGtin,
  isValidGtin,
  lookupOpenFactsCatalogs,
  lookupUpcItemDb,
  normalizeBarcodeLookupCode,
  parseOpenFactsProduct,
  parseUpcItemDbResponse,
  selectWebSearchMatch,
  settleWithFallback,
} from '../lib/inventoryBarcodeCore';

describe('external lookup deadline', () => {
  it('returns the result when the provider settles before the deadline', async () => {
    await expect(settleWithFallback(Promise.resolve('found'), 100, 'fallback')).resolves.toBe('found');
  });

  it('returns the fallback on timeout or rejection', async () => {
    vi.useFakeTimers();
    try {
      const pending = settleWithFallback(new Promise<string>(() => undefined), 500, 'timeout');
      await vi.advanceTimersByTimeAsync(500);
      await expect(pending).resolves.toBe('timeout');
      await expect(settleWithFallback(Promise.reject(new Error('network')), 500, 'error')).resolves.toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('barcode normalization', () => {
  it('keeps a scanned EAN and validates its check digit', () => {
    expect(extractGtin('3017620422003')).toBe('3017620422003');
    expect(isValidGtin('3017620422003')).toBe(true);
    expect(isValidGtin('3017620422004')).toBe(false);
    expect(canonicalizeGtin('012345678905')).toBe('00012345678905');
    expect(canonicalizeGtin('0012345678905')).toBe('00012345678905');
  });

  it('extracts GTINs from GS1 Digital Link and application identifier payloads', () => {
    expect(extractGtin('https://id.gs1.org/01/09506000134352/10/ABC')).toBe('09506000134352');
    expect(extractGtin('(01)09506000134352(10)ABC')).toBe('09506000134352');
    expect(normalizeBarcodeLookupCode('https://id.gs1.org/01/09506000134352')).toBe('09506000134352');
  });

  it('preserves an internal Code 128 reference for local and web lookup', () => {
    expect(normalizeBarcodeLookupCode(' ABC-12580 ')).toBe('ABC-12580');
    expect(extractGtin('ABC-12580')).toBeUndefined();
  });
});

describe('UPCitemdb fallback', () => {
  it('accepts only the item whose GTIN exactly matches and keeps it for verification', () => {
    const match = parseUpcItemDbResponse({
      items: [
        { ean: '3250614435226', title: 'Near but incorrect item' },
        {
          ean: '3250614435225',
          title: 'Hager MM509N motor starter 4.0-6.3A',
          brand: 'Hager',
          model: 'MM509N',
          images: ['https://images.example/hager-mm509n.jpg'],
        },
      ],
    }, '3250614435225');

    expect(match).toMatchObject({
      barcode: '3250614435225',
      designation: 'Hager MM509N motor starter 4.0-6.3A',
      brand: 'Hager',
      photoUrl: 'https://images.example/hager-mm509n.jpg',
      source: 'upcitemdb',
      confidence: 'medium',
      variantComplete: false,
    });
  });

  it('rejects a response containing only a neighbouring GTIN', () => {
    expect(parseUpcItemDbResponse({
      items: [{ ean: '3250614435226', title: 'Hager MM509N' }],
    }, '3250614435225')).toBeNull();
  });

  it('uses a clean separator and prefers an Android-compatible HTTPS photo', () => {
    const match = parseUpcItemDbResponse({
      items: [{
        ean: '4003773033837',
        title: 'Knipex 10" Pliers Wrenches 8603250',
        model: '4000810690',
        dimension: '10.8 X 2.5 X 0.8 inches',
        images: [
          'http://images.example/legacy.gif',
          'https://images.example/knipex.jpg',
        ],
      }],
    }, '4003773033837');

    expect(match).toMatchObject({
      designation: 'Knipex 10" Pliers Wrenches 8603250 — 4000810690 — 10.8 X 2.5 X 0.8 inches',
      photoUrl: 'https://images.example/knipex.jpg',
    });
  });

  it('queries the no-key endpoint for a valid GTIN', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      expect(String(input)).toContain('upc=3250614435225');
      return Response.json({
        items: [{ ean: '3250614435225', title: 'Hager MM509N', brand: 'Hager' }],
      });
    });

    const match = await lookupUpcItemDb('3250614435225', {
      fetchImpl: fetchMock,
      timeoutMs: 500,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(match).toMatchObject({ source: 'upcitemdb', brand: 'Hager' });
  });
});

describe('open catalogue lookup', () => {
  it('maps localized product data to the inventory description', () => {
    const match = parseOpenFactsProduct({
      status: 1,
      product: {
        product_name_fr: 'Pâte à tartiner noisettes',
        product_name: 'Hazelnut spread',
        quantity: '400 g',
        brands: 'Ferrero, Nutella',
        image_front_url: 'https://images.example/product.jpg',
      },
    }, '3017620422003', 'open-food-facts', 'fr');

    expect(match).toMatchObject({
      barcode: '3017620422003',
      designation: 'Pâte à tartiner noisettes — 400 g',
      brand: 'Ferrero',
      source: 'open-food-facts',
      confidence: 'high',
      variantComplete: true,
    });
  });

  it('flags a generic name without pack, size or model for manual verification', () => {
    const match = parseOpenFactsProduct({
      status: 1,
      product: { product_name: 'Nutella', brands: 'Nutella', quantity: '' },
    }, '3017620422003', 'open-food-facts', 'fr');

    expect(match).toMatchObject({ designation: 'Nutella', variantComplete: false });
  });

  it('falls back from Open Products Facts to Open Food Facts', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('openproductsfacts')) return new Response(null, { status: 404 });
      return Response.json({
        status: 1,
        product: { product_name: 'Nutella', quantity: '400 g', brands: 'Ferrero' },
      });
    });

    const match = await lookupOpenFactsCatalogs('3017620422003', {
      fetchImpl: fetchMock,
      timeoutMs: 500,
      language: 'fr',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(match).toMatchObject({ designation: 'Nutella — 400 g', source: 'open-food-facts' });
  });

  it('does not query product catalogues for an invalid GTIN', async () => {
    const fetchMock = vi.fn(async () => new Response(null));
    const match = await lookupOpenFactsCatalogs('3017620422004', { fetchImpl: fetchMock });
    expect(match).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('web result safeguards', () => {
  it('extracts a construction product title only when the exact EAN is present', () => {
    const match = selectWebSearchMatch([{
      title: 'Disjoncteur Legrand DX3 1P D 13A | Legrand',
      description: 'Référence 407970 — EAN 3245064079709 — pouvoir de coupure 6000A.',
      url: 'https://www.legrand.example/products/407970',
    }], '3245064079709');

    expect(match).toMatchObject({
      barcode: '3245064079709',
      designation: 'Disjoncteur Legrand DX3 1P D 13A — Réf. 407970 — 6000A',
      source: 'web',
      confidence: 'high',
      variantComplete: true,
    });
  });

  it('adds an exact pack size found in the verified result snippet', () => {
    const match = selectWebSearchMatch([{
      title: 'Nutella | Ferrero',
      description: 'Pot de pâte à tartiner 400 g — EAN 3017620422003.',
      url: 'https://www.ferrero.example/nutella-400g',
    }], '3017620422003');

    expect(match).toMatchObject({
      designation: 'Nutella — 400 g',
      variantComplete: true,
    });
  });

  it('extracts BTP dimensions and nominal sizes without treating the GTIN as a dimension', () => {
    expect(extractVariantDetails(
      'Vanne DN25, raccord 20 mm, code EAN 3245064079709.',
      '3245064079709',
    )).toEqual(expect.arrayContaining(['DN25', '20 mm']));
  });

  it('rejects broad and generic barcode-database results', () => {
    expect(selectWebSearchMatch([{
      title: 'Disjoncteur Legrand DX3',
      description: 'Un disjoncteur modulaire pour tableaux électriques.',
      url: 'https://www.legrand.example/products/407970',
    }], '3245064079709')).toBeNull();

    expect(selectWebSearchMatch([{
      title: '3245064079709 - product lookup',
      description: 'Barcode result',
      url: 'https://gtinhub.com/product/3245064079709',
    }], '3245064079709')).toBeNull();
  });

  it('removes the barcode and catalogue noise from a web title', () => {
    expect(cleanWebProductTitle(
      'EAN 3245064079709 — Disjoncteur Legrand DX3 | Legrand',
      '3245064079709',
    )).toBe('Disjoncteur Legrand DX3');
  });
});
