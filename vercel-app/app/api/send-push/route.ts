import { NextRequest, NextResponse } from 'next/server';
import { getReserveStatusLabel } from '@/lib/reserveLabels';
import { checkRateLimit } from '@/lib/rateLimit';
import { authenticateRequest, createServiceClient, getOrganizationUsers } from '@/lib/server-auth';

// Les ids (messages, réserves) sont des chaînes générées par l'app — jamais de
// contenu libre. On refuse tout ce qui sort de ce format avant de l'injecter
// dans une requête.
function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_:.\-]{1,80}$/.test(value);
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ].filter(Boolean) as string[];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function serviceClient() {
  return createServiceClient();
}

function sameName(a: unknown, b: unknown) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function previewText(value: unknown, fallback = 'Nouvelle activite') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function reserveCompanyNames(reserve: any): string[] {
  if (Array.isArray(reserve?.companies) && reserve.companies.length > 0) return reserve.companies;
  return reserve?.company ? [reserve.company] : [];
}

function notificationRoute(pathname: string, id: string) {
  return { pathname, id: String(id), path: pathname.replace('[id]', encodeURIComponent(String(id))) };
}

function isExpoPushToken(token: unknown) {
  return typeof token === 'string' && (
    token.startsWith('ExpoPushToken[') ||
    token.startsWith('ExponentPushToken[')
  );
}

type PushPreferenceColumn =
  | 'messages_push'
  | 'reserve_created_push'
  | 'reserve_status_push'
  | 'reserve_critical_push'
  | 'reserve_overdue_push';

function parseMinutes(value: unknown, fallback: number) {
  const match = String(value ?? '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesInTimezone(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone || 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    return hour * 60 + minute;
  } catch {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
}

function isQuietHour(pref: any) {
  if (!pref?.quiet_hours_enabled) return false;
  const current = minutesInTimezone(pref.quiet_hours_timezone ?? 'Europe/Paris');
  const start = parseMinutes(pref.quiet_hours_start, 19 * 60);
  const end = parseMinutes(pref.quiet_hours_end, 7 * 60);
  if (start === end) return false;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function pushPreferenceAllows(pref: any, column: PushPreferenceColumn, critical = false) {
  if (!pref) return true;
  if (pref.push_enabled === false) return false;
  const criticalAllowed = critical && pref.reserve_critical_push !== false;
  if (pref[column] === false && !criticalAllowed) return false;
  if (isQuietHour(pref) && !(criticalAllowed && pref.critical_always_push !== false)) return false;
  return true;
}

async function preferencesForProfiles(supabase: any, profileIds: string[]) {
  const ids = Array.from(new Set((profileIds ?? []).filter(Boolean)));
  const map = new Map<string, any>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('user_id, push_enabled, messages_push, reserve_created_push, reserve_status_push, reserve_critical_push, reserve_overdue_push, critical_always_push, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone')
    .in('user_id', ids);
  if (error) {
    console.warn('[push prefs] lecture impossible:', error.message);
    return map;
  }
  for (const row of data ?? []) map.set(row.user_id, row);
  return map;
}

async function authenticatedProfile(req: NextRequest, supabase: any) {
  const auth = await authenticateRequest(req, supabase);
  if (!auth) return null;
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('id', auth.authority.userId)
    .maybeSingle();
  if (error || !profile) return null;
  return {
    ...profile,
    role: auth.authority.role,
    organization_id: auth.authority.organizationId,
    company_id: auth.authority.companyId,
    is_platform_admin: auth.authority.isPlatformAdmin,
  };
}

async function enabledTokensForProfiles(
  supabase: any,
  profileIds: string[],
  column: PushPreferenceColumn,
  critical = false,
) {
  const ids = Array.from(new Set((profileIds ?? []).filter(Boolean)));
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, user_id')
    .eq('enabled', true)
    .in('user_id', ids);
  if (error) throw error;
  const prefs = await preferencesForProfiles(supabase, ids);
  const seen = new Set<string>();
  return (data ?? []).filter((row: any) => {
    if (!pushPreferenceAllows(prefs.get(row.user_id), column, critical)) return false;
    if (!isExpoPushToken(row.token) || seen.has(row.token)) return false;
    seen.add(row.token);
    return true;
  });
}

async function sendExpoPushMessages(supabase: any, messages: any[]) {
  const valid = (messages ?? []).filter(m => isExpoPushToken(m.to));
  const stats = { requested: valid.length, sent: 0, invalidTokens: 0 };
  if (valid.length === 0) return stats;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  const invalid = new Set<string>();
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100);
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.errors?.[0]?.message || body?.error || response.statusText);
    }
    const tickets = Array.isArray(body?.data) ? body.data : [];
    tickets.forEach((ticket: any, index: number) => {
      if (ticket?.status === 'ok') stats.sent += 1;
      else if (ticket?.details?.error === 'DeviceNotRegistered') invalid.add(chunk[index]?.to);
    });
  }

  if (invalid.size > 0) {
    stats.invalidTokens = invalid.size;
    // DeviceNotRegistered = token définitivement mort (app désinstallée,
    // token régénéré). On supprime la ligne au lieu de la désactiver pour
    // éviter l'accumulation indéfinie de cadavres dans push_tokens.
    await supabase
      .from('push_tokens')
      .delete()
      .in('token', Array.from(invalid));
  }
  return stats;
}

