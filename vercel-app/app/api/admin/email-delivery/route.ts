import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server-auth';
import { emailConfiguration } from '@/lib/sender';
import { emailOutboxReady } from '@/lib/email-outbox-crypto';

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: 'Session invalide' }, { status: 401 });
  if (!auth.authority.isPlatformAdmin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  // Platform support only: no recipient, message content, hash, or recovery token.
  const { data, error } = await auth.supabase.from('transactional_email_outbox')
    .select('id,kind,status,attempts,error_code,provider_message_id,created_at,updated_at,next_attempt_at,expires_at')
    .order('created_at', { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: 'Diagnostic indisponible' }, { status: 503 });
  return NextResponse.json({ smtpConfigured: emailConfiguration().ready, encryptionConfigured: emailOutboxReady(),
    acceptanceIsNotInboxDelivery: true, jobs: data }, { headers: { 'Cache-Control': 'no-store' } });
}
