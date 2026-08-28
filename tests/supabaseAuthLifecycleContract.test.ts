import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const supabaseSource = readFileSync(
  fileURLToPath(new URL('../lib/supabase.ts', import.meta.url).href),
  'utf8',
);
const offlineCacheSource = readFileSync(
  fileURLToPath(new URL('../lib/offlineCache.ts', import.meta.url).href),
  'utf8',
);

describe('Supabase cold-start performance contract', () => {
  it('does not restart auto-refresh on a redundant initial active event', () => {
    const listener = supabaseSource.indexOf("AppState.addEventListener('change'");
    const previousState = supabaseSource.indexOf(
      'const previousState = previousAuthAppState;',
      listener,
    );
    const redundantActiveGuard = supabaseSource.indexOf(
      "if (previousState === 'active') return;",
      previousState,
    );
    const start = supabaseSource.indexOf('auth?.startAutoRefresh?.();', redundantActiveGuard);

    expect(listener).toBeGreaterThan(-1);
    expect(previousState).toBeGreaterThan(listener);
    expect(redundantActiveGuard).toBeGreaterThan(previousState);
    expect(start).toBeGreaterThan(redundantActiveGuard);
    expect(supabaseSource).not.toContain(
      'try { (supabase as any).auth?.startAutoRefresh?.(); } catch {}',
    );
  });

  it('gives supabase-js one bounded initialization owner before raw refresh', () => {
    const grace = offlineCacheSource.indexOf('SESSION_INITIALIZATION_GRACE_MS');
    const client = offlineCacheSource.indexOf('getClientSessionWithin(initializationTimeout)');
    const raw = offlineCacheSource.indexOf('const newToken = await forceRefreshSession();', client);

    expect(grace).toBeGreaterThan(-1);
    expect(client).toBeGreaterThan(grace);
    expect(raw).toBeGreaterThan(client);
  });
});
