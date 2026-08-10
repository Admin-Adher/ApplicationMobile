import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/sender';
import { reserveOverdueEmail, reserveOverdueEscalationEmail, APP_URL } from '@/lib/templates';
import { buildReserveUrl } from '@/lib/reserve-token';
import { withUnsubscribeFooter, listUnsubscribeHeaders } from '@/lib/emailOptout';
import { createServiceClient, getOrganizationUsers } from '@/lib/server-auth';

// Journal durable des envois (table email_notification_log) : dédupe les
// relances entre exécutions du cron (relance Vercel, échec d'update du flag
// sur la réserve, double déclenchement) — la dédup en mémoire ne couvre
// qu'une seule exécution.
async function sentLogForToday(supabase: any, today: string): Promise<Set<string>> {
  const sent = new Set<string>();
  try {
    const { data, error } = await supabase
      .from('email_notification_log')
      .select('notification_type, recipient_email, reserve_id')
      .eq('event_key', today);
    if (error) {
      console.warn('[cron overdue] lecture email_notification_log impossible:', error.message);
      return sent;
    }
    for (const row of data ?? []) {
      sent.add(`${row.notification_type}|${String(row.recipient_email ?? '').toLowerCase()}|${row.reserve_id ?? ''}`);
    }
  } catch {}
  return sent;
}

async function recordSentLog(
  supabase: any,
  today: string,
  notificationType: string,
  recipientEmail: string,
  reserveId: string,
) {
  try {
    const { error } = await supabase.from('email_notification_log').insert({
      notification_type: notificationType,
      recipient_email: recipientEmail.toLowerCase(),
      reserve_id: reserveId,
      event_key: today,
    });
    // Conflit d'index unique = déjà journalisé par une exécution concurrente : bénin.
    if (error && !String(error.message ?? '').toLowerCase().includes('duplicate')) {
      console.warn('[cron overdue] journalisation envoi impossible:', error.message);
    }
  } catch {}
}

async function optedOutEmails(supabase: any): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const { data, error } = await supabase.from('email_optouts').select('email');
    if (error) {
      console.warn('[cron overdue] lecture email_optouts impossible:', error.message);
      return set;
    }
    for (const row of data ?? []) set.add(String(row.email ?? '').toLowerCase());
  } catch {}
  return set;
}

const SUBCONTRACTOR_REMINDER_LIMIT = 7; // après N rappels quotidiens, on escalade aux admins

