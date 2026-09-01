import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  forceRefreshSession: vi.fn(),
  getSession: vi.fn(),
  getSessionFromStorage: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
  isSupabaseConfigured: true,
  SUPABASE_KEY: 'publishable-key',
  SUPABASE_URL: 'https://example.supabase.co',
}));

vi.mock('../lib/offlineCache', () => ({
  forceRefreshSession: mocks.forceRefreshSession,
  getSessionFromStorage: mocks.getSessionFromStorage,
}));

import {
  clearSupabaseRestTokenCache,
  getSupabaseAuthenticatedSession,
} from '../lib/supabaseRest';

const freshExpiry = () => Math.floor(Date.now() / 1_000) + 3_600;

beforeEach(() => {
  vi.clearAllMocks();
  clearSupabaseRestTokenCache();
  mocks.forceRefreshSession.mockResolvedValue(null);
  mocks.getSession.mockResolvedValue({ data: { session: null } });
  mocks.getSessionFromStorage.mockResolvedValue(null);
});

describe('strict authenticated Supabase session', () => {
  it('uses a fresh persisted user token without waiting for the SDK lock', async () => {
    mocks.getSessionFromStorage.mockResolvedValue({
      access_token: 'user-token',
      expires_at: freshExpiry(),
      user: { id: '11111111-1111-4111-8111-111111111111' },
    });

    await expect(getSupabaseAuthenticatedSession()).resolves.toMatchObject({
      accessToken: 'user-token',
      userId: '11111111-1111-4111-8111-111111111111',
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.forceRefreshSession).not.toHaveBeenCalled();
  });

  it('never treats the publishable key as a private user session', async () => {
    mocks.getSessionFromStorage.mockResolvedValue({
      access_token: 'publishable-key',
      expires_at: freshExpiry(),
      user: { id: '11111111-1111-4111-8111-111111111111' },
    });

    await expect(getSupabaseAuthenticatedSession()).resolves.toBeNull();
  });

  it('shares one persisted-session read across a concurrent image burst', async () => {
    let resolveStorage!: (value: any) => void;
    mocks.getSessionFromStorage.mockImplementation(() => (
      new Promise(resolve => { resolveStorage = resolve; })
    ));

    const first = getSupabaseAuthenticatedSession();
    const second = getSupabaseAuthenticatedSession();
    expect(second).toBe(first);
    resolveStorage({
      access_token: 'user-token',
      expires_at: freshExpiry(),
      user: { id: '11111111-1111-4111-8111-111111111111' },
    });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(mocks.getSessionFromStorage).toHaveBeenCalledTimes(1);
  });

  it('cannot restore an old account from a session read completed after logout', async () => {
    let resolveOldStorage!: (value: any) => void;
    mocks.getSessionFromStorage.mockImplementationOnce(() => (
      new Promise(resolve => { resolveOldStorage = resolve; })
    ));

    const staleRead = getSupabaseAuthenticatedSession();
    clearSupabaseRestTokenCache();
    resolveOldStorage({
      access_token: 'old-account-token',
      expires_at: freshExpiry(),
      user: { id: '11111111-1111-4111-8111-111111111111' },
    });

    await expect(staleRead).resolves.toBeNull();

    mocks.getSessionFromStorage.mockResolvedValue({
      access_token: 'new-account-token',
      expires_at: freshExpiry(),
      user: { id: '22222222-2222-4222-8222-222222222222' },
    });
    await expect(getSupabaseAuthenticatedSession()).resolves.toMatchObject({
      accessToken: 'new-account-token',
      userId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('force-refreshes a locally fresh token after an endpoint 401', async () => {
    const stale = {
      access_token: 'stale-token',
      refresh_token: 'refresh-token',
      expires_at: freshExpiry(),
      user: { id: '11111111-1111-4111-8111-111111111111' },
    };
    const fresh = { ...stale, access_token: 'fresh-token' };
    mocks.getSessionFromStorage
      .mockResolvedValueOnce(stale)
      .mockResolvedValue(fresh);
    mocks.forceRefreshSession.mockResolvedValue('fresh-token');

    await expect(getSupabaseAuthenticatedSession({ forceRefresh: true })).resolves.toMatchObject({
      accessToken: 'fresh-token',
      userId: stale.user.id,
    });
    expect(mocks.forceRefreshSession).toHaveBeenCalledTimes(1);
  });
});
