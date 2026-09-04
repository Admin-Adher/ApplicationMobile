import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueInvitation, enqueueRecovery, processEmailJobs, type EmailJob } from '../vercel-app/lib/email-outbox';
import { decryptEmailPayload, encryptEmailPayload } from '../vercel-app/lib/email-outbox-crypto';
import type { SendEmailResult } from '../vercel-app/lib/sender';

type SupabaseClient = NonNullable<Parameters<typeof processEmailJobs>[1]>;

const email = 'person@example.test';
beforeEach(() => {
  vi.stubEnv('SMTP_HOST', ''); vi.stubEnv('GMAIL_USER', 'sender@example.test'); vi.stubEnv('GMAIL_APP_PASSWORD', 'test');
  vi.stubEnv('EMAIL_OUTBOX_SECRET', 'test-only-secret-not-a-real-key-000000000000');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function workerDatabase(payload: Record<string, unknown>, attempts = 1) {
  const job: EmailJob = { id: 'job-a', kind: 'recovery', organization_id: null,
    encrypted_payload: encryptEmailPayload('job-a', payload), attempts,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), lease_until: new Date(Date.now() + 90_000).toISOString() };
  const writes: Record<string, unknown>[] = [];
  const filters: unknown[][] = [];
  const generateLink = vi.fn().mockResolvedValue({ data: { properties: { hashed_token: 'a'.repeat(64) } }, error: null });
  const chain = {
    update: (value: Record<string, unknown>) => { writes.push(value); return chain; },
    select: () => chain, limit: () => chain,
    eq: (...value: unknown[]) => { filters.push(value); return chain; },
    maybeSingle: async () => ({ data: { id: 'job-a' }, error: null }),
  };
  const db = { rpc: vi.fn().mockResolvedValue({ data: [job], error: null }), from: vi.fn(() => chain), auth: { admin: { generateLink } } };
  return { db: db as unknown as SupabaseClient, job, writes, filters, generateLink };
}

describe('durable transactional outbox', () => {
  it('acknowledges persistence without looking up accounts in the public request', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'persisted-id' }, error: null });
    const db = { rpc } as unknown as SupabaseClient;
    expect(await enqueueRecovery(email, 'fr', '192.0.2.1', db)).toBe('persisted-id');
    const args = rpc.mock.calls[0][1];
    expect(JSON.stringify(args)).not.toContain(email);
    expect(JSON.stringify(args)).not.toContain('192.0.2.1');
    expect(decryptEmailPayload(args.p_id, args.p_encrypted_payload)).toEqual({ kind: 'recovery', email, language: 'fr' });
  });
  it.each([['PT429', 429], ['PGRST202', 503]])('surfaces queue/rate-limit failure %s', async (code, status) => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }) } as unknown as SupabaseClient;
    await expect(enqueueRecovery(email, 'fr', '192.0.2.1', db)).rejects.toMatchObject({ status });
  });
  it('persists the generated recovery token before SMTP submission', async () => {
    const mock = workerDatabase({ kind: 'recovery', email, language: 'fr' });
    const deliver = vi.fn(async (): Promise<SendEmailResult> => {
      expect(mock.writes[0].status).toBe('sending');
      expect(mock.writes[0].encrypted_payload).toBeTruthy();
      return { success: true, status: 'accepted', messageId: 'receipt', requestId: 'job-a' };
    });
    await processEmailJobs('job-a', mock.db, deliver);
    expect(mock.generateLink).toHaveBeenCalledOnce();
    expect(mock.writes[1]).toMatchObject({ status: 'accepted', encrypted_payload: null, provider_message_id: 'receipt' });
    expect(mock.filters).toContainEqual(['attempts', 1]);
    expect(mock.filters).toContainEqual(['lease_until', mock.job.lease_until]);
  });
  it('retries a transient rejection with the same prepared token', async () => {
    const prepared = { to: email, subject: 'reset', html: '<p>same-token</p>' };
    const mock = workerDatabase({ kind: 'recovery', email, language: 'fr', prepared });
    await processEmailJobs('job-a', mock.db, async () => ({ success: false, error: 'safe', code: 'smtp_unavailable', retryable: true, requestId: 'job-a' }));
    expect(mock.generateLink).not.toHaveBeenCalled();
    expect(mock.writes[1].status).toBe('pending');
    expect(decryptEmailPayload<{ prepared: unknown }>('job-a', String(mock.writes[1].encrypted_payload)).prepared).toEqual(prepared);
  });
  it.each([
    ['delivery_uncertain', false, 1, 'uncertain'],
    ['recipient_rejected', false, 1, 'failed'],
    ['smtp_unavailable', true, 4, 'failed'],
  ] as const)('does not blindly retry %s on attempt %s', async (code, retryable, attempt, status) => {
    const mock = workerDatabase({ kind: 'recovery', email, language: 'fr', prepared: { to: email, subject: 'reset', html: 'test' } }, attempt);
    await processEmailJobs('job-a', mock.db, async () => ({ success: false, error: 'safe', code, retryable, requestId: 'job-a' }));
    expect(mock.writes[1]).toMatchObject({ status, encrypted_payload: null, lease_until: null });
  });
  it('suppresses an unknown account without calling SMTP', async () => {
    const mock = workerDatabase({ kind: 'recovery', email, language: 'fr' });
    mock.generateLink.mockResolvedValue({ data: null, error: { code: 'user_not_found' } } as never);
    const deliver = vi.fn();
    await processEmailJobs('job-a', mock.db, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(mock.writes[0]).toMatchObject({ status: 'suppressed', encrypted_payload: null });
  });
  it('rejects invitation emails unless the exact token, recipient and organization match', async () => {
    const filters: unknown[][] = [];
    const chain = { select: () => chain, eq: (...args: unknown[]) => { filters.push(args); return chain; },
      maybeSingle: async () => ({ data: null, error: null }) };
    const rpc = vi.fn();
    const db = { from: () => chain, rpc } as unknown as SupabaseClient;
    await expect(enqueueInvitation({ email, token: 'wrong-token' }, { userId: 'actor', organizationId: 'org-a', isPlatformAdmin: false }, db)).rejects.toMatchObject({ status: 403 });
    expect(filters).toContainEqual(['token', 'wrong-token']);
    expect(filters).toContainEqual(['organization_id', 'org-a']);
    expect(rpc).not.toHaveBeenCalled();
  });
});
