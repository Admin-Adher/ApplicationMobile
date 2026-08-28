import { describe, expect, it, vi } from 'vitest';
import { createSupabaseSessionReadCoordinator } from '../lib/supabaseSessionReads';

type Session = { id: string; expires_at: number };
type Result = { data: { session: Session | null }; error: unknown | null };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

describe('Supabase session read coordinator', () => {
  it('shares one auth read across a concurrent query burst', async () => {
    const pending = deferred<Result>();
    const read = vi.fn(() => pending.promise);
    const coordinator = createSupabaseSessionReadCoordinator<Session, Result>(read);

    const reads = [
      coordinator.getSession(),
      coordinator.getSession(),
      coordinator.getSession(),
    ];
    expect(read).toHaveBeenCalledTimes(1);

    pending.resolve({
      data: { session: { id: 'u1', expires_at: Math.floor(Date.now() / 1_000) + 3_600 } },
      error: null,
    });
    const results = await Promise.all(reads);
    expect(results.map(result => result.data.session?.id)).toEqual(['u1', 'u1', 'u1']);
  });

  it('uses a bounded cache and refreshes it after expiry', async () => {
    let now = 1_000_000;
    const result: Result = {
      data: { session: { id: 'u1', expires_at: 10_000 } },
      error: null,
    };
    const read = vi.fn(async () => result);
    const coordinator = createSupabaseSessionReadCoordinator<Session, Result>(read, {
      cacheMs: 2_000,
      now: () => now,
    });

    await coordinator.getSession();
    await coordinator.getSession();
    expect(read).toHaveBeenCalledTimes(1);

    now += 2_001;
    await coordinator.getSession();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not let an old in-flight result overwrite a newer auth event', async () => {
    const pending = deferred<Result>();
    const read = vi.fn(() => pending.promise);
    const coordinator = createSupabaseSessionReadCoordinator<Session, Result>(read);
    const oldRead = coordinator.getSession();

    coordinator.prime({
      id: 'u2',
      expires_at: Math.floor(Date.now() / 1_000) + 3_600,
    });
    await expect(coordinator.getSession()).resolves.toMatchObject({
      data: { session: { id: 'u2' } },
    });

    pending.resolve({
      data: { session: { id: 'u1', expires_at: Math.floor(Date.now() / 1_000) + 3_600 } },
      error: null,
    });
    await oldRead;
    await expect(coordinator.getSession()).resolves.toMatchObject({
      data: { session: { id: 'u2' } },
    });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('waits out an invalidated flight before reading a signed-out session', async () => {
    const oldPending = deferred<Result>();
    const read = vi.fn()
      .mockImplementationOnce(() => oldPending.promise)
      .mockResolvedValueOnce({ data: { session: null }, error: null });
    const coordinator = createSupabaseSessionReadCoordinator<Session, Result>(read);
    const oldRead = coordinator.getSession();

    coordinator.clear();
    const signedOutRead = coordinator.getSession();
    expect(read).toHaveBeenCalledTimes(1);

    oldPending.resolve({
      data: { session: { id: 'u1', expires_at: Math.floor(Date.now() / 1_000) + 3_600 } },
      error: null,
    });
    await oldRead;
    await expect(signedOutRead).resolves.toEqual({ data: { session: null }, error: null });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
