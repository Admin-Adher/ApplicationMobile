import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconcileUserScopedCache } from '../lib/queryCacheHydration';
import { queryKeys } from '../lib/queryKeys';
import { publishWhenCurrent } from '../vercel-app/lib/progressive-workspace-load';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('document startup performance', () => {
  it('seeds an empty React Query value from the user-scoped offline cache', () => {
    const cached = [{ id: 'doc-a', name: 'Plan A' }];

    expect(reconcileUserScopedCache(cached, undefined)).toEqual(cached);
    expect(reconcileUserScopedCache(cached, [])).toEqual(cached);
  });

  it('removes rows that are absent from the current user cache', () => {
    const cached = [{ id: 'doc-a' }];
    const hydrated = [{ id: 'doc-a' }, { id: 'doc-from-another-account' }];

    expect(reconcileUserScopedCache(cached, hydrated)).toEqual([{ id: 'doc-a' }]);
    expect(reconcileUserScopedCache([], hydrated)).toEqual([]);
  });

  it('isolates document query data per user while retaining a broad invalidation prefix', () => {
    expect(queryKeys.documents('user-a')).toEqual(['documents', 'user-a']);
    expect(queryKeys.documents('user-b')).toEqual(['documents', 'user-b']);
    expect(queryKeys.documents()).toEqual(['documents']);
  });

  it('publishes progressive data only for the current authenticated load', async () => {
    let current = true;
    const published: string[] = [];

    await publishWhenCurrent(
      Promise.resolve('documents-ready'),
      { isCurrent: () => current },
      value => published.push(value),
    );
    current = false;
    await publishWhenCurrent(
      Promise.resolve('stale-documents'),
      { isCurrent: () => current },
      value => published.push(value),
    );

    expect(published).toEqual(['documents-ready']);
  });

  it('does not impose a cosmetic startup delay and keeps remote documents behind role validation', () => {
    const layout = read('app/_layout.tsx');
    const documentsHook = read('hooks/queries/useDocuments.ts');

    expect(layout).not.toContain('APP_STARTUP_SETTLE_MIN_MS');
    expect(documentsHook).not.toContain('useStartupDelay');
    expect(documentsHook).toContain('queryKeys.documents(userId)');
    expect(documentsHook).toContain('&& !isSessionValidationPending');
    expect(documentsHook).toContain("user?.role === 'magasinier' || user?.role === 'sous_traitant'");
  });

  it('reveals the web workspace after the authoritative profile and publishes documents progressively', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const profileCommit = page.indexOf('setProfile({ ...loadedProfile');
    const revealWorkspace = page.indexOf('setLoading(false);', profileCommit);
    const progressiveDocuments = page.indexOf('const documentsPromise = publishWhenCurrent', revealWorkspace);
    const coherentSnapshot = page.indexOf('] = await Promise.all([', progressiveDocuments);

    expect(profileCommit).toBeGreaterThan(-1);
    expect(revealWorkspace).toBeGreaterThan(profileCommit);
    expect(progressiveDocuments).toBeGreaterThan(revealWorkspace);
    expect(coherentSnapshot).toBeGreaterThan(progressiveDocuments);
    expect(page).toContain('Storage usage is informational and must never hold the workspace open.');
  });
});
