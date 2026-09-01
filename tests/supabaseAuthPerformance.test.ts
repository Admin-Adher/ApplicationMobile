import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  resetAuthLock: vi.fn(),
  clearStoredAuth: vi.fn(),
  recovered: vi.fn(),
  expired: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
  isSupabaseConfigured: true,
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_KEY: 'publishable-key',
  resetAuthLock: authMocks.resetAuthLock,
  clearSupabaseStoredAuthCache: authMocks.clearStoredAuth,
}));

vi.mock('../lib/sessionExpiry', () => ({
  notifySessionExpired: authMocks.expired,
  notifySessionRecovered: authMocks.recovered,
}));

import { forceRefreshSession } from '../lib/offlineCache';

describe('Supabase auth performance guards', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('shares one raw refresh across concurrent data and queue wake-ups', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify({
      access_token: 'expired-access',
      refresh_token: 'refresh-1',
      expires_at: 1,
      user: { id: 'user-1' },
    }));
    vi.mocked(AsyncStorage.setItem).mockResolvedValue();

    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>(resolve => { resolveFetch = resolve; });
    const fetchMock = vi.fn(() => fetchPromise);
    globalThis.fetch = fetchMock as typeof fetch;

    const first = forceRefreshSession();
    const second = forceRefreshSession();
    await Promise.resolve();

    resolveFetch({
      ok: true,
      json: async () => ({
        access_token: 'fresh-access',
        refresh_token: 'refresh-2',
        expires_at: 4_000_000_000,
        user: { id: 'user-1' },
      }),
    } as Response);

    await expect(Promise.all([first, second])).resolves.toEqual([
      'fresh-access',
      'fresh-access',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(authMocks.clearStoredAuth).toHaveBeenCalledTimes(1);
    expect(authMocks.resetAuthLock).toHaveBeenCalledWith('raw session refresh persisted');
    expect(vi.mocked(AsyncStorage.setItem).mock.invocationCallOrder[0]).toBeLessThan(
      authMocks.recovered.mock.invocationCallOrder[0],
    );
  });
});
