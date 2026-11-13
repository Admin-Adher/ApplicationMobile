import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('versioned progress editor assets', () => {
  it('shares a versioned download across editor openings', async () => {
    vi.stubGlobal('caches', { open: async () => ({ match: async () => null, put: async () => {} }) });
    const fetch = vi.fn(async (_url: string) => new Response('editor code')); vi.stubGlobal('fetch', fetch);
    const { loadProgressAsset } = await import('../vercel-app/lib/plan-progress-assets');
    expect(await loadProgressAsset('editor.html')).toBe('editor code');
    expect(await loadProgressAsset('editor.html')).toBe('editor code');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatch(/^\/plan-progress\/editor\.html\?v=[a-f0-9]{20}$/);
  });
  it('opens cached code without waiting for network access', async () => {
    vi.stubGlobal('caches', { open: async () => ({ match: async () => new Response('cached module') }) });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { loadProgressAsset } = await import('../vercel-app/lib/plan-progress-assets');
    expect(await loadProgressAsset('pdf.mjs')).toBe('cached module'); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not poison subsequent attempts with a failed asset promise', async () => {
    vi.stubGlobal('caches', { open: async () => ({ match: async () => null, put: async () => {} }) });
    const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValue(new Response('recovered'));
    vi.stubGlobal('fetch', fetch); const { loadProgressAsset } = await import('../vercel-app/lib/plan-progress-assets');
    await expect(loadProgressAsset('pdf.worker.mjs')).rejects.toThrow('indisponible');
    expect(await loadProgressAsset('pdf.worker.mjs')).toBe('recovered');
  });
});
