import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyedBatcher } from '../lib/mediaBatcher';

afterEach(() => {
  vi.useRealTimers();
});

describe('private media batcher', () => {
  it('coalesces a render burst and deduplicates identical refs', async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async (keys: string[]) => (
      new Map(keys.map(key => [key, `resolved:${key}`]))
    ));
    const batcher = createKeyedBatcher(handler, { delayMs: 20 });

    const first = batcher.request('a');
    const duplicate = batcher.request('a');
    const second = batcher.request('b');
    expect(duplicate).toBe(first);
    expect(handler).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20);
    await expect(Promise.all([first, duplicate, second])).resolves.toEqual([
      'resolved:a',
      'resolved:a',
      'resolved:b',
    ]);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(['a', 'b']);
  });

  it('rejects a ref omitted by the resolver instead of leaving it pending', async () => {
    vi.useFakeTimers();
    const batcher = createKeyedBatcher(async () => new Map<string, string>(), {
      delayMs: 10,
      missingError: key => new Error(`missing:${key}`),
    });
    const request = batcher.request('missing');
    await vi.advanceTimersByTimeAsync(10);
    await expect(request).rejects.toThrow('missing:missing');
  });

  it('invalidates queued work on an account switch', async () => {
    vi.useFakeTimers();
    const handler = vi.fn(async () => new Map([['a', 'resolved:a']]));
    const batcher = createKeyedBatcher(handler, { delayMs: 20 });
    const request = batcher.request('a');

    batcher.clear(new Error('account changed'));

    await expect(request).rejects.toThrow('account changed');
    await vi.advanceTimersByTimeAsync(20);
    expect(handler).not.toHaveBeenCalled();
  });

  it('invalidates in-flight work with the account-switch reason', async () => {
    vi.useFakeTimers();
    let resolveHandler!: (value: Map<string, string>) => void;
    const batcher = createKeyedBatcher<string>(
      () => new Promise<Map<string, string>>(resolve => { resolveHandler = resolve; }),
      { delayMs: 20 },
    );
    const request = batcher.request('a');
    await vi.advanceTimersByTimeAsync(20);

    batcher.clear(new Error('account changed'));

    await expect(request).rejects.toThrow('account changed');
    resolveHandler(new Map([['a', 'stale-result']]));
    await vi.runAllTimersAsync();
  });
});
