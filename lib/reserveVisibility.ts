import type { Company, Reserve, User } from '@/constants/types';

function normalize(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function reserveCompanyTokens(reserve: Pick<Reserve, 'company' | 'companies'>): string[] {
  const tokens = [
    ...(Array.isArray(reserve.companies) ? reserve.companies : []),
    reserve.company,
  ]
    .map(value => String(value ?? '').trim())
    .filter(Boolean);

  return Array.from(new Set(tokens));
}

export function reserveMatchesCompany(
  reserve: Pick<Reserve, 'company' | 'companies'>,
  company?: Pick<Company, 'id' | 'name'> | null,
): boolean {
  if (!company) return false;
  const companyId = String(company.id ?? '').trim();
  const companyName = normalize(company.name);
  if (!companyId && !companyName) return false;

  return reserveCompanyTokens(reserve).some(token => {
    const raw = String(token ?? '').trim();
    return raw === companyId || normalize(raw) === companyName;
  });
}

export function visibleReservesForUser<T extends Pick<Reserve, 'company' | 'companies'>>(
  reserves: T[],
  user: Pick<User, 'role' | 'companyId'> | null | undefined,
  companies: Array<Pick<Company, 'id' | 'name'>>,
): T[] {
  if (user?.role !== 'sous_traitant') return reserves;
  const company = companies.find(item => item.id === user.companyId);
  if (!company) return [];
  return reserves.filter(reserve => reserveMatchesCompany(reserve, company));
}
