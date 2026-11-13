import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedRead, readSupabase } from '../vercel-app/lib/bounded-read';
import { createWorkspaceReadQueue, publishWhenCurrent, sameWorkspaceAuthority, workspaceTablesForTab } from '../vercel-app/lib/progressive-workspace-load';
import { createAuthScopedLoadGuard } from '../vercel-app/lib/auth-load-guard';

afterEach(() => vi.useRealTimers());
describe('bounded workspace reads', () => {
  it('times out even if the underlying SDK ignores abort, then recovers on one retry', async () => {
    vi.useFakeTimers(); const signals: AbortSignal[] = [];
    const read = vi.fn((signal: AbortSignal) => { signals.push(signal); return signals.length === 1 ? new Promise<string>(() => {}) : Promise.resolve('ready'); });
    const pending = boundedRead(read, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toBe('ready'); expect(signals[0].aborted).toBe(true); expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not retry a permission failure or a write', async () => {
    const read = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'denied' }, status: 403 }));
    await expect(readSupabase(read)).rejects.toMatchObject({ code: '42501', status: 403 });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('aborts both the SDK wait and pending reads when another account starts loading', async () => {
    const guard = createAuthScopedLoadGuard(); guard.setAuthenticatedUser('a'); const first = guard.begin('a');
    const pending = boundedRead(() => new Promise(() => {}), { signal: first.signal });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    guard.setAuthenticatedUser('b'); guard.begin('b'); await assertion;
    expect(first.signal.aborted).toBe(true); expect(first.isCurrent()).toBe(false);
  });
  it('does not let a slow secondary dataset delay publishing a ready module', async () => {
    let finish!: () => void; const published: string[] = [];
    const slow = new Promise<void>(resolve => { finish = resolve; });
    const ready = publishWhenCurrent(Promise.resolve('plans'), { isCurrent: () => true }, v => published.push(v));
    const all = Promise.all([ready, slow]); await ready; expect(published).toEqual(['plans']); finish(); await all;
  });
  it('caps concurrency and promotes a newly opened screen ahead of queued secondary reads', async () => {
    let tab = 'dashboard'; const starts: string[] = [], finish: (() => void)[] = [];
    const queue = createWorkspaceReadQueue(table => workspaceTablesForTab(tab).includes(table) ? 10 : 0, 2);
    const read = (name: string) => queue.run(name, () => { starts.push(name); return new Promise<void>(resolve => finish.push(resolve)); });
    const jobs = ['reserves','companies','documents','photos','site_plans'].map(read);
    await Promise.resolve(); expect(starts).toEqual(['reserves','companies']);
    tab = 'plans'; finish.shift()!(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(starts[2]).toBe('site_plans');
    while (finish.length) { finish.shift()!(); await new Promise(resolve => setTimeout(resolve, 0)); }
    await Promise.all(jobs);
  });
  it('accepts a warm snapshot only for the same verified authority', () => {
    const p = { id: 'a', organization_id: 'org', role: 'conducteur', company_id: 'c', membership_status: 'active', permissions_override: { canExport: false, canEdit: true } };
    expect(sameWorkspaceAuthority(p, { ...p, permissions_override: { canEdit: true, canExport: false } })).toBe(true);
    for (const change of [{ id: 'b' }, { organization_id: 'other' }, { role: 'observateur' }, { company_id: 'd' }, { membership_status: 'revoked' }, { permissions_override: { canExport: true } }]) {
      expect(sameWorkspaceAuthority(p, { ...p, ...change })).toBe(false);
    }
  });
});
