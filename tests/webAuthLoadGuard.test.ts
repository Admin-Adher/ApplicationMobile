import { describe, expect, it } from 'vitest';
import { createAuthScopedLoadGuard } from '../vercel-app/lib/auth-load-guard';
import { createWebT } from '../vercel-app/lib/i18n';

describe('web authenticated workspace load guard', () => {
  it('invalidates a pending load as soon as the user signs out', () => {
    const guard = createAuthScopedLoadGuard();
    guard.setAuthenticatedUser('user-a');
    const load = guard.begin('user-a');

    guard.setAuthenticatedUser(null);

    expect(load.isCurrent()).toBe(false);
  });

  it('prevents data from a previous account being committed after an account switch', () => {
    const guard = createAuthScopedLoadGuard();
    guard.setAuthenticatedUser('user-a');
    const previousAccountLoad = guard.begin('user-a');

    guard.setAuthenticatedUser('user-b');
    const currentAccountLoad = guard.begin('user-b');

    expect(previousAccountLoad.isCurrent()).toBe(false);
    expect(currentAccountLoad.isCurrent()).toBe(true);
  });

  it('keeps a current load valid when Supabase refreshes the same user session', () => {
    const guard = createAuthScopedLoadGuard();
    guard.setAuthenticatedUser('user-a');
    const load = guard.begin('user-a');

    guard.setAuthenticatedUser('user-a');

    expect(load.isCurrent()).toBe(true);
  });

  it('lets a newer synchronization supersede an older one', () => {
    const guard = createAuthScopedLoadGuard();
    guard.setAuthenticatedUser('user-a');
    const olderLoad = guard.begin('user-a');
    const newerLoad = guard.begin('user-a');

    expect(olderLoad.isCurrent()).toBe(false);
    expect(newerLoad.isCurrent()).toBe(true);
  });

  it.each([
    ['fr', 'Synchronisation partielle', 'mouvements de stock'],
    ['en', 'Partial sync', 'inventory movements'],
    ['es', 'Sincronización parcial', 'movimientos de stock'],
  ] as const)('localizes partial-load feedback in %s', (language, heading, tableLabel) => {
    const t = createWebT(language);
    const message = t('sync.partialLoad', {
      tables: t('sync.table.inventory_movements'),
    });

    expect(message).toContain(heading);
    expect(message).toContain(tableLabel);
  });
});
