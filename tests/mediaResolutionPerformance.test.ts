import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clearToken: vi.fn(),
  downloadAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  getSession: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  deleteAsync: mocks.deleteAsync,
  downloadAsync: mocks.downloadAsync,
  getInfoAsync: mocks.getInfoAsync,
  makeDirectoryAsync: mocks.makeDirectoryAsync,
}));
vi.mock('../lib/apiBase', () => ({
  canonicalApiBaseUrl: () => 'https://buildtrack.example',
}));
vi.mock('../lib/clientVersion', () => ({
  privateMediaClientHeaders: () => ({ 'X-BuildTrack-Client': 'test' }),
}));
vi.mock('../lib/supabaseRest', () => ({
  clearSupabaseRestTokenCache: mocks.clearToken,
  getSupabaseAuthenticatedSession: mocks.getSession,
}));

import {
  clearMediaUrlCache,
  resolveMediaRefOrThrow,
  setMediaCacheUserId,
} from '../lib/media';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REF_A = 'btmedia://aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REF_B = 'btmedia://bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function response(status: number, assets: unknown[] = []) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ assets }),
  } as Response;
}

function asset(ref: string) {
  return {
    ref,
    assetId: ref.slice('btmedia://'.length),
    url: `https://signed.example/${ref.slice(-4)}`,
    expiresAt: Date.now() + 300_000,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearMediaUrlCache();
  setMediaCacheUserId(USER_ID);
  mocks.getInfoAsync.mockResolvedValue({ exists: false });
  mocks.makeDirectoryAsync.mockResolvedValue(undefined);
  mocks.deleteAsync.mockResolvedValue(undefined);
  mocks.downloadAsync.mockResolvedValue({ status: 200, uri: 'file:///cache/media' });
  mocks.getSession.mockResolvedValue({
    accessToken: 'user-token',
    expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    userId: USER_ID,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('private media resolution performance and isolation', () => {
  it('resolves visible thumbnails in one POST and does not block on disk download', async () => {
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requestInit = init;
      return response(200, [asset(REF_A), asset(REF_B)]);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = resolveMediaRefOrThrow(REF_A, { cacheDisk: true });
    const second = resolveMediaRefOrThrow(REF_B, { cacheDisk: true });
    await vi.advanceTimersByTimeAsync(20);

    await expect(Promise.all([first, second])).resolves.toEqual([
      'https://signed.example/aaaa',
      'https://signed.example/bbbb',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(requestInit?.body)).refs).toEqual([REF_A, REF_B]);
    expect(mocks.downloadAsync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500);
    await vi.runAllTimersAsync();
    expect(mocks.downloadAsync).toHaveBeenCalledTimes(2);
  });

  it('refreshes once and replays the batch after a 401', async () => {
    mocks.getSession
      .mockResolvedValueOnce({
        accessToken: 'stale-token',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        userId: USER_ID,
      })
      .mockResolvedValueOnce({
        accessToken: 'fresh-token',
        expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
        userId: USER_ID,
      });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(response(200, [asset(REF_A)]));
    vi.stubGlobal('fetch', fetchMock);

    const request = resolveMediaRefOrThrow(REF_A, { cacheDisk: false });
    await vi.advanceTimersByTimeAsync(20);

    await expect(request).resolves.toBe('https://signed.example/aaaa');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.clearToken).toHaveBeenCalledTimes(1);
    expect(mocks.getSession).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it('refuses to resolve cached-profile media through another account', async () => {
    mocks.getSession.mockResolvedValue({
      accessToken: 'other-token',
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      userId: '22222222-2222-4222-8222-222222222222',
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const request = resolveMediaRefOrThrow(REF_A, { cacheDisk: false });
    const rejection = expect(request).rejects.toMatchObject({
      code: 'account_changed',
    });
    await vi.advanceTimersByTimeAsync(20);

    await rejection;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a terminal not_found error for an omitted asset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, [])));
    const request = resolveMediaRefOrThrow(REF_A, { cacheDisk: false });
    const rejection = expect(request).rejects.toMatchObject({
      code: 'not_found',
      retryable: false,
    });
    await vi.advanceTimersByTimeAsync(20);

    await rejection;
  });
});
