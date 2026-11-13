/** For idempotent reads only. Writes keep their existing durable/idempotent path. */
export async function boundedRead<T>(
  read: (signal: AbortSignal) => PromiseLike<T>,
  options: { signal?: AbortSignal; timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const cancelled = () => Object.assign(new Error('Lecture annulée.'), { name: 'AbortError' });
    if (options.signal?.aborted) throw cancelled();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort = () => {};
    try {
      return await Promise.race([
        Promise.resolve().then(() => read(controller.signal)),
        new Promise<never>((_, reject) => {
          abort = () => { controller.abort(); reject(cancelled()); };
          options.signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => {
            reject(Object.assign(new Error('Le serveur met trop de temps à répondre. Réessayez.'), { code: 'READ_TIMEOUT' }));
            controller.abort();
          }, options.timeoutMs ?? 12_000);
        }),
      ]);
    } catch (cause) {
      const error = cause as { code?: string; status?: number; name?: string };
      const transient = error?.code === 'READ_TIMEOUT' || error?.code === '57014' || error?.name === 'TypeError' ||
        [0, 408, 429, 500, 502, 503, 504].includes(error?.status ?? -1);
      if (options.signal?.aborted || !transient || attempt >= (options.retries ?? 1)) throw cause;
    } finally {
      clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    }
  }
}

export async function readSupabase<T>(
  read: (signal: AbortSignal) => PromiseLike<{ data: T | null; error: unknown; status?: number }>,
  options: Parameters<typeof boundedRead>[1] = {},
): Promise<T | null> {
  return boundedRead(async signal => {
    const task = read(signal);
    // This wrapper owns the retry budget; avoid nesting the SDK GET backoff.
    const configurable = task as typeof task & { retry?: (enabled: boolean) => typeof task };
    const result = await (configurable.retry ? configurable.retry(false) : task);
    if (result.error) throw Object.assign(new Error((result.error as { message?: string }).message ?? 'Lecture impossible.'),
      result.error, { status: result.status });
    return result.data;
  }, options);
}
