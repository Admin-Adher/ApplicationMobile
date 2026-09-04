import { after, NextRequest, NextResponse } from 'next/server';
import { enqueueRecovery, processEmailJobs, EmailQueueError } from '@/lib/email-outbox';

export const maxDuration = 60;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Email invalide' }, { status: 400, headers: CORS_HEADERS });
    }
    const { email, language: requestedLanguage } = body;
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    // Acknowledge persistence, not delivery. Unknown accounts follow exactly
    // the same path; account lookup and SMTP happen after the public response.
    const requestId = await enqueueRecovery(email, requestedLanguage, ip);
    after(async () => {
      await processEmailJobs(requestId).catch(() => {
        console.error('[email-outbox]', JSON.stringify({ requestId, code: 'worker_deferred' }));
      });
    });
    return NextResponse.json({ success: true, queued: true, requestId }, { status: 202, headers: CORS_HEADERS });
  } catch (error) {
    const status = error instanceof EmailQueueError ? error.status : 503;
    const code = error instanceof EmailQueueError ? error.code : 'email_service_unavailable';
    console.error('[request-password-reset]', JSON.stringify({ code }));
    const message = status === 400 ? 'Email invalide' : status === 429
      ? 'Trop de demandes. Réessayez plus tard.' : 'Le service email est temporairement indisponible. Réessayez dans quelques instants.';
    return NextResponse.json({ success: false, error: message, code }, {
      status, headers: { ...CORS_HEADERS, ...(status === 429 ? { 'Retry-After': '900' } : {}) },
    });
  }
}
