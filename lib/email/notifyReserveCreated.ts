import { sendReserveCreatedEmail } from './client';
import type { Reserve, Profile, Company, Chantier } from '@/constants/types';

export function notifyReserveCreated(params: {
  reserve: Reserve;
  selectedCompanyNames: string[];
  companies: Company[];
  profiles: Profile[];
  chantiers: Chantier[];
  createdByName: string;
}): void {
  const { reserve, selectedCompanyNames, companies, profiles, chantiers, createdByName } = params;
  try {
    const matchedCompanies = companies.filter(c =>
      selectedCompanyNames.some(n => n.trim().toLowerCase() === c.name.trim().toLowerCase())
    );
    if (matchedCompanies.length === 0) return;

    const chantier = reserve.chantierId ? chantiers.find(c => c.id === reserve.chantierId) : undefined;
    const deadline = !reserve.deadline || reserve.deadline === '—' ? null : reserve.deadline;

    const sent = new Set<string>();
    for (const company of matchedCompanies) {
      const recipients = profiles.filter(p => p.companyId === company.id && !!p.email);
      for (const p of recipients) {
        const key = `${p.email.toLowerCase()}|${company.id}`;
        if (sent.has(key)) continue;
        sent.add(key);
        void sendReserveCreatedEmail({
          email: p.email,
          recipientName: p.name || p.email,
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
    }
  } catch (err: any) {
    console.warn('[notifyReserveCreated] erreur:', err?.message ?? err);
  }
}
