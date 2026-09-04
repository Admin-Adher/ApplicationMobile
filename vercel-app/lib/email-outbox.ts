import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient, type ServerAuthority } from './server-auth';
import { sendEmail, normalizeEmail, emailConfiguration, type SendEmailParams } from './sender';
import { emailFingerprint, emailOutboxReady, encryptEmailPayload, decryptEmailPayload } from './email-outbox-crypto';
import { invitationEmail, passwordResetEmail } from './templates';
import { normalizeLang } from './i18n';
import { recoveryUrl, RECOVERY_ORIGIN } from './recovery-link';

type PreparedEmail = Pick<SendEmailParams, 'to' | 'subject' | 'html' | 'text'>;
type Payload = { kind: 'recovery'; email: string; language: string; prepared?: PreparedEmail }
  | { kind: 'invitation'; invitationId: string; token: string; email: string; language: string; prepared?: PreparedEmail };
export type EmailJob = {
  id: string; kind: Payload['kind']; organization_id: string | null;
  encrypted_payload: string; attempts: number; expires_at: string; lease_until: string;
};

export class EmailQueueError extends Error {
  constructor(public code: string, public status = 503, public retryable = false) { super(code); }
}

function database(client?: SupabaseClient | null) {
  const db = client ?? createServiceClient();
  if (!db || !emailOutboxReady() || !emailConfiguration().ready) throw new EmailQueueError('email_service_unavailable');
  return db;
}

