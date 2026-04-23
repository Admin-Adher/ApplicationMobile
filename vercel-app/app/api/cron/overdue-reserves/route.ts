import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { reserveOverdueEmail } from '@/lib/templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FROM_EMAIL = 'BuildTrack <onboarding@resend.dev>';

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

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

  const resend = getResend();
  const supabase = getServiceClient();
  if (!resend || !supabase) {
    return NextResponse.json({ error: 'Configuration manquante (RESEND_API_KEY ou SUPABASE_SERVICE_ROLE_KEY)' }, { status: 500 });
  }

  const today = todayISO();
  const stats = { scanned: 0, notified: 0, emailsSent: 0, errors: 0 };

  try {
    const { data: reserves, error: rErr } = await supabase
      .from('reserves')
      .select('id, title, priority, status, deadline, companies, company, chantier_id, organization_id, overdue_notified_for_deadline')
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
      .select('id, name, email, company_id, organization_id')
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
    for (const p of profiles ?? []) {
      if (!p.company_id || !p.email) continue;
      const arr = profilesByCompany.get(p.company_id) ?? [];
      arr.push(p);
      profilesByCompany.set(p.company_id, arr);
    }
    const chantierName = new Map<string, string>();
    for (const c of chantiers ?? []) chantierName.set(c.id, c.name);

    for (const r of list) {
      try {
        if (r.overdue_notified_for_deadline === r.deadline) continue;

        const reserveCompanyNames: string[] = (r.companies ?? (r.company ? [r.company] : [])) as string[];
        if (reserveCompanyNames.length === 0) continue;

        const orgCompanies = companiesByOrg.get(r.organization_id) ?? [];
        const matchedCompanies = orgCompanies.filter((c: any) =>
          reserveCompanyNames.some(n => n.trim().toLowerCase() === c.name.trim().toLowerCase())
        );
        if (matchedCompanies.length === 0) continue;

        const daysLate = daysBetween(r.deadline, today);
        const sentEmails = new Set<string>();

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
            });

            const { error: sendErr } = await resend.emails.send({
              from: FROM_EMAIL,
              to: p.email,
              subject: tpl.subject,
              html: tpl.html,
            });
            if (sendErr) {
              stats.errors++;
              console.warn('[cron overdue] envoi échoué', p.email, sendErr.message);
            } else {
              stats.emailsSent++;
            }
          }
        }

        const { error: upErr } = await supabase
          .from('reserves')
          .update({ overdue_notified_for_deadline: r.deadline })
          .eq('id', r.id);
        if (upErr) {
          stats.errors++;
          console.warn('[cron overdue] update flag échoué', r.id, upErr.message);
        } else {
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
