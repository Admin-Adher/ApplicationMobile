import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

function secret() {
  const value = process.env.EMAIL_OUTBOX_SECRET || process.env.RESERVE_TOKEN_SECRET || '';
  if (value.length < 32 || value === '[SENSITIVE]') throw new Error('email_outbox_not_configured');
  return value;
}
export function emailOutboxReady() { try { secret(); return true; } catch { return false; } }
export function emailFingerprint(value: string) {
  return createHmac('sha256', secret()).update(`buildtrack-email:v1:${value}`).digest('hex');
}
function key() { return createHash('sha256').update(`buildtrack-email-outbox:v1:${secret()}`).digest(); }

export function encryptEmailPayload(id: string, payload: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptEmailPayload<T>(id: string, value: string): T {
  const [version, iv, tag, ciphertext, extra] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext || extra) throw new Error('invalid_email_payload');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')) as T;
}
