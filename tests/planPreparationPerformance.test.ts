import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planWebViewBaseUrl, resolvePlanDisplaySource } from '../lib/planDisplay';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('plan preparation performance', () => {
  it('returns an account-scoped local copy without resolving or downloading again', async () => {
    let resolveCalls = 0;
    let warmCalls = 0;

    const source = await resolvePlanDisplaySource('btmedia://plan-id', {
      getCachedUri: async () => 'file:///private/user-a/plan.pdf',
      resolveRemoteUri: async () => {
        resolveCalls += 1;
        return 'https://storage.example/plan.pdf?token=secret';
      },
      warmCache: () => { warmCalls += 1; },
    });

    expect(source).toEqual({ uri: 'file:///private/user-a/plan.pdf', fromCache: true });
    expect(resolveCalls).toBe(0);
    expect(warmCalls).toBe(0);
  });

  it('returns the authorized URL while the offline copy is still pending', async () => {
    let backgroundSettled = false;
    let releaseBackground!: () => void;
    const backgroundDownload = new Promise<void>(resolveDownload => {
      releaseBackground = () => {
        backgroundSettled = true;
        resolveDownload();
      };
    });

    const source = await resolvePlanDisplaySource('btmedia://plan-id', {
      getCachedUri: async () => null,
      resolveRemoteUri: async () => 'https://storage.example/plan.pdf?token=secret',
      warmCache: () => { void backgroundDownload; },
    });

    expect(source).toEqual({
      uri: 'https://storage.example/plan.pdf?token=secret',
      fromCache: false,
    });
    expect(backgroundSettled).toBe(false);
    releaseBackground();
    await backgroundDownload;
  });

  it('does not duplicate a media-disk hit into the plan cache', async () => {
    let warmCalls = 0;
    const source = await resolvePlanDisplaySource('btmedia://plan-id', {
      getCachedUri: async () => null,
      resolveRemoteUri: async () => 'file:///private/user-a/media-cache-entry',
      warmCache: () => { warmCalls += 1; },
    });

    expect(source.fromCache).toBe(true);
    expect(warmCalls).toBe(0);
  });

  it('uses the remote origin without leaking the signed query into the WebView base URL', () => {
    expect(planWebViewBaseUrl('https://storage.example/path/plan.pdf?token=secret')).toBe('https://storage.example/');
    expect(planWebViewBaseUrl('file:///private/user-a/plan.pdf')).toBe('file:///private/user-a/plan.pdf');
    expect(planWebViewBaseUrl('data:application/pdf;base64,abc')).toBe('https://localhost');
  });

  it('keeps the viewer fast path, cache fallback, and credential-safe logging wired', () => {
    const viewer = read('components/PdfPlanViewer.tsx');
    const planCache = read('lib/planCache.ts');

    expect(viewer).toContain('await getPlanUriForDisplay(planUri)');
    expect(viewer).not.toContain('getPlanUriCacheFirst');
    expect(viewer).toContain('void ensurePlanCached(planUri)');
    expect(viewer).toContain('planWebViewBaseUrl(resolvedUri)');
    expect(viewer).not.toContain('msg.uri');
    expect(viewer).not.toContain("URI: '+(PLAN_URI");
    expect(viewer).not.toContain('err.message||err.name');
    expect(planCache).toContain('void ensurePlanCachedForScope(scope, remoteUrl, resolvedUri)');
    expect(planCache).toContain('const existing = inFlightDownloads.get(inFlightKey)');
  });

  it('warms PDF.js and short-lived plan URLs before the plan screen needs them', () => {
    const appContext = read('context/AppContext.tsx');
    const media = read('lib/media.ts');
    const pdfJsAsset = read('lib/pdfjsAsset.ts');
    const viewer = read('components/PdfPlanViewer.tsx');

    expect(appContext).toContain('void loadBundledPdfJsSources()');
    expect(appContext).toContain("resolveMediaRefs(refs, { cacheDisk: false })");
    expect(appContext).toContain('authH.isSessionValidationPending');
    expect(pdfJsAsset).toContain('getLoadedBundledPdfJsSources');
    expect(viewer).toContain('getLoadedBundledPdfJsSources()');
    expect(media).toContain('resolveMediaRefsWithSession([ref], session, options)');
    expect(media).not.toContain('resolveMediaRefs([ref], options)');
  });
});
