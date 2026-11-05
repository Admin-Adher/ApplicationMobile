import { describe, expect, it } from 'vitest';
import { openOrganizationWebhook, parseOrganizationWebhook, sealOrganizationWebhook } from '../vercel-app/lib/organization-webhook';
import { isWebNetworkFailure } from '../vercel-app/lib/web-outbox';

describe('terrain web and integration contracts', () => {
  it('only accepts the intended HTTPS automation endpoints', () => {
    const make = 'https://hook.eu1.make.com/abcdefghijklmnopqrstuvwxyz123456';
    const n8n = 'https://buildtrack-demo.app.n8n.cloud/webhook/abc123';
    expect(parseOrganizationWebhook(make)?.provider).toBe('make');
    expect(parseOrganizationWebhook(n8n)?.provider).toBe('n8n');
    for (const url of [
      make.replace('https:', 'http:'),
      make.replace('hook.eu1.make.com', 'hook.eu1.make.com.evil.invalid'),
      make.replace('hook.eu1.make.com', 'hook.eu1.make.com@evil.invalid'),
      'https://127.0.0.1/webhook/abc',
      'https://buildtrack-demo.app.n8n.cloud/rest/credentials',
    ]) expect(parseOrganizationWebhook(url)).toBeNull();
  });

  it('stores a credential encrypted and bound to its organization', () => {
    const url = 'https://hook.eu1.make.com/abcdefghijklmnopqrstuvwxyz123456';
    const sealed = sealOrganizationWebhook(url, 'org-a', 'secret');
    expect(sealed).not.toContain(url);
    expect(openOrganizationWebhook(sealed, 'org-a', 'secret')?.url).toBe(url);
    expect(openOrganizationWebhook(sealed, 'org-b', 'secret')).toBeNull();
    expect(openOrganizationWebhook(sealed, 'org-a', 'different-secret')).toBeNull();
  });

  it('retries connection failures while keeping permission errors visible', () => {
    expect(isWebNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isWebNetworkFailure({ status: 503, message: 'backend temporarily unavailable' })).toBe(true);
    expect(isWebNetworkFailure({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isWebNetworkFailure({ code: '23505', message: 'duplicate key' })).toBe(false);
  });
});
