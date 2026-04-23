import crypto from 'crypto';

const DEFAULT_TTL_DAYS = 30;

function getSecret(): string {
  const s = process.env.RESERVE_TOKEN_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'RESERVE_TOKEN_SECRET manquant ou trop court (min 16 caractères) — ' +
      'à configurer dans les variables d\'environnement Vercel.'
    );
  }
  return s;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function hmac(payload: string, secret: string): string {
  return b64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

export interface ReserveTokenPayload {
  reserveId: string;
  email: string;
  exp: number; // seconds since epoch
}

export function signReserveToken(
  reserveId: string,
  email: string,
  ttlDays = DEFAULT_TTL_DAYS,
): string {
  const secret = getSecret();
  const payload: ReserveTokenPayload = {
    reserveId,
    email: email.toLowerCase(),
    exp: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  };
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = hmac(body, secret);
  return `${body}.${sig}`;
}

export function verifyReserveToken(
  token: string,
  expectedReserveId: string,
): ReserveTokenPayload | null {
  try {
    const secret = getSecret();
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;

    const expected = hmac(body, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;

    const payload = JSON.parse(fromB64url(body).toString('utf8')) as ReserveTokenPayload;
    if (!payload.reserveId || !payload.email || !payload.exp) return null;
    if (payload.reserveId !== expectedReserveId) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildReserveUrl(appUrl: string, reserveId: string, recipientEmail: string): string {
  const token = signReserveToken(reserveId, recipientEmail);
  return `${appUrl}/reserve/${encodeURIComponent(reserveId)}?t=${encodeURIComponent(token)}`;
}