async function resolveReserveRecipientProfileIds(supabase: any, reserve: any) {
  const names = reserveCompanyNames(reserve);
  if (!reserve?.organization_id || names.length === 0) return [];
  const { data: companies, error: companyError } = await supabase
    .from('companies')
    .select('id, name, organization_id')
    .eq('organization_id', reserve.organization_id);
  if (companyError) throw companyError;
  const matched = (companies ?? []).filter((company: any) => names.some(name => sameName(name, company.name)));
  const companyIds = matched.map((c: any) => c.id);
  if (companyIds.length === 0) return [];
  const users = await getOrganizationUsers(supabase, reserve.organization_id);
  return users.filter(user => user.companyId && companyIds.includes(user.companyId)).map(user => user.id);
}

async function resolveMessageRecipientProfileIds(supabase: any, message: any, requesterProfile: any) {
  const orgId = message.organization_id || requesterProfile?.organization_id;
  if (!orgId) return [];
  const { data: channel } = await supabase
    .from('channels')
    .select('id, name, type, members, organization_id')
    .eq('id', message.channel_id)
    .maybeSingle();

  if (message.channel_id?.startsWith('company-')) {
    const companyId = message.channel_id.slice('company-'.length);
    const users = await getOrganizationUsers(supabase, orgId);
    return users
      .filter(user => user.companyId === companyId)
      .filter((p: any) => p.id !== requesterProfile.id && !sameName(p.name, message.sender))
      .map((p: any) => p.id);
  }

  const memberNames = Array.isArray(channel?.members) ? channel.members : [];
  const dmNames = message.channel_id?.startsWith('dm-') ? message.channel_id.slice(3).split('__') : [];
  const targetNames = Array.from(new Set([...memberNames, ...dmNames].filter(Boolean)))
    .filter(name => !sameName(name, message.sender));

  const profiles = await getOrganizationUsers(supabase, orgId);
  const candidates = targetNames.length > 0
    ? profiles.filter((p: any) => targetNames.some(name => sameName(name, p.name)))
    : profiles;
  return candidates
    .filter((p: any) => p.id !== requesterProfile.id && !sameName(p.name, message.sender))
    .map((p: any) => p.id);
}

async function pushForMessage(supabase: any, profile: any, body: any) {
  if (!body.messageId) throw new Error('messageId manquant');
  const { data: message, error } = await supabase
    .from('messages')
    .select('id, channel_id, sender, sender_id, content, attachment_uri, organization_id')
    .eq('id', body.messageId)
    .maybeSingle();
  if (error) throw error;
  if (!message) throw new Error('Message introuvable');
  if (!profile.organization_id || message.organization_id !== profile.organization_id) {
    throw Object.assign(new Error('Message hors organisation'), { statusCode: 403 });
  }
  if (message.sender_id !== profile.id) {
    throw Object.assign(new Error('Seul l expediteur peut notifier ce message'), { statusCode: 403 });
  }
  const recipientIds = await resolveMessageRecipientProfileIds(supabase, message, profile);
  const tokens = await enabledTokensForProfiles(supabase, recipientIds, 'messages_push');
  const pushStats = await sendExpoPushMessages(supabase, tokens.map((row: any) => ({
    to: row.token,
    sound: 'default',
    title: `Message de ${message.sender}`,
    body: previewText(message.content, message.attachment_uri ? 'Photo jointe' : 'Nouveau message'),
    data: notificationRoute('/channel/[id]', message.channel_id),
    channelId: 'buildtrack',
  })));
  return { recipients: recipientIds.length, ...pushStats };
}

