import { createECDH, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserPushEndpoint, browserPushEndpointHash, browserPushVapid, parseBrowserPushSubscription } from '../vercel-app/lib/web-push';

describe('browser push subscription validation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('accepts only browser push providers and rejects credential, port and hostname tricks', () => {
    expect(browserPushEndpoint('https://fcm.googleapis.com/fcm/send/example')).toBe('https://fcm.googleapis.com/fcm/send/example');
    expect(browserPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/example')).not.toBeNull();
    for (const url of ['http://fcm.googleapis.com/fcm/send/example', 'https://fcm.googleapis.com:444/fcm/send/example',
      'https://fcm.googleapis.com.example.org/fcm/send/example', 'https://fcm.googleapis.com@127.0.0.1/fcm/send/example',
      'https://fcm.googleapis.com/path', 'https://user@web.push.apple.com/path']) expect(browserPushEndpoint(url)).toBeNull();
  });

  it('validates browser key lengths and derives the public VAPID key from the server secret', () => {
    const curve = createECDH('prime256v1');
    curve.generateKeys();
    const privateKey = curve.getPrivateKey();
    vi.stubEnv('WEB_PUSH_VAPID_PRIVATE_KEY', Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]).toString('base64url'));
    const endpoint = 'https://fcm.googleapis.com/fcm/send/example';
    const keys = { p256dh: curve.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
    expect(browserPushVapid()?.publicKey).toBe(keys.p256dh);
    expect(parseBrowserPushSubscription({ endpoint, keys })).toEqual({ endpoint, keys });
    expect(parseBrowserPushSubscription({ endpoint, keys: { ...keys, auth: 'short' } })).toBeNull();
    expect(browserPushEndpointHash(endpoint)).toMatch(/^[a-f0-9]{64}$/);
  });
});
