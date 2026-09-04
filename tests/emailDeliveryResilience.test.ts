import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyEmailFailure, emailConfiguration, normalizeEmail, sendEmail } from '../vercel-app/lib/sender';
import { decryptEmailPayload, emailFingerprint, emailOutboxReady, encryptEmailPayload } from '../vercel-app/lib/email-outbox-crypto';
import { readRecoveryToken, recoveryUrl } from '../vercel-app/lib/recovery-link';

const email = 'recipient@example.test';
const message = { to: email, subject: 'BuildTrack test', html: '<p>Test <a href="https://example.test/reset">reset</a></p>' };
type TransportFactory = NonNullable<Parameters<typeof sendEmail>[1]>;

beforeEach(() => {
  for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_PORT', 'EMAIL_FROM', 'RESERVE_TOKEN_SECRET']) vi.stubEnv(name, '');
  vi.stubEnv('GMAIL_USER', 'sender@example.test');
  vi.stubEnv('GMAIL_APP_PASSWORD', 'test-password');
  vi.stubEnv('EMAIL_OUTBOX_SECRET', 'test-only-secret-not-a-real-key-000000000000');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('transactional SMTP delivery', () => {
  it('fails closed when credentials are missing or redacted', async () => {
    const factory = vi.fn();
    vi.stubEnv('GMAIL_APP_PASSWORD', '');
    expect(await sendEmail(message, factory as TransportFactory)).toMatchObject({ success: false, code: 'email_not_configured' });
    vi.stubEnv('GMAIL_APP_PASSWORD', '[SENSITIVE]');
    expect(emailConfiguration().ready).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });
  it('requires a complete custom SMTP configuration and TLS', () => {
    vi.stubEnv('SMTP_HOST', 'smtp.example.test');
    expect(emailConfiguration().ready).toBe(false);
    vi.stubEnv('SMTP_USER', 'user'); vi.stubEnv('SMTP_PASSWORD', 'pass'); vi.stubEnv('EMAIL_FROM', 'BuildTrack <mail@example.test>');
    expect(emailConfiguration()).toMatchObject({ ready: true, options: { requireTLS: true, secure: false, port: 587 } });
    vi.stubEnv('SMTP_PORT', '0'); expect(emailConfiguration().ready).toBe(false);
  });
  it.each(['', 'person', 'a@example.test,b@example.test', 'a@example.test\r\nBcc:b@example.test', 'Display <a@example.test>', null])('rejects an invalid mailbox %s', value => {
    expect(normalizeEmail(value)).toBeNull();
  });
  it('normalizes a single mailbox', () => expect(normalizeEmail(' Person@Example.test ')).toBe('person@example.test'));
  it('records SMTP acceptance, includes plain text, and closes the transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: [email], rejected: [], messageId: '<test-id@example.test>' });
    const close = vi.fn();
    const result = await sendEmail(message, (() => ({ sendMail, close })) as unknown as TransportFactory);
    expect(result).toMatchObject({ success: true, status: 'accepted', messageId: '<test-id@example.test>' });
    expect(sendMail.mock.calls[0][0].text).toContain('https://example.test/reset');
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    [{ accepted: [], rejected: [email], messageId: 'id' }, 'recipient_rejected'],
    [{ accepted: [], rejected: [], messageId: 'id' }, 'recipient_rejected'],
    [{ accepted: [email], rejected: [] }, 'delivery_uncertain'],
  ])('does not infer successful delivery from an incomplete receipt', async (receipt, code) => {
    const factory = () => ({ sendMail: async () => receipt, close: vi.fn() });
    expect(await sendEmail(message, factory as unknown as TransportFactory)).toMatchObject({ success: false, code, retryable: false });
  });
  it.each([
    [{ code: 'EAUTH', responseCode: 535 }, 'smtp_auth_failed', false],
    [{ code: 'ETIMEDOUT', command: 'CONN' }, 'smtp_unavailable', true],
    [{ command: 'DATA', responseCode: 451 }, 'smtp_unavailable', true],
    [{ command: 'DATA', code: 'ETIMEDOUT' }, 'delivery_uncertain', false],
    [{ responseCode: 550 }, 'recipient_rejected', false],
    [null, 'delivery_uncertain', false],
  ])('classifies rejection vs ambiguous submission', (error, code, retryable) => {
    expect(classifyEmailFailure(error)).toEqual({ code, retryable });
  });
  it('never logs recipient, subject, or raw SMTP errors', async () => {
    const factory = () => ({ sendMail: async () => { throw { command: 'DATA', message: `secret for ${email}` }; }, close: vi.fn() });
    await sendEmail(message, factory as unknown as TransportFactory);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain(email);
    expect(logged).not.toContain(message.subject);
    expect(logged).not.toContain('secret for');
  });
});

describe('email payload confidentiality and recovery links', () => {
  it('encrypts with a fresh nonce and authenticates the request identity', () => {
    const payload = { email, token: 'private-recovery-token' };
    const first = encryptEmailPayload('job-a', payload);
    expect(first).not.toContain(email);
    expect(first).not.toContain(payload.token);
    expect(first).not.toBe(encryptEmailPayload('job-a', payload));
    expect(decryptEmailPayload('job-a', first)).toEqual(payload);
    expect(() => decryptEmailPayload('job-b', first)).toThrow();
    expect(() => decryptEmailPayload('job-a', first.replace(/^v1/, 'v2'))).toThrow();
  });
  it('fails closed without a sufficiently long encryption secret', () => {
    vi.stubEnv('EMAIL_OUTBOX_SECRET', 'short');
    expect(emailOutboxReady()).toBe(false);
    expect(() => encryptEmailPayload('job', {})).toThrow();
  });
  it('uses keyed hashes for rate limits instead of persisting recipient addresses', () => {
    expect(emailFingerprint(email)).toMatch(/^[a-f0-9]{64}$/);
    expect(emailFingerprint(email)).toBe(emailFingerprint(email));
    expect(emailFingerprint(email)).not.toBe(emailFingerprint('other@example.test'));
  });
  it('places the one-use hash in the fragment, not the HTTP query', () => {
    const hash = 'a'.repeat(64);
    const url = new URL(recoveryUrl(hash, 'fr'));
    expect(url.pathname).toBe('/reset-password');
    expect(url.searchParams.get('token_hash')).toBeNull();
    expect(readRecoveryToken(url.search, url.hash)).toBe(hash);
    expect(readRecoveryToken('', `#token_hash=${hash}&type=signup`)).toBeNull();
    expect(() => recoveryUrl('https://evil.example', 'fr')).toThrow();
  });
  it('never consumes a token on mount or reuses a stored application session', () => {
    const page = readFileSync(resolve(import.meta.dirname, '../vercel-app/app/reset-password/page.tsx'), 'utf8');
    const effect = page.slice(page.indexOf('useEffect(() =>'), page.indexOf('async function submitPassword'));
    expect(effect).not.toContain('verifyOtp(');
    expect(page).not.toContain('getSession()');
    expect(page).not.toContain('supabaseBrowser');
    expect(page).toContain('persistSession: false');
    expect(page).toContain('detectSessionInUrl: false');
  });
});
