export type SessionReadSession = {
  expires_at?: number | null;
};

export type SessionReadResult<TSession extends SessionReadSession> = {
  data: { session: TSession | null };
  error: unknown | null;
};

type SessionReadCoordinatorOptions = {
  cacheMs?: number;
  expiryMarginSeconds?: number;
  now?: () => number;
};

type SessionReadFlight<TResult> = {
  generation: number;
  promise: Promise<TResult>;
};

/**
 * Coalesces the burst of auth.getSession() calls generated when many
 * PostgREST queries mount together. Supabase serializes every call through
 * its auth lock, so one shared read avoids a long AsyncStorage lock queue.
 */
export function createSupabaseSessionReadCoordinator<
  TSession extends SessionReadSession,
  TResult extends SessionReadResult<TSession>,
>(
  readSession: () => Promise<TResult>,
  options: SessionReadCoordinatorOptions = {},
) {
  const cacheMs = options.cacheMs ?? 2_000;
  const expiryMarginSeconds = options.expiryMarginSeconds ?? 30;
  const now = options.now ?? Date.now;

  let generation = 0;
  let cached: { result: TResult; until: number } | null = null;
  let inFlight: SessionReadFlight<TResult> | null = null;

  const cacheUntil = (result: SessionReadResult<TSession>): number | null => {
    if (result.error) return null;
    const expiresAt = result.data?.session?.expires_at;
    if (typeof expiresAt !== 'number') return null;
    const nowMs = now();
    const usableUntil = (expiresAt - expiryMarginSeconds) * 1_000;
    if (usableUntil <= nowMs) return null;
    return Math.min(nowMs + cacheMs, usableUntil);
  };

  const getSession = (): Promise<TResult> => {
    const nowMs = now();
    if (cached?.until && cached.until > nowMs) {
      return Promise.resolve(cached.result);
    }
    cached = null;

    if (inFlight) {
      if (inFlight.generation === generation) return inFlight.promise;
      // An auth event invalidated the active read. Let it settle, then read
      // the new session rather than leaking the previous account/session.
      return inFlight.promise.catch(() => undefined).then(() => getSession());
    }

    const flightGeneration = generation;
    let flight!: SessionReadFlight<TResult>;
    const promise = readSession()
      .then((result) => {
        if (generation === flightGeneration) {
          const until = cacheUntil(result);
          if (until) cached = { result, until };
        }
        return result;
      })
      .finally(() => {
        if (inFlight === flight) inFlight = null;
      });

    flight = { generation: flightGeneration, promise };
    inFlight = flight;
    return promise;
  };

  const prime = (session: TSession | null): void => {
    generation += 1;
    const result = { data: { session }, error: null } as TResult;
    const until = cacheUntil(result);
    cached = until ? { result, until } : null;
  };

  const clear = (): void => {
    generation += 1;
    cached = null;
  };

  return { clear, getSession, prime };
}
