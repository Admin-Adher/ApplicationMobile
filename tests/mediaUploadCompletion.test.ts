import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  head: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  ready: vi.fn(),
}));

vi.mock('@/lib/server-auth', () => ({
  authenticateRequest: mocks.authenticate,
  enforcePrivateMediaClient: async () => ({ allowed: true }),
}));
vi.mock('@/lib/r2', () => ({ headR2Object: mocks.head }));
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit: () => ({ allowed: true }) }));

// The route is type-checked separately with the Next.js path aliases.
const { POST } = await vi.importActual<{ POST: (request: Request) => Promise<Response> }>(
  '../vercel-app/app/api/storage/complete/route',
);

const assetId = '00000000-0000-4000-8000-000000000001';
const owner = 'owner-1';
const asset = { owner_user_id: owner, provider: 'r2', object_key: 'object-key' };
const complete = () => POST(new Request('http://localhost/api/storage/complete', {
  method: 'POST',
  body: JSON.stringify({ assetId }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({
    authority: { userId: owner },
    supabase: { rpc: mocks.rpc, from: mocks.from },
  });
  mocks.head.mockResolvedValue({ ok: true, size: 120 });
  mocks.rpc.mockResolvedValueOnce({ data: [asset] }).mockResolvedValueOnce({ data: false });
  const builder = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: mocks.ready };
  mocks.from.mockReturnValue(builder);
});

describe('private media confirmation', () => {
  it('accepts a replay only if the owner’s asset is already ready', async () => {
    mocks.ready.mockResolvedValue({ data: { id: assetId } });

    const response = await complete();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, mediaRef: `btmedia://${assetId}` });
    expect(mocks.rpc).toHaveBeenLastCalledWith('server_complete_media_upload', expect.objectContaining({
      p_user_id: owner, p_asset_id: assetId, p_actual_size: 120,
    }));
    const lookup = mocks.from.mock.results[0].value;
    expect(lookup.eq.mock.calls).toEqual([['id', assetId], ['owner_user_id', owner], ['status', 'ready']]);
  });

  it('rejects a reservation which has not been confirmed', async () => {
    mocks.ready.mockResolvedValue({ data: null });
    expect((await complete()).status).toBe(409);
  });

  it.each([[404, 409], [503, 503]])('maps R2 status %i to HTTP %i', async (status, expected) => {
    mocks.head.mockResolvedValue({ ok: false, status });
    expect((await complete()).status).toBe(expected);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
