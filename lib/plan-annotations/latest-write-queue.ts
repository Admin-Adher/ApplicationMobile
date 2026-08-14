export type LatestWriteTask<T> = (value: T) => Promise<void>;
export type LatestWriteFailureHandler<T> = (error: unknown, value: T) => void;
export type LatestWriteMerge<T> = (previous: T, next: T) => T;

type QueueJob<T> = {
  value: T;
  write: LatestWriteTask<T>;
  onFinalFailure?: LatestWriteFailureHandler<T>;
};

type QueueWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

type QueueEntry<T> = {
  active: QueueJob<T> | null;
  latest: QueueJob<T> | null;
  waiters: QueueWaiter[];
  running: boolean;
};

/**
 * Serializes writes per entity while coalescing pending values to the latest
 * complete snapshot. A failed superseded write is ignored when a newer
 * snapshot succeeds; only the final failed snapshot triggers retry handling.
 */
export class LatestWriteQueue<T> {
  private readonly entries = new Map<string, QueueEntry<T>>();

  enqueue(
    key: string,
    value: T,
    write: LatestWriteTask<T>,
    onFinalFailure?: LatestWriteFailureHandler<T>,
    merge?: LatestWriteMerge<T>,
  ): Promise<void> {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) return Promise.reject(new Error('A write queue key is required.'));

    const entry = this.entries.get(normalizedKey) ?? {
      active: null,
      latest: null,
      waiters: [],
      running: false,
    };
    this.entries.set(normalizedKey, entry);
    // A newer snapshot may arrive while the previous one is already in flight.
    // Let domain queues carry forward safety-critical state (for example a
    // pending file replacement that must keep using its guarded RPC) without
    // giving up latest-snapshot coalescing.
    const previousValue = entry.latest?.value ?? entry.active?.value;
    const nextValue = merge && previousValue !== undefined
      ? merge(previousValue, value)
      : value;
    entry.latest = { value: nextValue, write, onFinalFailure };

    const completion = new Promise<void>((resolve, reject) => {
      entry.waiters.push({ resolve, reject });
    });
    if (!entry.running) void this.drain(normalizedKey, entry);
    return completion;
  }

  private async drain(key: string, entry: QueueEntry<T>): Promise<void> {
    entry.running = true;
    let finalError: unknown = null;
    let finalFailedJob: QueueJob<T> | null = null;

    while (entry.latest) {
      const job = entry.latest;
      entry.latest = null;
      entry.active = job;
      try {
        await job.write(job.value);
        finalError = null;
        finalFailedJob = null;
      } catch (error) {
        finalError = error;
        finalFailedJob = job;
      } finally {
        entry.active = null;
      }
    }

    entry.running = false;
    this.entries.delete(key);
    const waiters = entry.waiters.splice(0);
    if (finalError !== null && finalFailedJob) {
      try {
        finalFailedJob.onFinalFailure?.(finalError, finalFailedJob.value);
      } catch {
        // Retry/reporting callbacks must never leave queue callers unsettled.
      }
      waiters.forEach(waiter => waiter.reject(finalError));
      return;
    }
    waiters.forEach(waiter => waiter.resolve());
  }
}