function safeReserveUrl(reserveId: string, email: string): string {
  try {
    return buildReserveUrl(APP_URL, reserveId, email);
  } catch (e: any) {
    console.warn('[cron overdue] reserveUrl signature impossible:', e?.message);
    return `${APP_URL}/reserve/${encodeURIComponent(reserveId)}`;
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function getServiceClient() {
  return createServiceClient();
}

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

// Les deadlines sont du texte dans 2 formats : ISO `yyyy-mm-dd` (web) et
// FR `dd/mm/yyyy` (mobile), plus des sentinelles ('—', mojibake). On parse
// les deux formats ; toute valeur non reconnue est ignorée.
function parseDeadline(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '—' || raw === 'â€”') return null;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function overdueEmailAllowed(pref: any, critical = false) {
  if (!pref) return true;
  if (pref.email_enabled === false) return false;
  const criticalAllowed = critical && pref.reserve_critical_email !== false;
  if (pref.reserve_overdue_email === false && !criticalAllowed) return false;
  return true;
}

async function preferencesForProfiles(supabase: any, profileIds: string[]) {
  const ids = Array.from(new Set((profileIds ?? []).filter(Boolean)));
  const map = new Map<string, any>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('user_id, email_enabled, reserve_overdue_email, reserve_critical_email')
    .in('user_id', ids);
  if (error) {
    console.warn('[cron overdue] preferences indisponibles:', error.message);
    return map;
  }
  for (const row of data ?? []) map.set(row.user_id, row);
  return map;
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Configuration manquante (SUPABASE_SERVICE_ROLE_KEY)' }, { status: 500 });
  }

  const today = todayISO();
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const stats = { scanned: 0, notified: 0, emailsSent: 0, errors: 0 };

  try {
    // La colonne deadline est du texte multi-format : pas de comparaison SQL
    // fiable possible, on récupère les réserves ouvertes et on filtre en JS.
    const { data: reserves, error: rErr } = await supabase
      .from('reserves')
      .select('id, title, priority, status, deadline, companies, company, chantier_id, organization_id, overdue_last_notified_date, overdue_reminder_count')
      .not('status', 'in', '(closed,verification)')
      .not('deadline', 'is', null);
    if (rErr) throw rErr;

    const list = (reserves ?? []).filter((r: any) => {
      const deadlineDate = parseDeadline(r.deadline);
      return deadlineDate !== null && deadlineDate.getTime() < todayMs;
    });
    stats.scanned = list.length;
    if (list.length === 0) return NextResponse.json({ ok: true, stats });

    const orgIds = Array.from(new Set(list.map((r: any) => r.organization_id).filter(Boolean)));
    const chantierIds = Array.from(new Set(list.map((r: any) => r.chantier_id).filter(Boolean)));

    const { data: companies } = await supabase
      .from('companies')
      .select('id, name, organization_id')
      .in('organization_id', orgIds.length ? orgIds : ['__none__']);

    const profiles = (await Promise.all(
      orgIds.map((organizationId: string) => getOrganizationUsers(supabase, organizationId)),
    )).flat().map(profile => ({
      id: profile.id,
      name: profile.name,
      email: profile.email,
      company_id: profile.companyId,
      organization_id: profile.organizationId,
      role: profile.role,
      preferred_language: profile.preferredLanguage,
    }));
    const prefsByUser = await preferencesForProfiles(supabase, profiles.map((p: any) => p.id));

    const { data: chantiers } = chantierIds.length
      ? await supabase.from('chantiers').select('id, name').in('id', chantierIds)
      : { data: [] as any[] };

    const companiesByOrg = new Map<string, any[]>();
    for (const c of companies ?? []) {
      const arr = companiesByOrg.get(c.organization_id) ?? [];
      arr.push(c);
      companiesByOrg.set(c.organization_id, arr);
    }
    const profilesByCompany = new Map<string, any[]>();
    const adminsByOrg = new Map<string, any[]>();
    for (const p of profiles) {
      if (!p.email) continue;
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
    const chantierName = new Map<string, string>();
    for (const c of chantiers ?? []) chantierName.set(c.id, c.name);

    const [alreadySent, optouts] = await Promise.all([
      sentLogForToday(supabase, today),
      optedOutEmails(supabase),
    ]);

    // Date d'hier (pour détecter les ruptures de série → reset compteur)
    const yesterdayD = new Date();
    yesterdayD.setHours(0, 0, 0, 0);
    yesterdayD.setDate(yesterdayD.getDate() - 1);
    const yesterday = yesterdayD.toISOString().split('T')[0];

    for (const r of list) {
      try {
        // Rappel quotidien : 1 seul envoi par jour max (idempotent).
        if (r.overdue_last_notified_date === today) continue;

        const reserveCompanyNames: string[] = (r.companies ?? (r.company ? [r.company] : [])) as string[];
        if (reserveCompanyNames.length === 0) continue;

        const orgCompanies = companiesByOrg.get(r.organization_id) ?? [];
        const matchedCompanies = orgCompanies.filter((c: any) =>
          reserveCompanyNames.some(n => n.trim().toLowerCase() === c.name.trim().toLowerCase())
        );
        if (matchedCompanies.length === 0) continue;

        const deadlineDate = parseDeadline(r.deadline)!;
        const daysLate = Math.max(1, Math.round((todayMs - deadlineDate.getTime()) / 86400000));

        // Si la réserve n'a pas été notifiée hier (ou jamais), on remet le compteur à 0
        // (cas d'une réserve qui sort/rentre du retard via modification de l'échéance).
        const previousCount: number =
          (typeof r.overdue_reminder_count === 'number' ? r.overdue_reminder_count : 0);
        const continuingStreak =
          r.overdue_last_notified_date === yesterday || r.overdue_last_notified_date === today;
        const reminderCount = continuingStreak ? previousCount : 0;
        const escalate = reminderCount >= SUBCONTRACTOR_REMINDER_LIMIT;

        const sentEmails = new Set<string>();
        let sentForReserve = 0;

        if (!escalate) {
          // ── Phase 1 : rappel quotidien aux destinataires des entreprises concernées ──
          for (const company of matchedCompanies) {
            const recipients = profilesByCompany.get(company.id) ?? [];
            for (const p of recipients) {
              if (!overdueEmailAllowed(prefsByUser.get(p.id), r.priority === 'critical')) continue;
              const emailLower = p.email.toLowerCase();
              if (optouts.has(emailLower)) continue;
              if (alreadySent.has(`reserve-overdue|${emailLower}|${r.id}`)) continue;
              const key = `${emailLower}|${company.id}`;
              if (sentEmails.has(key)) continue;
              sentEmails.add(key);

              const tpl = reserveOverdueEmail({
                recipientName: p.name || p.email,
                reserveTitle: r.title,
                reserveId: r.id,
                deadline: r.deadline,
                daysLate,
                priority: r.priority,
                companyName: company.name,
                chantierName: r.chantier_id ? chantierName.get(r.chantier_id) : undefined,
                reserveCode: r.id,
                reserveUrl: safeReserveUrl(r.id, p.email),
                language: p.preferred_language,
              } as any);

              const sendRes = await sendEmail({
                to: p.email,
                subject: tpl.subject,
                html: withUnsubscribeFooter(tpl.html, APP_URL, p.email, p.preferred_language),
                headers: listUnsubscribeHeaders(APP_URL, p.email),
              });
              if (!sendRes.success) {
                stats.errors++;
                console.warn('[cron overdue] envoi échoué', p.email, sendRes.error);
              } else {
                stats.emailsSent++;
                sentForReserve++;
                alreadySent.add(`reserve-overdue|${emailLower}|${r.id}`);
                await recordSentLog(supabase, today, 'reserve-overdue', p.email, r.id);
              }
            }
          }
        } else {
          // ── Phase 2 : escalade aux administrateurs de l'organisation ──
          const admins = adminsByOrg.get(r.organization_id) ?? [];
          if (admins.length === 0) {
            console.warn('[cron overdue] escalade impossible — aucun admin pour org', r.organization_id);
          }
          const escalationCompanyName = matchedCompanies.map((c: any) => c.name).join(', ');
          for (const a of admins) {
            if (!overdueEmailAllowed(prefsByUser.get(a.id), r.priority === 'critical')) continue;
            const key = a.email.toLowerCase();
            if (optouts.has(key)) continue;
            if (alreadySent.has(`reserve-overdue-escalation|${key}|${r.id}`)) continue;
            if (sentEmails.has(key)) continue;
            sentEmails.add(key);

            const tpl = reserveOverdueEscalationEmail({
              recipientName: a.name || a.email,
              reserveTitle: r.title,
              reserveId: r.id,
              deadline: r.deadline,
              daysLate,
              reminderDays: reminderCount,
              priority: r.priority,
              companyName: escalationCompanyName,
              chantierName: r.chantier_id ? chantierName.get(r.chantier_id) : undefined,
              reserveCode: r.id,
              reserveUrl: safeReserveUrl(r.id, a.email),
              language: a.preferred_language,
            });

            const sendRes = await sendEmail({
              to: a.email,
              subject: tpl.subject,
              html: withUnsubscribeFooter(tpl.html, APP_URL, a.email, a.preferred_language),
              headers: listUnsubscribeHeaders(APP_URL, a.email),
            });
            if (!sendRes.success) {
              stats.errors++;
              console.warn('[cron overdue] escalade échouée', a.email, sendRes.error);
            } else {
              stats.emailsSent++;
              sentForReserve++;
              alreadySent.add(`reserve-overdue-escalation|${key}|${r.id}`);
              await recordSentLog(supabase, today, 'reserve-overdue-escalation', a.email, r.id);
            }
          }
        }

        // Mise à jour du flag : compteur incrémenté (cap utile pour la phase escalade
        // qui continue à tourner sans dépasser la limite déjà atteinte).
        if (sentForReserve > 0) {
          const nextCount = escalate ? reminderCount : reminderCount + 1;
          const { error: upErr } = await supabase
            .from('reserves')
            .update({
              overdue_last_notified_date: today,
              overdue_reminder_count: nextCount,
            })
            .eq('id', r.id);
          if (upErr) {
            stats.errors++;
            console.warn('[cron overdue] update flag échoué', r.id, upErr.message);
          } else {
            stats.notified++;
          }
        }
      } catch (err: any) {
        stats.errors++;
        console.warn('[cron overdue] réserve', r.id, err?.message ?? err);
      }
    }

    return NextResponse.json({ ok: true, stats });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err), stats }, { status: 500 });
  }
}
