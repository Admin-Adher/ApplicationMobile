import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadLocalPhotosInPayload } from '../lib/storage';

const nativeUpload = vi.hoisted(() => vi.fn());
const fetchMock = vi.fn<typeof fetch>();
const uri = 'file:///photos/reserve.jpg';
const assetId = '00000000-0000-4000-8000-000000000001';
const mediaRef = `btmedia://${assetId}`;
const uploadUrl = 'https://r2.example.test/photo';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  getInfoAsync: async () => ({ exists: true, size: 120 }),
  createUploadTask: nativeUpload,
}));
vi.mock('../lib/clientVersion', () => ({ privateMediaClientHeaders: () => ({}) }));
vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  SUPABASE_URL: 'https://db.example.test',
  SUPABASE_KEY: 'publishable-key',
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'user-token' } } }) } },
}));

const payload = { photo_uri: uri, photos: [{ uri }] };
const reserveResponse = () => Response.json({
  provider: 'r2', assetId, mediaRef, uploadUrl, bucket: 'photos', objectKey: 'org/photo/id/photo.jpg',
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  nativeUpload.mockReset();
  nativeUpload.mockReturnValue({
    uploadAsync: async () => ({ status: 200 }),
    cancelAsync: async () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offline reserve media recovery', () => {
  it('retries a transient R2 error and a lost validation response using one reservation', async () => {
    nativeUpload.mockReturnValueOnce({
      uploadAsync: async () => { throw new Error('network interrupted'); },
      cancelAsync: async () => {},
    });
    fetchMock.mockResolvedValueOnce(reserveResponse())
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(Response.json({ ok: true, mediaRef }));

    const result = await uploadLocalPhotosInPayload('reserves', payload);

    expect(result).toMatchObject({ allOk: true, data: { photo_uri: mediaRef, photos: [{ uri: mediaRef }] } });
    expect(nativeUpload.mock.calls.map(call => call[0])).toEqual([uploadUrl, uploadUrl]);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/storage/presign', '/api/storage/complete', '/api/storage/complete',
    ]);
    expect(fetchMock.mock.calls.slice(1).map(call => JSON.parse(String(call[1]?.body)))).toEqual([
      { assetId }, { assetId },
    ]);
  });

  it('allows reservation responses that take longer than the former 10-second limit', async () => {
    fetchMock.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(reserveResponse()), 15_000)))
      .mockResolvedValueOnce(Response.json({ ok: true, mediaRef }));

    const sync = uploadLocalPhotosInPayload('reserves', payload);
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(sync).resolves.toMatchObject({ allOk: true });
  });

  it('does not replace the local file with a reference the server has not confirmed', async () => {
    fetchMock.mockResolvedValueOnce(reserveResponse())
      .mockResolvedValueOnce(new Response('<html>Captive portal</html>'))
      .mockResolvedValueOnce(Response.json({ ok: true, mediaRef: 'btmedia://another-asset' }));

    const result = await uploadLocalPhotosInPayload('reserves', payload);

    expect(result).toMatchObject({ allOk: false, data: payload });
    expect(result.uploadErrors[0]).toContain('Réponse de validation du média invalide');
    expect(nativeUpload).toHaveBeenCalledTimes(1);
  });

  it('keeps the local file and exposes an upgrade refusal without sending it to R2', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: 'android_build_upgrade_required' }, { status: 426 }));

    const result = await uploadLocalPhotosInPayload('reserves', payload);

    expect(result).toMatchObject({ allOk: false, data: payload });
    expect(result.uploadErrors[0]).toContain('Mise à jour de BuildTrack requise (HTTP 426)');
    expect(nativeUpload).not.toHaveBeenCalled();
  });

  it('does not retry a transfer after the sync pass is cancelled', async () => {
    const controller = new AbortController();
    const cancelAsync = vi.fn(async () => {});
    fetchMock.mockResolvedValueOnce(reserveResponse());
    nativeUpload.mockReturnValue({
      uploadAsync: () => new Promise(() => {}),
      cancelAsync,
    });

    const sync = uploadLocalPhotosInPayload('reserves', payload, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();

    const result = await sync;
    expect(result).toMatchObject({ allOk: false, data: payload });
    expect(result.uploadErrors[0]).toContain('Synchronisation du média interrompue');
    expect(nativeUpload).toHaveBeenCalledTimes(1);
    expect(cancelAsync).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
