import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isResolvablePlanUri,
  planWebViewBaseUrl,
  resolvePlanCacheScope,
  resolvePlanDisplaySource,
  transitionPrivateCacheOwner,
} from '../lib/planDisplay';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('plan preparation performance', () => {
  it('returns an account-scoped local copy without resolving or downloading again', async () => {
    let resolveCalls = 0;

    const source = await resolvePlanDisplaySource('btmedia://plan-id', {
      getCachedUri: async () => 'file:///private/user-a/plan.pdf',
      resolveRemoteUri: async () => {
        resolveCalls += 1;
        return 'https://storage.example/plan.pdf?token=secret';
      },
    });

    expect(source).toEqual({ uri: 'file:///private/user-a/plan.pdf', fromCache: true });
    expect(resolveCalls).toBe(0);
  });

  it('returns the authorized URL without starting a duplicate viewer download', async () => {
    const source = await resolvePlanDisplaySource('btmedia://plan-id', {
      getCachedUri: async () => null,
      resolveRemoteUri: async () => 'https://storage.example/plan.pdf?token=secret',
    });

    expect(source).toEqual({
      uri: 'https://storage.example/plan.pdf?token=secret',
      fromCache: false,
    });
  });

  it('does not duplicate a media-disk hit into the plan cache', async () => {
    const source = await resolvePlanDisplaySource('btmedia://plan-id', {
      getCachedUri: async () => null,
      resolveRemoteUri: async () => 'file:///private/user-a/media-cache-entry',
    });

    expect(source.fromCache).toBe(true);
  });

  it('uses the remote origin without leaking the signed query into the WebView base URL', () => {
    expect(planWebViewBaseUrl('https://storage.example/path/plan.pdf?token=secret')).toBe('https://storage.example/');
    expect(planWebViewBaseUrl('file:///private/user-a/plan.pdf')).toBe('file:///private/user-a/plan.pdf');
    expect(planWebViewBaseUrl('data:application/pdf;base64,abc')).toBe('https://localhost');
  });

  it('preserves private files during bootstrap and only purges on a real account switch', () => {
    const userA = '11111111-1111-4111-8111-111111111111';
    const userB = '22222222-2222-4222-8222-222222222222';

    const coldStart = transitionPrivateCacheOwner(null, null);
    const restored = transitionPrivateCacheOwner(coldStart.rememberedOwnerId, userA);
    const transientOffline = transitionPrivateCacheOwner(restored.rememberedOwnerId, null);
    const sameUser = transitionPrivateCacheOwner(transientOffline.rememberedOwnerId, userA);
    const switchedUser = transitionPrivateCacheOwner(sameUser.rememberedOwnerId, userB);

    expect(restored).toEqual({ rememberedOwnerId: userA, shouldClear: false });
    expect(transientOffline).toEqual({ rememberedOwnerId: userA, shouldClear: false });
    expect(sameUser.shouldClear).toBe(false);
    expect(switchedUser).toEqual({ rememberedOwnerId: userB, shouldClear: true });
  });

  it('reads an account-scoped offline cache without invoking session refresh', async () => {
    const userA = '11111111-1111-4111-8111-111111111111';
    let sessionCalls = 0;
    const scope = await resolvePlanCacheScope(userA, async () => {
      sessionCalls += 1;
      throw new Error('network unavailable');
    });

    expect(scope).toBe(userA);
    expect(sessionCalls).toBe(0);
  });

  it('routes private btmedia plan references through the mobile resolver', () => {
    expect(isResolvablePlanUri('btmedia://33333333-3333-4333-8333-333333333333')).toBe(true);
    expect(isResolvablePlanUri('https://storage.example/plan.pdf')).toBe(true);
    expect(isResolvablePlanUri('file:///private/user-a/plan.pdf')).toBe(false);
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
    expect(planCache).not.toContain('void ensurePlanCachedForScope(scope, remoteUrl, resolvedUri)');
    expect(planCache).toContain('const existing = inFlightDownloads.get(inFlightKey)');
  });

  it('warms PDF.js before auth and makes active chantier plans durable in background', () => {
    const appContext = read('context/AppContext.tsx');
    const rootLayout = read('app/_layout.tsx');
    const media = read('lib/media.ts');
    const pdfJsAsset = read('lib/pdfjsAsset.ts');
    const viewer = read('components/PdfPlanViewer.tsx');

    expect(rootLayout).toContain('void loadBundledPdfJsSources()');
    expect(appContext).not.toContain("from '@/lib/pdfjsAsset'");
    expect(appContext).toContain("resolveMediaRefs(refs.slice(0, 6), { cacheDisk: false })");
    expect(appContext).toContain("syncPlansForOffline(refs, { concurrency: 1 })");
    expect(appContext).toContain('authH.isSessionValidationPending');
    expect(pdfJsAsset).toContain('getLoadedBundledPdfJsSources');
    expect(viewer).toContain('getLoadedBundledPdfJsSources()');
    expect(viewer).toContain('isResolvablePlanUri(planUri)');
    expect(media).toContain('resolveMediaRefsWithSession([ref], session, options)');
    expect(media).toContain('{ userId: offlineMediaUserId, token: null }');
    expect(media).toContain('if (local[ref]) return local[ref]');
    expect(media).not.toContain('resolveMediaRefs([ref], options)');
  });

  it('serializes manifest writes and prioritizes the active plan before neighbours', () => {
    const planCache = read('lib/planCache.ts');
    const plansScreen = read('app/(tabs)/plans.tsx');

    expect(planCache).toContain('const manifestMutationQueues');
    expect(planCache).toContain('await mutateManifest(scope');
    expect(plansScreen).toContain('await waitForActivePlanReady()');
    expect(plansScreen).toContain('await ensurePlanCached(activePlanUri)');
    expect(plansScreen).toContain('for (const plan of adjacentPlans)');
  });
});