async function enqueue(payload: Payload, dedupe: string, throttle: string, organizationId: string | null, db: SupabaseClient) {
  const id = randomUUID();
  const { data, error } = await db.rpc('server_enqueue_transactional_email', {
    p_id: id, p_dedupe_key: dedupe, p_kind: payload.kind, p_organization_id: organizationId,
    p_recipient_hash: emailFingerprint(payload.email), p_throttle_hash: emailFingerprint(throttle),
    p_encrypted_payload: encryptEmailPayload(id, payload),
    p_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  if (error || !data?.id) throw new EmailQueueError(error?.code === 'PT429' ? 'email_rate_limited' : 'email_queue_unavailable', error?.code === 'PT429' ? 429 : 503);
  console.info('[email-outbox]', JSON.stringify({ requestId: data.id, kind: payload.kind, status: 'queued', duplicate: data.duplicate === true }));
  return String(data.id);
}

export async function enqueueRecovery(email: unknown, language: unknown, ip: string, client?: SupabaseClient) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new EmailQueueError('invalid_email', 400);
  const db = database(client);
  // No account lookup in the public request. Both existing and unknown email
  // addresses receive the same durable acknowledgement and rate-limit policy.
  return enqueue({ kind: 'recovery', email: normalized, language: normalizeLang(typeof language === 'string' ? language : null) },
    `recovery:${emailFingerprint(normalized)}:${Math.floor(Date.now() / 60_000)}`, `recovery-ip:${ip}`, null, db);
}

export async function enqueueInvitation(body: Record<string, unknown>, caller: Pick<ServerAuthority, 'organizationId' | 'isPlatformAdmin' | 'userId'>, client?: SupabaseClient) {
  const db = database(client);
  const email = normalizeEmail(body.email);
  if (!email || typeof body.token !== 'string' || body.token.length > 512) throw new EmailQueueError('invalid_invitation', 400);
  let query = db.from('invitations').select('id,email,organization_id,token,status,expires_at,resend_count').eq('token', body.token).eq('status', 'pending');
  if (!caller.isPlatformAdmin) {
    if (!caller.organizationId) throw new EmailQueueError('invitation_not_authorized', 403);
    query = query.eq('organization_id', caller.organizationId);
  }
  const { data, error } = await query.maybeSingle();
  if (error || !data || normalizeEmail(data.email) !== email) throw new EmailQueueError('invitation_not_authorized', 403);
  if (Date.parse(data.expires_at) <= Date.now()) throw new EmailQueueError('invitation_expired', 409);
  return enqueue({ kind: 'invitation', invitationId: data.id, token: data.token, email, language: normalizeLang(typeof body.language === 'string' ? body.language : null) },
    `invitation:${data.id}:${Number(data.resend_count || 0)}`, `invitation-actor:${caller.userId}`, data.organization_id, db);
}

async function prepare(job: EmailJob, payload: Payload, db: SupabaseClient): Promise<PreparedEmail | null> {
  if (payload.kind === 'invitation') {
    const { data: invitation, error } = await db.from('invitations').select('email,token,status,expires_at,role,invited_by,organization_id,company_id')
      .eq('id', payload.invitationId).eq('organization_id', job.organization_id).maybeSingle();
    if (error) throw new EmailQueueError('invitation_lookup_failed', 503, true);
    if (!invitation || invitation.status !== 'pending' || invitation.token !== payload.token
      || normalizeEmail(invitation.email) !== payload.email || Date.parse(invitation.expires_at) <= Date.now()) return null;
    if (payload.prepared) return payload.prepared;
    const [organization, inviter, company] = await Promise.all([
      db.from('organizations').select('name').eq('id', job.organization_id).maybeSingle(),
      db.from('profiles').select('name').eq('id', invitation.invited_by).maybeSingle(),
      invitation.company_id ? db.from('companies').select('name').eq('id', invitation.company_id).eq('organization_id', job.organization_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    ]);
    if (organization.error || inviter.error || company.error || !organization.data) throw new EmailQueueError('invitation_lookup_failed', 503, true);
    return { to: payload.email, ...invitationEmail({
      email: payload.email, invitedByName: inviter.data?.name || 'BuildTrack', organizationName: organization.data.name,
      role: invitation.role, token: invitation.token, expiresAt: invitation.expires_at,
      companyName: company.data?.name, language: payload.language,
    }) };
  }
  if (payload.prepared) return payload.prepared;
  const { data: profile } = await db.from('profiles').select('name,preferred_language').eq('email', payload.email).limit(1).maybeSingle();
  const language = normalizeLang(profile?.preferred_language || payload.language);
  const { data, error } = await db.auth.admin.generateLink({ type: 'recovery', email: payload.email, options: { redirectTo: `${RECOVERY_ORIGIN}/reset-password?lang=${encodeURIComponent(language)}` } });
  if (error?.code === 'user_not_found') return null;
  if (error || !data?.properties?.hashed_token) throw new EmailQueueError('recovery_link_unavailable', 503, true);
  return { to: payload.email, ...passwordResetEmail({ name: profile?.name || payload.email.split('@')[0], language, resetUrl: recoveryUrl(data.properties.hashed_token, language) }) };
}

export function retryDelay(attempts: number) { return [30_000, 120_000, 300_000][Math.max(0, Math.min(2, attempts - 1))]; }

export async function processEmailJobs(id?: string, client?: SupabaseClient, deliver = sendEmail) {
  const db = database(client);
  const { data, error } = await db.rpc('server_claim_transactional_emails', { p_id: id || null, p_limit: id ? 1 : 3 });
  if (error) throw new EmailQueueError('email_claim_failed');
  const jobs = (data ?? []) as EmailJob[];
  await Promise.all(jobs.map(async job => {
    const save = async (values: Record<string, unknown>, current = 'preparing') => {
      const { data: changed, error: saveError } = await db.from('transactional_email_outbox')
        .update({ ...values, updated_at: new Date().toISOString() }).eq('id', job.id)
        .eq('attempts', job.attempts).eq('status', current).eq('lease_until', job.lease_until).select('id').maybeSingle();
      if (saveError || !changed) throw new EmailQueueError('email_state_unavailable');
    };
    let phase = 'preparing';
    try {
      const payload = decryptEmailPayload<Payload>(job.id, job.encrypted_payload);
      if (payload.kind !== job.kind) throw new EmailQueueError('invalid_email_payload', 500);
      const prepared = await prepare(job, payload, db);
      if (!prepared) {
        await save({ status: 'suppressed', encrypted_payload: null, lease_until: null });
        return;
      }
      // Persist the exact token before submitting any bytes to SMTP. A retry
      // reuses it and cannot invalidate a previously delivered recovery email.
      const encrypted = encryptEmailPayload(job.id, { ...payload, prepared });
      await save({ status: 'sending', encrypted_payload: encrypted });
      phase = 'sending';
      const result = await deliver({ ...prepared, requestId: job.id });
      if (result.success) {
        await save({ status: 'accepted', provider_message_id: result.messageId, encrypted_payload: null, lease_until: null, error_code: null }, phase);
      } else {
        const retry = result.retryable && job.attempts < 4 && Date.now() + retryDelay(job.attempts) < Date.parse(job.expires_at);
        await save({ status: retry ? 'pending' : result.code === 'delivery_uncertain' ? 'uncertain' : 'failed',
          error_code: result.code, encrypted_payload: retry ? encrypted : null, lease_until: null,
          next_attempt_at: new Date(Date.now() + retryDelay(job.attempts)).toISOString() }, phase);
      }
    } catch (failure) {
      const code = failure instanceof EmailQueueError ? failure.code : 'email_preparation_failed';
      console.error('[email-outbox]', JSON.stringify({ requestId: job.id, code, phase }));
      // If persistence after SMTP failed, the lease recovery marks it uncertain.
      if (phase === 'sending') return;
      const retry = failure instanceof EmailQueueError && failure.retryable && job.attempts < 4;
      await save({ status: retry ? 'pending' : 'failed', error_code: code, lease_until: null,
        encrypted_payload: retry ? job.encrypted_payload : null,
        next_attempt_at: new Date(Date.now() + retryDelay(job.attempts)).toISOString() }).catch(() => undefined);
    }
  }));
  return { processed: jobs.length };
}
