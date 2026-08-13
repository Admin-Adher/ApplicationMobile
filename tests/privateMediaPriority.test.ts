import { afterEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn(async () => ({
  data: { session: { access_token: 'test-token' } },
}));

vi.mock('../vercel-app/lib/supabase-browser', () => ({
  supabaseBrowser: { auth: { getSession } },
}));

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('private media priority lanes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    getSession.mockClear();
  });

  it('starts a critical plan resolve without waiting for an in-flight photo batch', async () => {
    let releasePhoto: (() => void) | undefined;
    const photoResponse = new Promise<Response>(resolve => {
      releasePhoto = () => resolve(new Response(JSON.stringify({ assets: [{
        ref: 'btmedia://11111111-1111-4111-8111-111111111111',
        url: 'https://storage.example/photo.jpg',
        expiresAt: Date.now() + 600_000,
      }] }), { status: 200 }));
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const refs = JSON.parse(String(init?.body ?? '{}')).refs as string[];
      if (refs[0]?.includes('11111111')) return photoResponse;
      return new Response(JSON.stringify({ assets: refs.map(ref => ({
        ref,
        url: 'https://storage.example/plan.pdf',
        expiresAt: Date.now() + 600_000,
      })) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const media = await import('../vercel-app/lib/private-media-client');
    const photoRef = 'btmedia://11111111-1111-4111-8111-111111111111';
    const planRef = 'btmedia://22222222-2222-4222-8222-222222222222';

    media.requestPrivateMedia(photoRef, { priority: 'background' });
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    media.requestPrivateMedia(planRef, { priority: 'critical' });
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ refs: [planRef] });
    expect(media.peekPrivateMediaAccess(planRef)).toMatchObject({ status: 'ready' });

    releasePhoto?.();
    await tick();
  });

  it('removes a promoted plan from the queued photo batch and resolves it in the critical lane', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const refs = JSON.parse(String(init?.body ?? '{}')).refs as string[];
      return new Response(JSON.stringify({ assets: refs.map(ref => ({
        ref,
        url: `https://storage.example/${ref.slice(-4)}`,
        expiresAt: Date.now() + 600_000,
      })) }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const media = await import('../vercel-app/lib/private-media-client');
    const photoRef = 'btmedia://33333333-3333-4333-8333-333333333333';
    const planRef = 'btmedia://44444444-4444-4444-8444-444444444444';

    media.requestPrivateMedia(photoRef, { priority: 'background' });
    media.requestPrivateMedia(planRef, { priority: 'background' });
    media.requestPrivateMedia(planRef, { priority: 'critical' });
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestedBatches = fetchMock.mock.calls.map(call => JSON.parse(String(call[1]?.body)).refs as string[]);
    expect(requestedBatches).toContainEqual([photoRef]);
    expect(requestedBatches).toContainEqual([planRef]);
    expect(requestedBatches.every(refs => refs.length === 1)).toBe(true);
    expect(media.peekPrivateMediaAccess(planRef)).toMatchObject({ status: 'ready' });
  });

  it('waits for the same reference already resolving in the other lane', async () => {
    let releasePlan: (() => void) | undefined;
    const planResponse = new Promise<Response>(resolve => {
      releasePlan = () => resolve(new Response(JSON.stringify({ assets: [{
        ref: 'btmedia://55555555-5555-4555-8555-555555555555',
        url: 'https://storage.example/shared-plan.pdf',
        expiresAt: Date.now() + 600_000,
      }] }), { status: 200 }));
    });
    const fetchMock = vi.fn(async () => planResponse);
    vi.stubGlobal('fetch', fetchMock);
    const media = await import('../vercel-app/lib/private-media-client');
    const planRef = 'btmedia://55555555-5555-4555-8555-555555555555';

    media.requestPrivateMedia(planRef, { priority: 'critical' });
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    let settled = false;
    const reportResolution = media.resolvePrivateMediaRefs([planRef], { priority: 'background' })
      .then(urls => {
        settled = true;
        return urls;
      });
    await tick();
    expect(settled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    releasePlan?.();
    const urls = await reportResolution;
    expect(urls.get(planRef)).toBe('https://storage.example/shared-plan.pdf');
  });
});
