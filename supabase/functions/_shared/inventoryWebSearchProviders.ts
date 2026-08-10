export type InventoryWebSearchProvider = 'tavily' | 'serpapi';

export type InventoryWebSearchResult = {
  title?: string;
  description?: string;
  extra_snippets?: string[];
  url?: string;
  profile?: { long_name?: string };
  thumbnail?: { src?: string; original?: string };
};

export type InventoryWebSearchResponse = {
  provider: InventoryWebSearchProvider;
  providersTried: InventoryWebSearchProvider[];
  results: InventoryWebSearchResult[];
  fallbackReason?: string;
};

export type InventoryWebSearchOptions = {
  code: string;
  language?: string;
  tavilyApiKey?: string;
  serpApiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

export class InventoryWebSearchError extends Error {
  readonly providerStatuses: Partial<Record<InventoryWebSearchProvider, number>>;

  constructor(
    message: string,
    providerStatuses: Partial<Record<InventoryWebSearchProvider, number>> = {},
  ) {
    super(message);
    this.name = 'InventoryWebSearchError';
    this.providerStatuses = providerStatuses;
  }
}

let tavilyBlockedUntil = 0;

function firstDayOfNextUtcMonth(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function languageCode(value: string | undefined): string {
  const language = String(value ?? 'fr').split('-')[0].toLowerCase();
  return ['fr', 'es', 'en'].includes(language) ? language : 'fr';
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'url' in value) {
    return typeof value.url === 'string' ? value.url : undefined;
  }
  return undefined;
}

function tavilyResults(payload: any): InventoryWebSearchResult[] {
  if (!Array.isArray(payload?.results)) return [];
  return payload.results.map((result: any) => ({
    title: result?.title,
    description: result?.content,
    url: result?.url,
    thumbnail: imageUrl(result?.images?.[0])
      ? { src: imageUrl(result.images[0]) }
      : undefined,
  }));
}

function serpApiResults(payload: any): InventoryWebSearchResult[] {
  if (!Array.isArray(payload?.organic_results)) return [];
  return payload.organic_results.map((result: any) => ({
    title: result?.title,
    description: result?.snippet,
    url: result?.link,
    thumbnail: typeof result?.thumbnail === 'string'
      ? { src: result.thumbnail }
      : undefined,
  }));
}

async function fetchWithDeadline(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchTavily(
  options: InventoryWebSearchOptions,
  fetchImpl: typeof fetch,
): Promise<{ response: Response; payload: any }> {
  const response = await fetchWithDeadline(fetchImpl, 'https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${options.tavilyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `"${options.code}"`,
      search_depth: 'basic',
      max_results: 20,
      topic: 'general',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      exact_match: true,
    }),
  }, options.timeoutMs ?? 4_000);
  return { response, payload: await response.json().catch(() => ({})) };
}

async function searchSerpApi(
  options: InventoryWebSearchOptions,
  fetchImpl: typeof fetch,
): Promise<{ response: Response; payload: any }> {
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', `"${options.code}"`);
  url.searchParams.set('hl', languageCode(options.language));
  url.searchParams.set('safe', 'active');
  url.searchParams.set('num', '20');
  url.searchParams.set('api_key', String(options.serpApiKey ?? ''));
  const response = await fetchWithDeadline(fetchImpl, url.toString(), {
    headers: { Accept: 'application/json' },
  }, options.timeoutMs ?? 4_000);
  return { response, payload: await response.json().catch(() => ({})) };
}

/**
 * Uses Tavily first. SerpAPI is consumed only when Tavily is not configured,
 * has reached its quota/rate limit, or is temporarily unavailable.
 */
export async function searchInventoryBarcodeWeb(
  options: InventoryWebSearchOptions,
): Promise<InventoryWebSearchResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = (options.now ?? Date.now)();
  const providersTried: InventoryWebSearchProvider[] = [];
  const providerStatuses: Partial<Record<InventoryWebSearchProvider, number>> = {};
  let fallbackReason: string | undefined;

  if (options.tavilyApiKey && now >= tavilyBlockedUntil) {
    providersTried.push('tavily');
    try {
      const { response, payload } = await searchTavily(options, fetchImpl);
      providerStatuses.tavily = response.status;
      if (response.ok) {
        return { provider: 'tavily', providersTried, results: tavilyResults(payload) };
      }
      fallbackReason = `tavily_http_${response.status}`;
      if (response.status === 432 || response.status === 433) {
        tavilyBlockedUntil = firstDayOfNextUtcMonth(now);
      } else if (response.status === 429) {
        tavilyBlockedUntil = now + 60_000;
      }
    } catch (error) {
      fallbackReason = error instanceof DOMException && error.name === 'AbortError'
        ? 'tavily_timeout'
        : 'tavily_unavailable';
    }
  } else if (options.tavilyApiKey) {
    fallbackReason = 'tavily_circuit_open';
  } else {
    fallbackReason = 'tavily_not_configured';
  }

  if (options.serpApiKey) {
    providersTried.push('serpapi');
    try {
      const { response, payload } = await searchSerpApi(options, fetchImpl);
      providerStatuses.serpapi = response.status;
      if (response.ok && !payload?.error) {
        return {
          provider: 'serpapi',
          providersTried,
          results: serpApiResults(payload),
          fallbackReason,
        };
      }
    } catch {
      // The status summary below deliberately avoids logging either API key.
    }
  }

  throw new InventoryWebSearchError(
    options.tavilyApiKey || options.serpApiKey
      ? 'No web search provider is currently available'
      : 'No web search provider is configured',
    providerStatuses,
  );
}

export function resetInventoryWebSearchProviderStateForTests(): void {
  tavilyBlockedUntil = 0;
}
