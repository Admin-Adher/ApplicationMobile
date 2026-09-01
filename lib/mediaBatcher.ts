export type KeyedBatchHandler<T> = (keys: string[]) => Promise<Map<string, T>>;

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

export type KeyedBatcher<T> = {
  clear: (reason?: Error) => void;
  request: (key: string) => Promise<T>;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

/**
 * Coalesce component-level reads mounted in the same render burst into one
 * bounded request. Identical keys also share their in-flight promise.
 */
export function createKeyedBatcher<T>(
  handler: KeyedBatchHandler<T>,
  options?: {
    delayMs?: number;
    maxBatchSize?: number;
    missingError?: (key: string) => Error;
  },
): KeyedBatcher<T> {
  const delayMs = Math.max(0, options?.delayMs ?? 20);
  const maxBatchSize = Math.max(1, options?.maxBatchSize ?? 100);
  const missingError = options?.missingError ?? (key => new Error(`Missing batch result for ${key}`));

  const queued = new Map<string, Deferred<T>>();
  const pending = new Map<string, Deferred<T>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  const schedule = () => {
    if (timer || queued.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      const batchGeneration = generation;
      const entries = Array.from(queued.entries()).slice(0, maxBatchSize);
      for (const [key] of entries) queued.delete(key);

      void handler(entries.map(([key]) => key)).then(
        results => {
          if (batchGeneration !== generation) return;
          for (const [key, item] of entries) {
            const value = results.get(key);
            if (value === undefined) item.reject(missingError(key));
            else item.resolve(value);
          }
        },
        error => {
          if (batchGeneration !== generation) return;
          for (const [, item] of entries) item.reject(error);
        },
      ).finally(() => schedule());
    }, delayMs);
  };

  const request = (key: string): Promise<T> => {
    const existing = pending.get(key);
    if (existing) return existing.promise;

    const item = deferred<T>();
    queued.set(key, item);
    pending.set(key, item);
    item.promise.then(
      () => { if (pending.get(key) === item) pending.delete(key); },
      () => { if (pending.get(key) === item) pending.delete(key); },
    );
    schedule();
    return item.promise;
  };

  const clear = (reason = new Error('Batch invalidated')) => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const [, item] of pending) item.reject(reason);
    queued.clear();
    pending.clear();
  };

  return { clear, request };
}
