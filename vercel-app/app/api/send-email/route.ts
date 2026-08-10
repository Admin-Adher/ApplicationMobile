import { NextRequest, NextResponse } from 'next/server';
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
import {
  OPTOUT_EXEMPT_EMAIL_TYPES,
  isOptedOut,
  withUnsubscribeFooter,
  listUnsubscribeHeaders,
} from '@/lib/emailOptout';
import { authenticateRequest, createServiceClient, getOrganizationUsers } from '@/lib/server-auth';

function signedReserveUrl(reserveId: string, recipientEmail: string, language?: string | null): string {
  // Fail closed: an unsigned fallback would produce either a broken link or a
  // future accidental disclosure if the public page contract changed.
  return buildReserveUrl(APP_URL, reserveId, recipientEmail, language);
}

function serviceClient() {
  return createServiceClient();
}

// Auth obligatoire : header `Authorization: Bearer <access_token Supabase>` vérifié
// via le client service-role (même pattern que /api/send-push). Retourne l'id,
// l'email auth et l'organisation de l'appelant, ou null.
type CallerContext = {
  userId: string;
  email: string;
  organizationId: string | null;
  role: string;
  isPlatformAdmin: boolean;
};

async function authenticatedCaller(req: NextRequest): Promise<CallerContext | null> {
  const auth = await authenticateRequest(req);
  if (!auth) return null;
  return {
    userId: auth.authority.userId,
    email: auth.authority.email,
    organizationId: auth.authority.organizationId,
    role: auth.authority.role,
    isPlatformAdmin: auth.authority.isPlatformAdmin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-relais : le destinataire doit être légitime pour le type d'email demandé.
// Sans cette vérification, n'importe quel compte authentifié pouvait envoyer
// les templates officiels (invitation, bienvenue, réserve…) à une adresse
// arbitraire — un vecteur de phishing avec l'image de marque de l'app.
//   - welcome / password-* : uniquement l'adresse de l'appelant lui-même ;
//   - invitation : une invitation doit exister en base pour cet email dans
//     l'organisation de l'appelant (créée juste avant l'envoi) ;
//   - invitation-accepted : un profil de l'organisation de l'appelant ;
//   - access-revoked : un profil de l'organisation de l'appelant, ou dont
//     l'organisation vient d'être détachée (org NULL) ;
//   - reserve-* : membres (profiles) ou entreprises (companies) de l'org.
// Les comparaisons se font en JS sur des emails normalisés (trim+lowercase)
// pour éviter les pièges de casse et les wildcards d'un ilike.
// ─────────────────────────────────────────────────────────────────────────────
async function recipientAllowed(caller: CallerContext, type: string, to: string): Promise<boolean> {
  const supabase = serviceClient();
  if (!supabase) return false;
  const email = String(to ?? '').trim().toLowerCase();
  if (!email.includes('@')) return false;

  const matchesEmail = (rows: any[] | null | undefined) =>
    (rows ?? []).some(row => String(row?.email ?? '').trim().toLowerCase() === email);

  if (type === 'welcome' || type === 'password-changed' || type === 'password-reset') {
    return email === caller.email;
  }

  if (type === 'invitation') {
    if (!caller.organizationId) return false;
    const { data } = await supabase
      .from('invitations')
      .select('email')
      .eq('organization_id', caller.organizationId);
    return matchesEmail(data);
  }

  if (type === 'invitation-accepted') {
    if (!caller.organizationId) return false;
    const users = await getOrganizationUsers(supabase, caller.organizationId);
    return matchesEmail(users);
  }

  if (type === 'access-revoked') {
    // Le profil révoqué peut avoir son organization_id déjà passé à NULL au
    // moment de l'envoi — on accepte les deux états.
    if (!caller.organizationId) return false;
    const users = await getOrganizationUsers(supabase, caller.organizationId, true);
    return matchesEmail(users);
  }

  // reserve-created / reserve-status-changed / reserve-overdue
  if (!caller.organizationId) return false;
  const [users, companiesResult] = await Promise.all([
    getOrganizationUsers(supabase, caller.organizationId),
    supabase.from('companies').select('email').eq('organization_id', caller.organizationId),
  ]);
  return matchesEmail(users) || matchesEmail(companiesResult.data);
}

async function reserveBelongsToCaller(caller: CallerContext, reserveId: unknown) {
  const supabase = serviceClient();
  if (!supabase || !caller.organizationId || !reserveId) return false;
  const { data, error } = await supabase
    .from('reserves')
    .select('id')
    .eq('id', String(reserveId))
    .eq('organization_id', caller.organizationId)
    .maybeSingle();
  return !error && Boolean(data?.id);
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

  const caller = await authenticatedCaller(req);
  if (!caller) {
    return NextResponse.json({ error: 'Session invalide' }, { status: 401, headers });
  }

  const rate = checkRateLimit(`send-email:${caller.userId}`, 20, 60_000);
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

    const adminEmailTypes = new Set(['invitation', 'invitation-accepted', 'access-revoked']);
    if (adminEmailTypes.has(type)
      && !caller.isPlatformAdmin
      && caller.role !== 'admin'
      && caller.role !== 'super_admin') {
      return NextResponse.json({ error: 'Droits administrateur requis' }, { status: 403, headers });
    }
    if (String(type).startsWith('reserve-') && !await reserveBelongsToCaller(caller, body.reserveId)) {
      return NextResponse.json({ error: 'Réserve hors organisation' }, { status: 403, headers });
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
        reserveUrl: signedReserveUrl(reserveId, email, language),
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
        reserveUrl: signedReserveUrl(reserveId, email, language),
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
        reserveUrl: signedReserveUrl(reserveId, email, language),
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

    const allowed = await recipientAllowed(caller, type, to);
    if (!allowed) {
      console.warn(`[send-email] destinataire refusé (type=${type}, caller=${caller.userId}):`, String(to).slice(0, 80));
      return NextResponse.json(
        { error: "Destinataire non autorisé pour ce type d'email" },
        { status: 403, headers }
      );
    }

    const allowedByPreferences = await shouldSendConfigurableEmail(type, to, body);
    if (!allowedByPreferences) {
      return NextResponse.json({ success: true, suppressed: true }, { headers });
    }

    // Désinscription (RGPD) : les emails de notification ne partent plus vers
    // une adresse opt-out ; les emails transactionnels/sécurité restent exempts.
    const exempt = OPTOUT_EXEMPT_EMAIL_TYPES.has(type);
    if (!exempt && await isOptedOut(serviceClient(), to)) {
      return NextResponse.json({ success: true, suppressed: true, optedOut: true }, { headers });
    }

    const html = exempt ? template.html : withUnsubscribeFooter(template.html, APP_URL, to, body.language);
    const extraHeaders = exempt ? undefined : listUnsubscribeHeaders(APP_URL, to);
    const result = await sendEmail({ to, subject: template.subject, html, headers: extraHeaders });
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
