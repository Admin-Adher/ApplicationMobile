import { sendEmail } from '@/lib/email/sender';
import {
  invitationEmail,
  welcomeEmail,
  passwordResetEmail,
  passwordChangedEmail,
  invitationAcceptedEmail,
  accessRevokedEmail,
  reserveCreatedEmail,
  reserveStatusChangedEmail,
  reserveOverdueEmail,
} from '@/lib/email/templates';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type } = body;
    const language = body.language ?? body.preferredLanguage ?? null;

    if (!type) {
      return Response.json({ error: 'Missing type' }, { status: 400 });
    }

    if (type === 'invitation') {
      const { email, invitedByName, organizationName, role, token, expiresAt, companyName } = body;
      if (!email || !invitedByName || !organizationName || !role || !token || !expiresAt) {
        return Response.json({ error: 'Missing parameters for invitation' }, { status: 400 });
      }
      const template = invitationEmail({ email, invitedByName, organizationName, role, token, expiresAt, companyName, language });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'welcome') {
      const { email, name, organizationName } = body;
      if (!email || !name) {
        return Response.json({ error: 'Missing parameters for welcome' }, { status: 400 });
      }
      const template = welcomeEmail({ email, name, organizationName, language });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'password-reset') {
      const { email, name, resetUrl } = body;
      if (!email || !name || !resetUrl) {
        return Response.json({ error: 'Missing parameters for password-reset' }, { status: 400 });
      }
      const template = passwordResetEmail({ name, resetUrl, language });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'invitation-accepted') {
      const { adminEmail, adminName, inviteeName, inviteeEmail, organizationName, role } = body;
      if (!adminEmail || !adminName || !inviteeName || !inviteeEmail || !organizationName || !role) {
        return Response.json({ error: 'Missing parameters for invitation-accepted' }, { status: 400 });
      }
      const template = invitationAcceptedEmail({ adminName, inviteeName, inviteeEmail, organizationName, role, language });
      const result = await sendEmail({ to: adminEmail, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'access-revoked') {
      const { email, name, organizationName } = body;
      if (!email || !name || !organizationName) {
        return Response.json({ error: 'Missing parameters for access-revoked' }, { status: 400 });
      }
      const template = accessRevokedEmail({ name, organizationName, language });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'reserve-created') {
      const {
        email, recipientName, reserveTitle, reserveId, priority, deadline,
        building, level, zone, description, chantierName, companyName, createdBy, reserveCode, language,
      } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !companyName || !createdBy) {
        return Response.json({ error: 'Missing parameters for reserve-created' }, { status: 400 });
      }
      const template = reserveCreatedEmail({
        recipientName, reserveTitle, reserveId, priority, deadline,
        building, level, zone, description, chantierName, companyName, createdBy, reserveCode, language,
      });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'reserve-status-changed') {
      const {
        email, recipientName, reserveTitle, reserveId, newStatus, previousStatus,
        changedBy, companyName, chantierName, reserveCode, language,
      } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !newStatus || !changedBy || !companyName) {
        return Response.json({ error: 'Missing parameters for reserve-status-changed' }, { status: 400 });
      }
      const template = reserveStatusChangedEmail({
        recipientName, reserveTitle, reserveId, newStatus, previousStatus,
        changedBy, companyName, chantierName, reserveCode, language,
      });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'reserve-overdue') {
      const {
        email, recipientName, reserveTitle, reserveId, deadline, daysLate,
        priority, companyName, chantierName, reserveCode, language,
      } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !deadline || daysLate == null || !companyName) {
        return Response.json({ error: 'Missing parameters for reserve-overdue' }, { status: 400 });
      }
      const template = reserveOverdueEmail({
        recipientName, reserveTitle, reserveId, deadline, daysLate,
        priority, companyName, chantierName, reserveCode, language,
      });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    if (type === 'password-changed') {
      const { email, name } = body;
      if (!email || !name) {
        return Response.json({ error: 'Missing parameters for password-changed' }, { status: 400 });
      }
      const template = passwordChangedEmail({ name, language });
      const result = await sendEmail({ to: email, ...template });
      if (!result.success) {
        return Response.json({ error: result.error ?? 'Email send failed' }, { status: 500 });
      }
      return Response.json({ success: true });
    }

    return Response.json({ error: `Unknown type: ${type}` }, { status: 400 });
  } catch (err: any) {
    console.error('[API send-email] Exception:', err?.message ?? err);
    return Response.json({ error: 'Server error' }, { status: 500 });
  }
}
