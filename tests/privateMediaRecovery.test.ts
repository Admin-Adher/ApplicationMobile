import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const getSession = vi.hoisted(() => vi.fn());
vi.mock('../vercel-app/lib/supabase-browser', () => ({ supabaseBrowser: { auth: { getSession } } }));
const ref = 'btmedia://11111111-1111-4111-8111-111111111111';
const response = (url: string) => new Response(JSON.stringify({ assets: [{ ref, url, expiresAt: Date.now() + 600_000 }] }));
beforeEach(() => { vi.useFakeTimers(); getSession.mockResolvedValue({ data: { session: { access_token: 'fixture' } } }); });
afterEach(async () => { (await import('../vercel-app/lib/private-media-client')).resetPrivateMedia(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });
describe('mounted private media recovery', () => {
  it('renews mounted signed URLs before expiry and removes its timer on unmount', async () => {
    const fetch = vi.fn(async () => response('https://fixture.invalid/' + fetch.mock.calls.length)); vi.stubGlobal('fetch', fetch);
    const media = await import('../vercel-app/lib/private-media-client');
    const unsubscribe = media.subscribePrivateMedia(() => {}, { ref, priority: 'critical' });
    media.requestPrivateMedia(ref, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(540_000);
    expect(fetch).toHaveBeenCalledTimes(2); expect(media.peekPrivateMediaAccess(ref).status).toBe('ready');
    unsubscribe(); expect(vi.getTimerCount()).toBe(0);
  });
  it('releases a stalled critical lane so another plan can load', async () => {
    const second = 'btmedia://22222222-2222-4222-8222-222222222222';
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const refs = JSON.parse(init.body).refs;
      if (refs.includes(ref)) return new Promise<Response>(() => {});
      return new Response(JSON.stringify({ assets: [{ ref: second, url: 'https://fixture.invalid/second', expiresAt: Date.now() + 600000 }] }));
    }));
    const media = await import('../vercel-app/lib/private-media-client');
    media.requestPrivateMedia(ref, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(1);
    media.requestPrivateMedia(second, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(24_005);
    expect(media.peekPrivateMediaAccess(ref).status).toBe('error'); expect(media.peekPrivateMediaAccess(second).status).toBe('ready');
  });
  it('caps automatic retries and allows an explicit retry after recovery', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ assets: [] }))); vi.stubGlobal('fetch', fetch);
    const media = await import('../vercel-app/lib/private-media-client');
    const off = media.subscribePrivateMedia(() => {}, { ref, priority: 'critical' });
    media.requestPrivateMedia(ref, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).toHaveBeenCalledTimes(3); expect(media.peekPrivateMediaAccess(ref).status).toBe('error');
    fetch.mockImplementation(async () => response('https://fixture.invalid/recovered'));
    media.retryPrivateMedia(ref, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(1);
    expect(media.peekPrivateMediaAccess(ref).status).toBe('ready'); off();
  });
  it('ignores a late old-account resolution after the media owner is reset', async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => response('https://fixture.invalid/new-owner'));
    vi.stubGlobal('fetch', fetch); const media = await import('../vercel-app/lib/private-media-client');
    media.requestPrivateMedia(ref, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(1);
    media.resetPrivateMedia(); media.requestPrivateMedia(ref, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(1);
    finish(response('https://fixture.invalid/old-owner')); await vi.advanceTimersByTimeAsync(1);
    expect(media.peekPrivateMediaAccess(ref).url).toBe('https://fixture.invalid/new-owner');
  });
  it('recovers on reconnect even when the offline retry budget was exhausted', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('offline'); }); vi.stubGlobal('fetch', fetch);
    const media = await import('../vercel-app/lib/private-media-client');
    const off = media.subscribePrivateMedia(() => {}, { ref, priority: 'critical' });
    media.requestPrivateMedia(ref, { priority: 'critical' }); await vi.advanceTimersByTimeAsync(20_000);
    expect(media.peekPrivateMediaAccess(ref).status).toBe('error');
    vi.stubGlobal('fetch', vi.fn(async () => response('https://fixture.invalid/online')));
    media.refreshPrivateMediaSession(true); await vi.advanceTimersByTimeAsync(1);
    expect(media.peekPrivateMediaAccess(ref).status).toBe('ready'); off();
  });
});
