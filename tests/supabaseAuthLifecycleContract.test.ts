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
const authContextSource = readFileSync(
  fileURLToPath(new URL('../context/AuthContext.tsx', import.meta.url).href),
  'utf8',
);
const appContextSource = readFileSync(
  fileURLToPath(new URL('../context/AppContext.tsx', import.meta.url).href),
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

  it('returns from auth listeners before starting Supabase-backed profile work', () => {
    expect(authContextSource).not.toMatch(/onAuthStateChange\s*\(\s*async\s*\(/);
    expect(appContextSource).not.toMatch(/onAuthStateChange\s*\(\s*async\s*\(/);

    const authListener = authContextSource.indexOf('supabase.auth.onAuthStateChange((_event');
    const authDeferral = authContextSource.indexOf('deferAuthWork(() => processAuthStateChange', authListener);
    const appListener = appContextSource.indexOf('supabase.auth.onAuthStateChange((event, session)');
    const appDeferral = appContextSource.indexOf('deferAuthWork(async () => {', appListener);
    const appProfileRead = appContextSource.indexOf(".from('profiles').select('last_read_by_channel')", appDeferral);

    expect(authListener).toBeGreaterThan(-1);
    expect(authDeferral).toBeGreaterThan(authListener);
    expect(appListener).toBeGreaterThan(-1);
    expect(appDeferral).toBeGreaterThan(appListener);
    expect(appProfileRead).toBeGreaterThan(appDeferral);
  });

  it('coalesces native client session reads and primes them from auth events', () => {
    const coordinator = supabaseSource.indexOf('createSupabaseSessionReadCoordinator<any, any>');
    const nativeGuard = supabaseSource.indexOf("configuredSupabase && Platform.OS !== 'web'");
    const assignment = supabaseSource.indexOf('auth.getSession = sessionReadCoordinator.getSession');
    const authListener = authContextSource.indexOf('supabase.auth.onAuthStateChange((_event');
    const prime = authContextSource.indexOf('primeSupabaseSessionReadCache(session ?? null)', authListener);
    const deferredProfile = authContextSource.indexOf('deferAuthWork(() => processAuthStateChange', prime);

    expect(coordinator).toBeGreaterThan(-1);
    expect(nativeGuard).toBeGreaterThan(coordinator);
    expect(assignment).toBeGreaterThan(nativeGuard);
    expect(authListener).toBeGreaterThan(-1);
    expect(prime).toBeGreaterThan(authListener);
    expect(deferredProfile).toBeGreaterThan(prime);
  });
});
