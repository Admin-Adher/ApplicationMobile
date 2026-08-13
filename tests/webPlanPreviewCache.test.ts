import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPlanPreviewsForUser,
  createPlanPreviewCacheUrl,
  readPlanPreview,
  writePlanPreview,
} from '../vercel-app/app/web/plan-reserve-workspace/plan-preview-cache';

class MemoryCache {
  entries = new Map<string, Response>();

  async match(input: RequestInfo | URL) {
    return this.entries.get(String(input))?.clone();
  }

  async put(input: RequestInfo | URL, response: Response) {
    this.entries.set(String(input), response.clone());
  }

  async keys() {
    return Array.from(this.entries.keys(), url => new Request(url));
  }

  async delete(input: RequestInfo | URL) {
    const key = typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : input.toString();
    return this.entries.delete(key);
  }
}

describe('account-scoped web plan preview cache', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a deterministic opaque key that changes by account and revision', async () => {
    const first = await createPlanPreviewCacheUrl({ userId: 'user-a', planKey: 'plan-a:rev-1:btmedia://secret' });
    const same = await createPlanPreviewCacheUrl({ userId: 'user-a', planKey: 'plan-a:rev-1:btmedia://secret' });
    const otherRevision = await createPlanPreviewCacheUrl({ userId: 'user-a', planKey: 'plan-a:rev-2:btmedia://secret' });
    const otherUser = await createPlanPreviewCacheUrl({ userId: 'user-b', planKey: 'plan-a:rev-1:btmedia://secret' });

    expect(first).toBe(same);
    expect(otherRevision).not.toBe(first);
    expect(otherUser).not.toBe(first);
    expect(first).not.toContain('user-a');
    expect(first).not.toContain('btmedia');
    expect(first).not.toContain('secret');
  });

  it('reads only the current user preview and clears no other account', async () => {
    const cache = new MemoryCache();
    vi.stubGlobal('caches', { open: vi.fn(async () => cache) });
    const blobA = new Blob(['preview-a'], { type: 'image/webp' });
    const blobB = new Blob(['preview-b'], { type: 'image/webp' });

    expect(await writePlanPreview({ userId: 'user-a', planKey: 'plan', blob: blobA, width: 1200, height: 800 })).toBe(true);
    expect(await writePlanPreview({ userId: 'user-b', planKey: 'plan', blob: blobB, width: 900, height: 600 })).toBe(true);
    expect((await readPlanPreview({ userId: 'user-a', planKey: 'plan' }))?.width).toBe(1200);

    await clearPlanPreviewsForUser('user-a');

    expect(await readPlanPreview({ userId: 'user-a', planKey: 'plan' })).toBeNull();
    expect((await readPlanPreview({ userId: 'user-b', planKey: 'plan' }))?.width).toBe(900);
  });

  it('fails open when Cache Storage is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    const preview = await readPlanPreview({ userId: 'user-a', planKey: 'plan' });
    const written = await writePlanPreview({
      userId: 'user-a',
      planKey: 'plan',
      blob: new Blob(['preview'], { type: 'image/webp' }),
      width: 100,
      height: 100,
    });

    expect(preview).toBeNull();
    expect(written).toBe(false);
  });
});
