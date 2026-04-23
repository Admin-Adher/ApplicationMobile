import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import {
  invitationEmail,
  welcomeEmail,
  passwordResetEmail,
  invitationAcceptedEmail,
  accessRevokedEmail,
  reserveCreatedEmail,
  reserveStatusChangedEmail,
  reserveOverdueEmail,
  APP_URL,
} from '@/lib/templates';
import { buildReserveUrl } from '@/lib/reserve-token';

function safeReserveUrl(reserveId: string, recipientEmail: string): string {
  try {
    return buildReserveUrl(APP_URL, reserveId, recipientEmail);
  } catch (e: any) {
    console.warn('[send-email] reserveUrl signature impossible:', e?.message);
    return `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  }
}

const FROM_EMAIL = 'BuildTrack <onboarding@resend.dev>';

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0];

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const body = await req.json();
    const { type } = body;

    if (!type) {
      return NextResponse.json({ error: 'Type manquant' }, { status: 400, headers });
    }

    let template: { subject: string; html: string } | null = null;
    let to: string = '';

    if (type === 'invitation') {
      const { email, invitedByName, organizationName, role, token, expiresAt } = body;
      if (!email || !invitedByName || !organizationName || !role || !token || !expiresAt) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      template = invitationEmail({ email, invitedByName, organizationName, role, token, expiresAt });
    } else if (type === 'welcome') {
      const { email, name, organizationName } = body;
      if (!email || !name) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      template = welcomeEmail({ email, name, organizationName });
    } else if (type === 'password-reset') {
      const { email, name, resetUrl } = body;
      if (!email || !name || !resetUrl) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      template = passwordResetEmail({ name, resetUrl });
    } else if (type === 'invitation-accepted') {
      const { adminEmail, adminName, inviteeName, inviteeEmail, organizationName, role } = body;
      if (!adminEmail || !adminName || !inviteeName || !inviteeEmail || !organizationName || !role) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = adminEmail;
      template = invitationAcceptedEmail({ adminName, inviteeName, inviteeEmail, organizationName, role });
    } else if (type === 'reserve-created') {
      const {
        email, recipientName, reserveTitle, reserveId, priority, deadline,
        building, level, zone, description, chantierName, companyName, createdBy, reserveCode,
      } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !companyName || !createdBy) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      template = reserveCreatedEmail({
        recipientName, reserveTitle, reserveId, priority, deadline,
        building, level, zone, description, chantierName, companyName, createdBy, reserveCode,
        reserveUrl: safeReserveUrl(reserveId, email),
      } as any);
    } else if (type === 'reserve-status-changed') {
      const {
        email, recipientName, reserveTitle, reserveId, newStatus, previousStatus,
        changedBy, companyName, chantierName, reserveCode,
      } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !newStatus || !changedBy || !companyName) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      template = reserveStatusChangedEmail({
        recipientName, reserveTitle, reserveId, newStatus, previousStatus,
        changedBy, companyName, chantierName, reserveCode,
        reserveUrl: safeReserveUrl(reserveId, email),
      } as any);
    } else if (type === 'reserve-overdue') {
      const {
        email, recipientName, reserveTitle, reserveId, deadline, daysLate,
        priority, companyName, chantierName, reserveCode,
      } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !deadline || daysLate == null || !companyName) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      template = reserveOverdueEmail({
        recipientName, reserveTitle, reserveId, deadline, daysLate,
        priority, companyName, chantierName, reserveCode,
        reserveUrl: safeReserveUrl(reserveId, email),
      } as any);
    } else if (type === 'access-revoked') {
      const { email, name, organizationName } = body;
      if (!email || !name || !organizationName) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      template = accessRevokedEmail({ name, organizationName });
    } else {
      return NextResponse.json({ error: `Type inconnu: ${type}` }, { status: 400, headers });
    }

    const resend = getResend();
    if (!resend) {
      console.warn('[Email] RESEND_API_KEY absent — mode simulation');
      return NextResponse.json({ success: true, simulated: true }, { headers });
    }

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject: template.subject,
      html: template.html,
    });

    if (error) {
      console.error('[Email] Erreur Resend:', error);
      return NextResponse.json({ error: error.message }, { status: 500, headers });
    }

    return NextResponse.json({ success: true }, { headers });
  } catch (err: any) {
    console.error('[Email] Exception:', err?.message ?? err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers });
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0];
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
