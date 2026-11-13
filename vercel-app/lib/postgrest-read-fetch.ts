import { boundedRead } from './bounded-read';

/** Cap secondary GET/HEAD reads too; mutation requests pass through unchanged. */
export function createPostgrestReadFetch(fetcher: typeof fetch, timeoutMs = 12_000): typeof fetch {
  return async (input, init) => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!['GET', 'HEAD'].includes(method) || !/\/rest\/v1\//.test(url)) return fetcher(input, init);
    return boundedRead(async signal => {
      const response = await fetcher(input, { ...init, signal });
      // Include the body in the deadline: headers alone do not finish a read.
      const bytes = await response.arrayBuffer();
      return new Response(bytes.byteLength ? bytes : null, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    }, { signal: init?.signal ?? request?.signal, timeoutMs, retries: 0 });
  };
}
