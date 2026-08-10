import { describe, expect, it, vi } from 'vitest';
import {
  claimInventoryBarcodeLookup,
  completeInventoryBarcodeLookup,
  markInventoryBarcodeNotFound,
  releaseInventoryBarcodeLookup,
  type InventoryBarcodeCacheClient,
} from '../supabase/functions/_shared/inventoryBarcodeCache';

function cacheClient(responses: unknown[]): {
  client: InventoryBarcodeCacheClient;
  rpc: ReturnType<typeof vi.fn>;
} {
  const pending = [...responses];
  const rpc = vi.fn(async () => ({ data: pending.shift(), error: null }));
  return { client: { rpc }, rpc };
}

describe('shared inventory barcode cache', () => {
  it('returns a shared hit without claiming an external lookup', async () => {
    const { client, rpc } = cacheClient([{
      state: 'hit',
      cacheHit: true,
      cachedProvider: 'tavily',
      match: {
        barcode: '3245064079709',
        designation: 'Legrand DX3 — Réf. 407970',
        source: 'web',
        confidence: 'high',
        variantComplete: true,
      },
    }]);

    const result = await claimInventoryBarcodeLookup(client, '3245064079709', crypto.randomUUID());

    expect(result.state).toBe('hit');
    expect(result.match?.designation).toContain('Legrand');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('waits for another worker instead of performing a duplicate search', async () => {
    const { client, rpc } = cacheClient([
      { state: 'pending', retryAfterMs: 100 },
      {
        state: 'hit',
        cacheHit: true,
        match: {
          barcode: '4003773076898',
          designation: 'KNIPEX Cobra 250 mm',
          source: 'web',
          confidence: 'high',
          variantComplete: true,
        },
      },
    ]);

    const result = await claimInventoryBarcodeLookup(client, '4003773076898', crypto.randomUUID(), {
      maxWaitMs: 300,
      pollMs: 100,
    });

    expect(result.state).toBe('hit');
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('stores provider metadata and supports negative-cache and lease release operations', async () => {
    const { client, rpc } = cacheClient([{ state: 'stored' }, true, true]);
    const leaseToken = crypto.randomUUID();
    const match = {
      barcode: '3245064079709',
      designation: 'Legrand DX3 — Réf. 407970',
      source: 'web',
      confidence: 'high' as const,
      variantComplete: true,
    };

    await completeInventoryBarcodeLookup(client, match.barcode, leaseToken, match, {
      provider: 'tavily',
      providersTried: ['tavily'],
      lookupVersion: 1,
    });
    await markInventoryBarcodeNotFound(client, '00000000', leaseToken);
    await releaseInventoryBarcodeLookup(client, '00000000', leaseToken);

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'inventory_barcode_cache_complete',
      'inventory_barcode_cache_mark_not_found',
      'inventory_barcode_cache_release',
    ]);
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_provider: 'tavily',
      p_providers_tried: ['tavily'],
      p_match: match,
    });
  });
});