async function pushForReserve(supabase: any, profile: any, body: any, statusChange = false) {
  if (!body.reserveId) throw new Error('reserveId manquant');
  const { data: reserve, error } = await supabase
    .from('reserves')
    .select('id, title, status, priority, companies, company, organization_id')
    .eq('id', body.reserveId)
    .maybeSingle();
  if (error) throw error;
  if (!reserve) throw new Error('Reserve introuvable');
  if (!profile.organization_id || reserve.organization_id !== profile.organization_id) {
    throw Object.assign(new Error('Reserve hors organisation'), { statusCode: 403 });
  }

  const recipientIds = await resolveReserveRecipientProfileIds(supabase, reserve);
  const isCritical = reserve.priority === 'critical';
  const tokens = await enabledTokensForProfiles(
    supabase,
    recipientIds.filter((id: string) => id !== profile.id),
    statusChange ? 'reserve_status_push' : 'reserve_created_push',
    isCritical,
  );
  const statusLabel = getReserveStatusLabel(body.newStatus || reserve.status, true);
  const title = statusChange ? 'Statut de reserve modifie' : 'Nouvelle reserve';
  const fallback = statusChange ? `${reserve.id} - ${statusLabel}` : `${reserve.id} - ${reserve.title}`;
  const pushStats = await sendExpoPushMessages(supabase, tokens.map((row: any) => ({
    to: row.token,
    sound: 'default',
    title,
    body: previewText(statusChange ? `${reserve.title} (${body.previousStatus || reserve.status} -> ${statusLabel})` : fallback, fallback),
    data: notificationRoute('/reserve/[id]', reserve.id),
    channelId: 'buildtrack',
  })));
  return { recipients: recipientIds.length, ...pushStats };
}

