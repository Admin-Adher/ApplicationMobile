import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForPlanUri } from '../lib/plan-progress/startup';
import { readDirectory } from '../lib/directoryRetry';

afterEach(() => vi.useRealTimers());
describe('progress PDF startup', () => {
  it('waits for the first signed URL and does not follow subsequent renewals', async () => {
    vi.useFakeTimers(); let uri = '';
    const pending = waitForPlanUri(() => uri, new AbortController().signal);
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(300); expect(settled).toBe(false);
    uri = 'https://plan.invalid/first'; await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBe(uri);
    uri = 'https://plan.invalid/renewed'; await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBe('https://plan.invalid/first');
  });
  it('fails with a retryable message if resolution never completes', async () => {
    vi.useFakeTimers(); const pending = waitForPlanUri(() => '', new AbortController().signal, 500);
    const assertion = expect(pending).rejects.toThrow('pas encore disponible');
    await vi.advanceTimersByTimeAsync(500); await assertion; expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a pending resolution on plan or account change', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const pending = waitForPlanUri(() => '', controller.signal);
    const assertion = expect(pending).rejects.toThrow('annulée'); controller.abort(); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe('users directory recovery', () => {
  it('recovers automatically after a server timeout', async () => {
    vi.useFakeTimers(); const read = vi.fn().mockRejectedValueOnce({ code: '57014', status: 500 }).mockResolvedValue([{ id: 'user' }]);
    const pending = readDirectory(read, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual([{ id: 'user' }]); expect(read).toHaveBeenCalledTimes(2);
  });
  it('stops after three failed reads so a manual retry stays possible', async () => {
    vi.useFakeTimers(); const read = vi.fn().mockRejectedValue({ code: 'REST_TIMEOUT' });
    const pending = readDirectory(read, new AbortController().signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'REST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(3000); await assertion; expect(read).toHaveBeenCalledTimes(3);
  });
  it('does not retry an access denial', async () => {
    const read = vi.fn().mockRejectedValue({ code: '42501', status: 403 });
    await expect(readDirectory(read, new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('cancels a retry when the account changes', async () => {
    vi.useFakeTimers(); const controller = new AbortController(), read = vi.fn().mockRejectedValue({ status: 503 });
    const pending = readDirectory(read, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.advanceTimersByTimeAsync(1); controller.abort(); await assertion;
    await vi.advanceTimersByTimeAsync(4000); expect(read).toHaveBeenCalledTimes(1);
  });
  it('rejects a late successful response after logout', async () => {
    const controller = new AbortController(); let finish!: (value: string[]) => void;
    const pending = readDirectory(() => new Promise<string[]>(resolve => { finish = resolve; }), controller.signal);
    controller.abort(); finish(['other-account']);
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
