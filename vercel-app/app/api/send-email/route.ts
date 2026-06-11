import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/sender';
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
  APP_URL,
} from '@/lib/templates';
import { buildReserveUrl } from '@/lib/reserve-token';
import { checkRateLimit } from '@/lib/rateLimit';

function safeReserveUrl(reserveId: string, recipientEmail: string, language?: string | null): string {
  try {
    return buildReserveUrl(APP_URL, reserveId, recipientEmail, language);
  } catch (e: any) {
    console.warn('[send-email] reserveUrl signature impossible:', e?.message);
    const lang = String(language ?? '').toLowerCase().slice(0, 2);
    const langQuery = ['fr', 'en', 'es'].includes(lang) ? `?lang=${encodeURIComponent(lang)}` : '';
    return `${APP_URL}/reserve/${encodeURIComponent(reserveId)}${langQuery}`;
  }
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Auth obligatoire : header `Authorization: Bearer <access_token Supabase>` vérifié
// via le client service-role (même pattern que /api/send-push). Retourne l'id
// utilisateur authentifié, ou null.
async function authenticatedUserId(req: NextRequest): Promise<string | null> {
  const supabase = serviceClient();
  if (!supabase) return null;
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return null;
  return userId;
}

async function resolveRecipientLanguage(email: string, fallback?: string | null) {
  const supabase = serviceClient();
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!supabase || !normalizedEmail) return fallback ?? null;
  const { data, error } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (error) {
    console.warn('[email language] lecture impossible:', error.message);
    return fallback ?? null;
  }
  return data?.preferred_language ?? fallback ?? null;
}

function emailPreferenceAllows(pref: any, column: string, critical = false) {
  if (!pref) return true;
  if (pref.email_enabled === false) return false;
  const criticalAllowed = critical && pref.reserve_critical_email !== false;
  if (pref[column] === false && !criticalAllowed) return false;
  return true;
}

async function shouldSendConfigurableEmail(type: string, email: string, body: any) {
  const columnByType: Record<string, string> = {
    'reserve-created': 'reserve_created_email',
    'reserve-status-changed': 'reserve_status_email',
    'reserve-overdue': 'reserve_overdue_email',
  };
  const column = columnByType[type];
  if (!column) return true;
  const supabase = serviceClient();
  if (!supabase) return true;
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!normalizedEmail) return true;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (profileError || !profile?.id) return true;
  const { data: pref, error: prefError } = await supabase
    .from('notification_preferences')
    .select('email_enabled, reserve_created_email, reserve_status_email, reserve_critical_email, reserve_overdue_email')
    .eq('user_id', profile.id)
    .maybeSingle();
  if (prefError) {
    console.warn('[email prefs] lecture impossible:', prefError.message);
    return true;
  }
  return emailPreferenceAllows(pref, column, body?.priority === 'critical');
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ].filter(Boolean) as string[];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0];

  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  const userId = await authenticatedUserId(req);
  if (!userId) {
    return NextResponse.json({ error: 'Session invalide' }, { status: 401, headers });
  }

  const rate = checkRateLimit(`send-email:${userId}`, 20, 60_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Trop d'envois d'emails. Réessayez dans quelques instants." },
      { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  try {
    const body = await req.json();
    const { type } = body;

    if (!type) {
      return NextResponse.json({ error: 'Type manquant' }, { status: 400, headers });
    }

    let template: { subject: string; html: string } | null = null;
    let to: string = '';

    if (type === 'invitation') {
      const { email, invitedByName, organizationName, role, token, expiresAt, companyName } = body;
      if (!email || !invitedByName || !organizationName || !role || !token || !expiresAt) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      const language = await resolveRecipientLanguage(email, body.language);
      template = invitationEmail({ email, invitedByName, organizationName, role, token, expiresAt, companyName, language });
    } else if (type === 'welcome') {
      const { email, name, organizationName } = body;
      if (!email || !name) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      const language = await resolveRecipientLanguage(email, body.language);
      template = welcomeEmail({ email, name, organizationName, language });
    } else if (type === 'password-reset') {
      const { email, name, resetUrl } = body;
      if (!email || !name || !resetUrl) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      const language = await resolveRecipientLanguage(email, body.language);
      template = passwordResetEmail({ name, resetUrl, language });
    } else if (type === 'invitation-accepted') {
      const { adminEmail, adminName, inviteeName, inviteeEmail, organizationName, role } = body;
      if (!adminEmail || !adminName || !inviteeName || !inviteeEmail || !organizationName || !role) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = adminEmail;
      const language = await resolveRecipientLanguage(adminEmail, body.language);
      template = invitationAcceptedEmail({ adminName, inviteeName, inviteeEmail, organizationName, role, language });
    } else if (type === 'reserve-created') {
      const {
        email, recipientName, reserveTitle, reserveId, priority, deadline,
        building, level, zone, description, chantierName, companyName, createdBy, reserveCode,
      } = body;
      if (!email || !recipientName || !reserveTitle || !reserveId || !companyName || !createdBy) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      const language = await resolveRecipientLanguage(email, body.language);
      template = reserveCreatedEmail({
        recipientName, reserveTitle, reserveId, priority, deadline,
        building, level, zone, description, chantierName, companyName, createdBy, reserveCode, language,
        reserveUrl: safeReserveUrl(reserveId, email, language),
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
      const language = await resolveRecipientLanguage(email, body.language);
      template = reserveStatusChangedEmail({
        recipientName, reserveTitle, reserveId, newStatus, previousStatus,
        changedBy, companyName, chantierName, reserveCode, language,
        reserveUrl: safeReserveUrl(reserveId, email, language),
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
      const language = await resolveRecipientLanguage(email, body.language);
      template = reserveOverdueEmail({
        recipientName, reserveTitle, reserveId, deadline, daysLate,
        priority, companyName, chantierName, reserveCode, language,
        reserveUrl: safeReserveUrl(reserveId, email, language),
      } as any);
    } else if (type === 'password-changed') {
      const { email, name } = body;
      if (!email || !name) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      const language = await resolveRecipientLanguage(email, body.language);
      template = passwordChangedEmail({ name, language });
    } else if (type === 'access-revoked') {
      const { email, name, organizationName } = body;
      if (!email || !name || !organizationName) {
        return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400, headers });
      }
      to = email;
      const language = await resolveRecipientLanguage(email, body.language);
      template = accessRevokedEmail({ name, organizationName, language });
    } else {
      return NextResponse.json({ error: `Type inconnu: ${type}` }, { status: 400, headers });
    }

    const allowedByPreferences = await shouldSendConfigurableEmail(type, to, body);
    if (!allowedByPreferences) {
      return NextResponse.json({ success: true, suppressed: true }, { headers });
    }

    const result = await sendEmail({ to, subject: template.subject, html: template.html });
    if (!result.success) {
      return NextResponse.json({ error: result.error ?? "Échec de l'envoi" }, { status: 500, headers });
    }
    return NextResponse.json({ success: true, simulated: result.simulated ?? false }, { headers });
  } catch (err: any) {
    console.error('[Email] Exception:', err?.message ?? err);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500, headers });
  }
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ].filter(Boolean) as string[];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0];
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
