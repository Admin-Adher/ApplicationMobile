// Read-only runtime audit. Never sends email or prints credentials, recipients,
// invitation tokens, recovery links, or provider response bodies.
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

if (process.env.EMAIL_DELIVERY_AUDIT !== '1') process.exit(0);

function report(check, detail) {
  console.log('[email-audit]', JSON.stringify({ check, ...detail }));
}

async function main() {
  const user = String(process.env.GMAIL_USER || '').trim();
  const pass = String(process.env.GMAIL_APP_PASSWORD || '');
  const usable = value => Boolean(value && value !== '[SENSITIVE]');
  report('configuration', {
    gmailUserConfigured: usable(user),
    gmailPasswordConfigured: usable(pass),
    gmailPasswordNormalizedLength: usable(pass) ? pass.replace(/\s/g, '').length : null,
    fromConfigured: usable(process.env.EMAIL_FROM),
    fromMatchesAuthenticatedMailbox: usable(user) && String(process.env.EMAIL_FROM || '').includes(user),
    serviceRoleConfigured: usable(process.env.SUPABASE_SERVICE_ROLE_KEY),
    resendConfigured: usable(process.env.RESEND_API_KEY),
    outboxEncryptionConfigured: String(process.env.EMAIL_OUTBOX_SECRET || process.env.RESERVE_TOKEN_SECRET || '').length >= 32,
  });
  if (usable(user) && usable(pass)) {
    const transport = nodemailer.createTransport({
      service: 'gmail', auth: { user, pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    });
    const started = Date.now();
    try {
      await transport.verify();
      report('smtp_authentication', { ok: true, durationMs: Date.now() - started });
    } catch (error) {
      report('smtp_authentication', {
        ok: false, durationMs: Date.now() - started,
        code: error.code || 'unknown', responseCode: error.responseCode || null,
        command: error.command || null,
      });
    } finally {
      transport.close();
    }
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!usable(key) || !url) return;
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: invitations, error: invitationError } = await db.from('invitations')
    .select('status,created_at,expires_at,resend_count')
    .gte('created_at', since).limit(1000);
  const counts = {};
  for (const invitation of invitations || []) {
    counts[invitation.status] = (counts[invitation.status] || 0) + 1;
  }
  report('invitations_14_days', {
    ok: !invitationError, errorCode: invitationError?.code || null,
    sampled: invitations?.length || 0, byStatus: counts,
    expiredPending: (invitations || []).filter(row => row.status === 'pending' && Date.parse(row.expires_at) < Date.now()).length,
    resendAttempts: (invitations || []).reduce((total, row) => total + Number(row.resend_count || 0), 0),
  });
  const { count, error } = await db.from('email_notification_log').select('*', { count: 'exact', head: true });
  report('notification_log', { ok: !error, count, errorCode: error?.code || null });
  const recipient = String(process.env.EMAIL_AUDIT_RECIPIENT || '').trim().toLowerCase();
  if (recipient) {
    const { data: profiles, error: profileError } = await db.from('profiles')
      .select('id,email').eq('email', recipient).limit(2);
    report('target_profile', { count: profiles?.length || 0, errorCode: profileError?.code || null });
    if (profiles?.length === 1) {
      const { data: auth, error: authError } = await db.auth.admin.getUserById(profiles[0].id);
      report('target_auth', {
        exists: Boolean(auth?.user), errorCode: authError?.code || null,
        emailMatches: auth?.user?.email?.toLowerCase() === recipient,
        emailConfirmed: Boolean(auth?.user?.email_confirmed_at),
        recoverySentAt: auth?.user?.recovery_sent_at || null,
        lastSignInAt: auth?.user?.last_sign_in_at || null,
      });
    }
  }
  const response = await fetch(`${url}/auth/v1/settings`, {
    headers: { apikey: key }, signal: AbortSignal.timeout(10000),
  });
  const settings = await response.json();
  report('auth_settings', {
    status: response.status, emailSignupEnabled: settings.external?.email,
    emailAutoConfirm: settings.mailer_autoconfirm,
  });
}

main().catch(error => {
  report('audit', { ok: false, code: error.code || error.name || 'unknown' });
  process.exitCode = 1;
});
