import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/sender';
import { reserveOverdueEmail, reserveOverdueEscalationEmail, APP_URL } from '@/lib/templates';
import { buildReserveUrl } from '@/lib/reserve-token';

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO).getTime();
  const b = new Date(toISO).getTime();
  return Math.max(1, Math.round((b - a) / 86400000));
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Configuration manquante (SUPABASE_SERVICE_ROLE_KEY)' }, { status: 500 });
  }

  const today = todayISO();
  const stats = { scanned: 0, notified: 0, emailsSent: 0, errors: 0 };

  try {
    const { data: reserves, error: rErr } = await supabase
      .from('reserves')
      .select('id, title, priority, status, deadline, companies, company, chantier_id, organization_id, overdue_last_notified_date, overdue_reminder_count')
      .not('status', 'in', '(closed,verification)')
      .not('deadline', 'is', null)
      .lt('deadline', today);
    if (rErr) throw rErr;

    const list = reserves ?? [];
    stats.scanned = list.length;
    if (list.length === 0) return NextResponse.json({ ok: true, stats });

    const orgIds = Array.from(new Set(list.map((r: any) => r.organization_id).filter(Boolean)));
    const chantierIds = Array.from(new Set(list.map((r: any) => r.chantier_id).filter(Boolean)));

    const { data: companies } = await supabase
      .from('companies')
      .select('id, name, organization_id')
      .in('organization_id', orgIds.length ? orgIds : ['__none__']);

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, name, email, company_id, organization_id, role')
      .in('organization_id', orgIds.length ? orgIds : ['__none__']);

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
    for (const p of profiles ?? []) {
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

        const daysLate = daysBetween(r.deadline, today);

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
              const key = `${p.email.toLowerCase()}|${company.id}`;
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
              } as any);

              const sendRes = await sendEmail({
                to: p.email,
                subject: tpl.subject,
                html: tpl.html,
              });
              if (!sendRes.success) {
                stats.errors++;
                console.warn('[cron overdue] envoi échoué', p.email, sendRes.error);
              } else {
                stats.emailsSent++;
                sentForReserve++;
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
            const key = a.email.toLowerCase();
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
            });

            const sendRes = await sendEmail({
              to: a.email,
              subject: tpl.subject,
              html: tpl.html,
            });
            if (!sendRes.success) {
              stats.errors++;
              console.warn('[cron overdue] escalade échouée', a.email, sendRes.error);
            } else {
              stats.emailsSent++;
              sentForReserve++;
            }
          }
        }

        // Mise à jour du flag : compteur incrémenté (cap utile pour la phase escalade
        // qui continue à tourner sans dépasser la limite déjà atteinte).
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
        } else if (sentForReserve > 0) {
          stats.notified++;
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
