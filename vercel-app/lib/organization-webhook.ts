import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export function parseOrganizationWebhook(value: unknown) {
  if (typeof value !== 'string' || value.length > 1500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) return null;
    const make = /^hook\.(?:eu[12]|us[12])\.make\.com$/.test(url.hostname)
      && /^\/[a-z0-9]{20,100}$/i.test(url.pathname);
    const n8n = /^[a-z0-9][a-z0-9-]*\.app\.n8n\.cloud$/.test(url.hostname)
      && /^\/webhook\/[a-z0-9_./%-]{1,500}$/i.test(url.pathname);
    if (!make && !n8n) return null;
    return { url: url.href, provider: make ? 'make' as const : 'n8n' as const };
  } catch {
    return null;
  }
}

function webhookKey(secret: string) {
  return createHmac('sha256', secret).update('buildtrack:organization-webhook:v1').digest();
}

export function sealOrganizationWebhook(url: string, organizationId: string, secret: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', webhookKey(secret), nonce);
  cipher.setAAD(Buffer.from(organizationId));
  const body = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), body].map(value => value.toString('base64url')).join('.');
}

export function openOrganizationWebhook(value: string, organizationId: string, secret: string) {
  try {
    const [nonce, tag, body, extra] = value.split('.');
    if (!nonce || !tag || !body || extra !== undefined) return null;
    const cipher = createDecipheriv('aes-256-gcm', webhookKey(secret), Buffer.from(nonce, 'base64url'));
    cipher.setAAD(Buffer.from(organizationId));
    cipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const url = Buffer.concat([cipher.update(Buffer.from(body, 'base64url')), cipher.final()]).toString('utf8');
    return parseOrganizationWebhook(url);
  } catch {
    return null;
  }
}