async function pushOverdueReserves(supabase: any) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString().split('T')[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayISO = yesterday.toISOString().split('T')[0];
  const stats = { scanned: 0, notified: 0, sent: 0, errors: 0 };
  const limit = 7;

  const { data: reserves, error } = await supabase
    .from('reserves')
    .select('id, title, priority, status, deadline, companies, company, chantier_id, organization_id, overdue_push_last_notified_date, overdue_push_reminder_count')
    .not('status', 'in', '(closed,verification)')
    .not('deadline', 'is', null)
    .lt('deadline', todayISO);
  if (error) throw error;
  const list = reserves ?? [];
  stats.scanned = list.length;
  if (list.length === 0) return stats;
  const orgIds: string[] = Array.from(new Set<string>(list.map((r: any) => String(r.organization_id ?? '')).filter(Boolean)));
  if (orgIds.length === 0) return stats;

  const { data: companies } = await supabase.from('companies').select('id, name, organization_id').in('organization_id', orgIds);
  const profiles = (await Promise.all(
    orgIds.map((organizationId: string) => getOrganizationUsers(supabase, organizationId)),
  )).flat().map(profile => ({
    id: profile.id,
    name: profile.name,
    company_id: profile.companyId,
    organization_id: profile.organizationId,
    role: profile.role,
  }));
  const { data: tokens } = await supabase.from('push_tokens').select('token, user_id').eq('enabled', true).in('organization_id', orgIds);
  const prefsByUser = await preferencesForProfiles(supabase, profiles.map((p: any) => p.id));

  const companiesByOrg = new Map<string, any[]>();
  for (const c of companies ?? []) {
    const arr = companiesByOrg.get(c.organization_id) ?? [];
    arr.push(c);
    companiesByOrg.set(c.organization_id, arr);
  }
  const profilesByCompany = new Map<string, any[]>();
  const adminsByOrg = new Map<string, any[]>();
  for (const p of profiles) {
    if (p.company_id) {
      const arr = profilesByCompany.get(p.company_id) ?? [];
      arr.push(p);
      profilesByCompany.set(p.company_id, arr);
    }
    if (p.role === 'admin' || p.role === 'super_admin') {
      const arr = adminsByOrg.get(p.organization_id) ?? [];
      arr.push(p);
      adminsByOrg.set(p.organization_id, arr);
    }
  }
  const tokensByUser = new Map<string, string[]>();
  for (const t of tokens ?? []) {
    if (!isExpoPushToken(t.token)) continue;
    const arr = tokensByUser.get(t.user_id) ?? [];
    arr.push(t.token);
    tokensByUser.set(t.user_id, arr);
  }

  for (const reserve of list) {
    try {
      if (reserve.overdue_push_last_notified_date === todayISO) continue;
      const names = reserveCompanyNames(reserve);
      const orgCompanies = companiesByOrg.get(reserve.organization_id) ?? [];
      const matchedCompanies = orgCompanies.filter(c => names.some(name => sameName(name, c.name)));
      if (matchedCompanies.length === 0) continue;
      const daysLate = Math.max(1, Math.round((today.getTime() - new Date(reserve.deadline).getTime()) / 86400000));
      const previousCount = typeof reserve.overdue_push_reminder_count === 'number' ? reserve.overdue_push_reminder_count : 0;
      const continuing = reserve.overdue_push_last_notified_date === yesterdayISO || reserve.overdue_push_last_notified_date === todayISO;
      const reminderCount = continuing ? previousCount : 0;
      const escalate = reminderCount >= limit;
      const recipients: any[] = [];
      if (escalate) recipients.push(...(adminsByOrg.get(reserve.organization_id) ?? []));
      else for (const company of matchedCompanies) recipients.push(...(profilesByCompany.get(company.id) ?? []));

      const seenUsers = new Set<string>();
      const messages: any[] = [];
      for (const profileRow of recipients) {
        if (!pushPreferenceAllows(prefsByUser.get(profileRow.id), 'reserve_overdue_push', reserve.priority === 'critical')) continue;
        if (seenUsers.has(profileRow.id)) continue;
        seenUsers.add(profileRow.id);
        for (const token of tokensByUser.get(profileRow.id) ?? []) {
          messages.push({
            to: token,
            sound: 'default',
            title: escalate ? 'Escalade reserve en retard' : 'Reserve en retard',
            body: previewText(`${reserve.id} - ${reserve.title} (${daysLate}j de retard)`),
            data: notificationRoute('/reserve/[id]', reserve.id),
            channelId: 'buildtrack',
          });
        }
      }

      const pushStats = await sendExpoPushMessages(supabase, messages);
      stats.sent += pushStats.sent;
      if (pushStats.sent > 0) {
        const nextCount = escalate ? reminderCount : reminderCount + 1;
        const { error: updateError } = await supabase
          .from('reserves')
          .update({
            overdue_push_last_notified_date: todayISO,
            overdue_push_reminder_count: nextCount,
          })
          .eq('id', reserve.id);
        if (updateError) stats.errors += 1;
        else stats.notified += 1;
      }
    } catch (err: any) {
      stats.errors += 1;
      console.warn('[push overdue] reserve', reserve.id, err?.message ?? err);
    }
  }
  return stats;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  const supabase = serviceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Configuration Supabase serveur manquante' }, { status: 500, headers });
  }

  try {
    const { type, ...body } = await req.json();
    if (!type) return NextResponse.json({ error: 'Type manquant' }, { status: 400, headers });

    if (type === 'reserve-overdue') {
      const cronSecret = process.env.CRON_SECRET;
      const auth = req.headers.get('authorization') ?? '';
      if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Non autorise' }, { status: 401, headers });
      }
      const stats = await pushOverdueReserves(supabase);
      return NextResponse.json({ ok: true, stats }, { headers });
    }

    const profile = await authenticatedProfile(req, supabase);
    if (!profile) return NextResponse.json({ error: 'Session invalide' }, { status: 401, headers });

    const rate = checkRateLimit(`send-push:${profile.id}`, 30, 60_000);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Trop de notifications envoyées. Réessayez dans quelques instants.' },
        { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    if (type === 'message-created' && !isSafeId(body.messageId)) {
      return NextResponse.json({ error: 'messageId invalide' }, { status: 400, headers });
    }
    if ((type === 'reserve-created' || type === 'reserve-status-changed') && !isSafeId(body.reserveId)) {
      return NextResponse.json({ error: 'reserveId invalide' }, { status: 400, headers });
    }

    let stats;
    if (type === 'message-created') stats = await pushForMessage(supabase, profile, body);
    else if (type === 'reserve-created') stats = await pushForReserve(supabase, profile, body, false);
    else if (type === 'reserve-status-changed') stats = await pushForReserve(supabase, profile, body, true);
    else return NextResponse.json({ error: `Type inconnu: ${type}` }, { status: 400, headers });

    return NextResponse.json({ ok: true, stats }, { headers });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    console.error('[send-push] Exception:', err?.message ?? err);
    return NextResponse.json({ ok: false, error: err?.message ?? 'Erreur serveur' }, { status, headers });
  }
}
