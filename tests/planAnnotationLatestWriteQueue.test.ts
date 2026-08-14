import { describe, expect, it, vi } from 'vitest';
import { LatestWriteQueue } from '../lib/plan-annotations/latest-write-queue';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('LatestWriteQueue', () => {
  it('serializes one entity and coalesces pending snapshots to the latest value', async () => {
    const queue = new LatestWriteQueue<number>();
    const firstWrite = deferred<void>();
    const writes: number[] = [];
    const writer = vi.fn(async (value: number) => {
      writes.push(value);
      if (value === 1) await firstWrite.promise;
    });

    const one = queue.enqueue('plan-1', 1, writer);
    const two = queue.enqueue('plan-1', 2, writer);
    const three = queue.enqueue('plan-1', 3, writer);
    await Promise.resolve();
    expect(writes).toEqual([1]);

    firstWrite.resolve();
    await Promise.all([one, two, three]);
    expect(writes).toEqual([1, 3]);
    expect(writer).toHaveBeenCalledTimes(2);
  });

  it('keeps different plans independent', async () => {
    const queue = new LatestWriteQueue<string>();
    const blocked = deferred<void>();
    const writes: string[] = [];
    const first = queue.enqueue('plan-a', 'a', async value => {
      writes.push(value);
      await blocked.promise;
    });
    const second = queue.enqueue('plan-b', 'b', async value => { writes.push(value); });

    await second;
    expect(writes).toEqual(['a', 'b']);
    blocked.resolve();
    await first;
  });

  it('retries only the final failed snapshot and ignores a superseded failure', async () => {
    const queue = new LatestWriteQueue<number>();
    const blocked = deferred<void>();
    const finalFailure = vi.fn();
    const writer = vi.fn(async (value: number) => {
      if (value === 1) {
        await blocked.promise;
        throw new Error('stale failure');
      }
    });

    const first = queue.enqueue('plan-1', 1, writer, finalFailure);
    const latest = queue.enqueue('plan-1', 2, writer, finalFailure);
    blocked.resolve();
    await Promise.all([first, latest]);
    expect(finalFailure).not.toHaveBeenCalled();

    await expect(queue.enqueue('plan-1', 3, async () => {
      throw new Error('latest failure');
    }, finalFailure)).rejects.toThrow('latest failure');
    expect(finalFailure).toHaveBeenCalledOnce();
    expect(finalFailure.mock.calls[0][1]).toBe(3);
  });

  it('still rejects every caller when the final failure callback throws', async () => {
    const queue = new LatestWriteQueue<number>();
    const first = queue.enqueue('plan-1', 1, async () => {
      throw new Error('write failed');
    }, () => {
      throw new Error('reporting failed');
    });

    await expect(first).rejects.toThrow('write failed');
  });

  it('carries safety state from an in-flight value into its latest successor', async () => {
    type Snapshot = { revision: string; guarded: boolean };
    const queue = new LatestWriteQueue<Snapshot>();
    const blocked = deferred<void>();
    const writes: Snapshot[] = [];
    const writer = async (value: Snapshot) => {
      writes.push(value);
      if (value.revision === 'A') {
        await blocked.promise;
        throw new Error('replacement failed');
      }
    };
    const merge = (previous: Snapshot, next: Snapshot): Snapshot => ({
      ...next,
      guarded: previous.guarded || next.guarded,
    });

    const first = queue.enqueue('plan-1', { revision: 'A', guarded: true }, writer, undefined, merge);
    const latest = queue.enqueue('plan-1', { revision: 'B', guarded: false }, writer, undefined, merge);
    blocked.resolve();
    await Promise.all([first, latest]);

    expect(writes).toEqual([
      { revision: 'A', guarded: true },
      { revision: 'B', guarded: true },
    ]);
  });
});
