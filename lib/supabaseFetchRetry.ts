export type TimedIdempotentRetryOptions<T> = {
  method: string;
  firstTimeoutMs: number;
  retryTimeoutMs: number;
  attempt: (timeoutMs: number) => Promise<T>;
  isUpstreamAborted?: () => boolean;
  onRetry?: (firstTimeoutMs: number, retryTimeoutMs: number) => void;
};

export type FirstAttemptTimeoutOptions = {
  method: string;
  url: string;
  isNative: boolean;
  fullTimeoutMs: number;
  staleSocketProbeMs: number;
};

export function selectFirstAttemptTimeout(options: FirstAttemptTimeoutOptions): number {
  const method = options.method.toUpperCase();
  const idempotent = method === 'GET' || method === 'HEAD';
  const isPostgrestRead = options.url.includes('/rest/v1/');
  return options.isNative && idempotent && isPostgrestRead
    ? options.staleSocketProbeMs
    : options.fullTimeoutMs;
}

/**
 * Runs one request and retries only a locally timed-out, idempotent read.
 *
 * The retry deliberately receives its own (usually longer) deadline. Writes
 * are never replayed here because their outcome may already have reached the
 * server; the durable sync queue owns mutation recovery.
 */
export async function runTimedIdempotentRetry<T>(
  options: TimedIdempotentRetryOptions<T>,
): Promise<T> {
  try {
    return await options.attempt(options.firstTimeoutMs);
  } catch (error: any) {
    const upstreamAborted = options.isUpstreamAborted?.() ?? false;
    const timedOutLocally = error?.name === 'AbortError' && !upstreamAborted;
    const method = options.method.toUpperCase();
    const idempotent = method === 'GET' || method === 'HEAD';

    if (!timedOutLocally || !idempotent) throw error;

    options.onRetry?.(options.firstTimeoutMs, options.retryTimeoutMs);
    return options.attempt(options.retryTimeoutMs);
  }
}
