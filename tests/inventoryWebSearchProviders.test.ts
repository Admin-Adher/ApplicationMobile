import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InventoryWebSearchError,
  resetInventoryWebSearchProviderStateForTests,
  searchInventoryBarcodeWeb,
} from '../lib/server/inventoryWebSearchProviders';

const code = '3245064079709';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('inventory web search provider fallback', () => {
  beforeEach(() => resetInventoryWebSearchProviderStateForTests());

  it('uses Tavily first and does not consume SerpAPI when Tavily succeeds', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      results: [{
        title: `Legrand DX3 ${code}`,
        content: `EAN ${code}. Reference 407970, 13 A.`,
        url: 'https://www.legrand.com/product/407970',
      }],
    })) as unknown as typeof fetch;

    const result = await searchInventoryBarcodeWeb({
      code,
      tavilyApiKey: 'tvly-test',
      serpApiKey: 'serp-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.provider).toBe('tavily');
    expect(result.providersTried).toEqual(['tavily']);
    expect(result.results[0]).toMatchObject({
      title: `Legrand DX3 ${code}`,
      description: `EAN ${code}. Reference 407970, 13 A.`,
      url: 'https://www.legrand.com/product/407970',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('switches to SerpAPI after Tavily reaches the monthly quota', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('api.tavily.com')) {
        return jsonResponse({ detail: { error: 'Plan usage limit reached' } }, 432);
      }
      return jsonResponse({
        organic_results: [{
          title: `Legrand DX3 ${code}`,
          snippet: `EAN ${code}. Reference 407970, 13 A.`,
          link: 'https://www.legrand.com/product/407970',
          thumbnail: 'https://images.example/407970.jpg',
        }],
      });
    });

    const result = await searchInventoryBarcodeWeb({
      code,
      tavilyApiKey: 'tvly-test',
      serpApiKey: 'serp-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => Date.UTC(2026, 7, 10),
    });

    expect(result.provider).toBe('serpapi');
    expect(result.providersTried).toEqual(['tavily', 'serpapi']);
    expect(result.fallbackReason).toBe('tavily_http_432');
    expect(result.results[0]?.thumbnail?.src).toBe('https://images.example/407970.jpg');

    fetchImpl.mockClear();
    await searchInventoryBarcodeWeb({
      code,
      tavilyApiKey: 'tvly-test',
      serpApiKey: 'serp-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => Date.UTC(2026, 7, 11),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('serpapi.com');
  });

  it('reports provider statuses without exposing provider payloads', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      return String(input).includes('api.tavily.com')
        ? jsonResponse({ detail: { error: 'Unavailable' } }, 500)
        : jsonResponse({ error: 'Out of searches' }, 429);
    });

    await expect(searchInventoryBarcodeWeb({
      code,
      tavilyApiKey: 'tvly-test',
      serpApiKey: 'serp-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toMatchObject({
      providerStatuses: { tavily: 500, serpapi: 429 },
    });
  });
});
