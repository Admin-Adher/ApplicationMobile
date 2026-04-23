import { sendReserveCreatedEmail, sendReserveStatusChangedEmail, sendReserveOverdueEmail } from './client';
import type { Reserve, Profile, Company, Chantier, ReserveStatus } from '@/constants/types';

function recipientsForReserve(
  reserve: Reserve,
  companies: Company[],
  profiles: Profile[]
): Array<{ profile: Profile; company: Company }> {
  const names = reserve.companies ?? (reserve.company ? [reserve.company] : []);
  if (names.length === 0) return [];
  const matched = companies.filter(c =>
    names.some(n => n.trim().toLowerCase() === c.name.trim().toLowerCase())
  );
  const sent = new Set<string>();
  const out: Array<{ profile: Profile; company: Company }> = [];
  for (const company of matched) {
    const recipients = profiles.filter(p => p.companyId === company.id && !!p.email);
    for (const profile of recipients) {
      const key = `${profile.email.toLowerCase()}|${company.id}`;
      if (sent.has(key)) continue;
      sent.add(key);
      out.push({ profile, company });
    }
  }
  return out;
}

export function notifyReserveCreated(params: {
  reserve: Reserve;
  selectedCompanyNames: string[];
  companies: Company[];
  profiles: Profile[];
  chantiers: Chantier[];
  createdByName: string;
}): void {
  const { reserve, companies, profiles, chantiers, createdByName } = params;
  try {
    const chantier = reserve.chantierId ? chantiers.find(c => c.id === reserve.chantierId) : undefined;
    const deadline = !reserve.deadline || reserve.deadline === '—' ? null : reserve.deadline;
    const recipients = recipientsForReserve(reserve, companies, profiles);
    for (const { profile, company } of recipients) {
      void sendReserveCreatedEmail({
        email: profile.email,
        recipientName: profile.name || profile.email,
        reserveTitle: reserve.title,
        reserveId: reserve.id,
        priority: reserve.priority,
        deadline,
        building: reserve.building,
        level: reserve.level,
        zone: reserve.zone,
        description: reserve.description,
        chantierName: chantier?.name,
        companyName: company.name,
        createdBy: createdByName,
        reserveCode: reserve.id,
      });
    }
  } catch (err: any) {
    console.warn('[notifyReserveCreated] erreur:', err?.message ?? err);
  }
}

export function notifyReserveStatusChanged(params: {
  reserve: Reserve;
  newStatus: ReserveStatus;
  previousStatus?: ReserveStatus;
  companies: Company[];
  profiles: Profile[];
  chantiers: Chantier[];
  changedByName: string;
}): void {
  const { reserve, newStatus, previousStatus, companies, profiles, chantiers, changedByName } = params;
  try {
    if (previousStatus && previousStatus === newStatus) return;
    const chantier = reserve.chantierId ? chantiers.find(c => c.id === reserve.chantierId) : undefined;
    const recipients = recipientsForReserve(reserve, companies, profiles);
    for (const { profile, company } of recipients) {
      void sendReserveStatusChangedEmail({
        email: profile.email,
        recipientName: profile.name || profile.email,
        reserveTitle: reserve.title,
        reserveId: reserve.id,
        newStatus,
        previousStatus,
        changedBy: changedByName,
        companyName: company.name,
        chantierName: chantier?.name,
        reserveCode: reserve.id,
      });
    }
  } catch (err: any) {
    console.warn('[notifyReserveStatusChanged] erreur:', err?.message ?? err);
  }
}

export function notifyReserveOverdue(params: {
  reserve: Reserve;
  daysLate: number;
  companies: Company[];
  profiles: Profile[];
  chantiers: Chantier[];
}): void {
  const { reserve, daysLate, companies, profiles, chantiers } = params;
  try {
    if (!reserve.deadline || reserve.deadline === '—') return;
    const chantier = reserve.chantierId ? chantiers.find(c => c.id === reserve.chantierId) : undefined;
    const recipients = recipientsForReserve(reserve, companies, profiles);
    for (const { profile, company } of recipients) {
      void sendReserveOverdueEmail({
        email: profile.email,
        recipientName: profile.name || profile.email,
        reserveTitle: reserve.title,
        reserveId: reserve.id,
        deadline: reserve.deadline,
        daysLate,
        priority: reserve.priority,
        companyName: company.name,
        chantierName: chantier?.name,
        reserveCode: reserve.id,
      });
    }
  } catch (err: any) {
    console.warn('[notifyReserveOverdue] erreur:', err?.message ?? err);
  }
}
