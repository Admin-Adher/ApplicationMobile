import { createHmac, timingSafeEqual } from 'node:crypto';

type OprAccess = { oprId: string; signerId: string; signerVersion: string; expiresAt: number };
const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function mac(body: string, secret: string) {
  return createHmac('sha256', secret).update('buildtrack-opr-signature-v1:' + body).digest();
}

export function issueOprAccess(
  subject: Omit<OprAccess, 'expiresAt'>,
  secret: string,
  now = Date.now(),
) {
  const body = Buffer.from(JSON.stringify({ ...subject, expiresAt: now + LIFETIME_MS })).toString('base64url');
  return body + '.' + mac(body, secret).toString('base64url');
}

export function verifyOprAccess(token: unknown, oprId: string, secret: string, now = Date.now()): OprAccess | null {
  if (typeof token !== 'string' || token.length > 1500) return null;
  const [body, signature, rest] = token.split('.');
  if (!body || !signature || rest !== undefined || !/^[\w-]+$/.test(body) || !/^[\w-]+$/.test(signature)) return null;
  const actual = Buffer.from(signature, 'base64url');
  const expected = mac(body, secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OprAccess;
    return parsed.oprId === oprId && typeof parsed.signerId === 'string' && typeof parsed.signerVersion === 'string'
      && Number.isSafeInteger(parsed.expiresAt) && parsed.expiresAt > now ? parsed : null;
  } catch {
    return null;
  }
}

export function buildOprSignature(strokes: unknown): string | null {
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 50) return null;
  let count = 0;
  const paths: string[] = [];
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || !stroke.length || (count += stroke.length) > 4000) return null;
    const points: string[] = [];
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2 || !point.every(value => Number.isInteger(value))) return null;
      const [x, y] = point;
      if (x < 0 || x > 600 || y < 0 || y > 220) return null;
      points.push(x + ',' + y);
    }
    if (points.length > 1) paths.push('<polyline points="' + points.join(' ') + '"/>');
  }
  if (!paths.length) return null;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 220" fill="none" stroke="#142842" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' + paths.join('') + '</svg>';
}
