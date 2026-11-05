import webPush, { type PushSubscription } from 'web-push';
import { createHash, createECDH } from 'node:crypto';

const endpointPaths: Record<string, string> = {
  'fcm.googleapis.com': '/fcm/send/',
  'updates.push.services.mozilla.com': '/wpush/',
  'web.push.apple.com': '/',
  'wns2-par02p.notify.windows.com': '/',
};

export function browserPushEndpoint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const expectedPath = Object.hasOwn(endpointPaths, url.hostname) ? endpointPaths[url.hostname] : null;
    const windows = /^wns[0-9]+-[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
    if (!(expectedPath && url.pathname.startsWith(expectedPath)) && !windows) return null;
    return url.href;
  } catch { return null; }
}

export function parseBrowserPushSubscription(value: unknown): PushSubscription | null {
  const input = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  const endpoint = browserPushEndpoint(input?.endpoint);
  const publicKey = input?.keys?.p256dh;
  const auth = input?.keys?.auth;
  if (!endpoint || typeof publicKey !== 'string' || typeof auth !== 'string'
    || !/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) return null;
  if (Buffer.from(publicKey, 'base64url')[0] !== 4) return null;
  return { endpoint, keys: { p256dh: publicKey, auth } };
}

export function browserPushEndpointHash(endpoint: string) {
  return createHash('sha256').update(endpoint).digest('hex');
}

export function browserPushVapid() {
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT || 'https://buildtrack-mobile.vercel.app';
  if (!privateKey || !/^[A-Za-z0-9_-]{43}$/.test(privateKey)) return null;
  try {
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    return { publicKey: curve.getPublicKey().toString('base64url'), privateKey, subject };
  } catch { return null; }
}

export async function deliverBrowserPush(supabase: any, organizationId: string, recipients: string[], notice: { body: string; href: string }) {
  const vapidDetails = browserPushVapid();
  const stats = { webSent: 0, webExpired: 0 };
  if (!vapidDetails || !recipients.length) return stats;
  for (let offset = 0; offset < recipients.length; offset += 100) {
    const { data: rows, error } = await supabase.from('web_push_subscriptions')
      .select('endpoint_hash,subscription,updated_at').eq('organization_id', organizationId).in('user_id', recipients.slice(offset, offset + 100));
    if (error) throw error;
    for (let start = 0; start < (rows?.length ?? 0); start += 20) {
      await Promise.all(rows.slice(start, start + 20).map(async (row: any) => {
        const subscription = parseBrowserPushSubscription(row.subscription);
        if (!subscription) return;
        try {
          await webPush.sendNotification(subscription, JSON.stringify(notice), { vapidDetails, TTL: 3600, timeout: 3000 });
          stats.webSent++;
        } catch (cause) {
          const statusCode = (cause as { statusCode?: number } | null)?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            const { error: removeError } = await supabase.from('web_push_subscriptions').delete()
              .eq('endpoint_hash', row.endpoint_hash).eq('organization_id', organizationId).eq('updated_at', row.updated_at);
            if (!removeError) stats.webExpired++;
          }
        }
      }));
    }
  }
  return stats;
}
