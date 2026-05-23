import type { Reserve } from '@/constants/types';
import { C } from '@/constants/colors';

export type EnterpriseWorkflowFilter = 'all' | 'needs_validation' | 'ack_missing' | 'ack_done' | 'signed';

export type EnterpriseWorkflowBadge = {
  key: string;
  label: string;
  icon: string;
  color: string;
  bg: string;
  border: string;
};

export const ENTERPRISE_WORKFLOW_FILTERS: {
  key: EnterpriseWorkflowFilter;
  label: string;
  icon: string;
  color: string;
}[] = [
  { key: 'all', label: 'Tous suivis', icon: 'layers-outline', color: C.primary },
  { key: 'needs_validation', label: '\u00c0 valider', icon: 'shield-checkmark-outline', color: C.verification },
  { key: 'ack_missing', label: 'AR manquant', icon: 'mail-unread-outline', color: '#B45309' },
  { key: 'ack_done', label: 'AR re\u00e7us', icon: 'mail-open-outline', color: C.closed },
  { key: 'signed', label: 'Sign\u00e9es', icon: 'create-outline', color: '#0EA5E9' },
];

export function getReserveCompanyNames(reserve: Reserve): string[] {
  const names = reserve.companies && reserve.companies.length > 0
    ? reserve.companies
    : reserve.company ? [reserve.company] : [];
  return names.map(name => name.trim()).filter(name => name.length > 0 && name !== '\u2014');
}

export function getReserveSignedCompanyCount(reserve: Reserve): number {
  return Object.keys(reserve.companySignatures ?? {}).length;
}

export function hasReserveEnterpriseSignature(reserve: Reserve): boolean {
  return Boolean(reserve.enterpriseSignature) || getReserveSignedCompanyCount(reserve) > 0;
}

export function isEnterpriseWorkflowActive(reserve: Reserve): boolean {
  return !reserve.archivedAt && reserve.status !== 'closed' && getReserveCompanyNames(reserve).length > 0;
}

export function matchesEnterpriseWorkflowFilter(reserve: Reserve, filter: EnterpriseWorkflowFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'needs_validation') return reserve.status === 'verification';
  if (filter === 'ack_missing') return isEnterpriseWorkflowActive(reserve) && !reserve.enterpriseAcknowledgedAt;
  if (filter === 'ack_done') return Boolean(reserve.enterpriseAcknowledgedAt);
  if (filter === 'signed') return hasReserveEnterpriseSignature(reserve);
  return true;
}

export function getEnterpriseWorkflowBadges(
  reserve: Reserve,
  options: { attentionOnly?: boolean } = {},
): EnterpriseWorkflowBadge[] {
  const badges: EnterpriseWorkflowBadge[] = [];
  const companyNames = getReserveCompanyNames(reserve);
  const signedCount = getReserveSignedCompanyCount(reserve);
  const hasSignature = hasReserveEnterpriseSignature(reserve);
  const workflowActive = isEnterpriseWorkflowActive(reserve);

  if (reserve.status === 'verification') {
    badges.push({
      key: 'needs_validation',
      label: 'Lev\u00e9e demand\u00e9e',
      icon: 'shield-checkmark-outline',
      color: C.verification,
      bg: C.verificationBg,
      border: C.verification + '35',
    });
  }

  if (!options.attentionOnly && workflowActive && reserve.enterpriseAcknowledgedAt) {
    badges.push({
      key: 'ack_done',
      label: 'AR re\u00e7u',
      icon: 'mail-open-outline',
      color: C.closed,
      bg: C.closedBg,
      border: C.closed + '35',
    });
  } else if (workflowActive) {
    badges.push({
      key: 'ack_missing',
      label: 'AR manquant',
      icon: 'mail-unread-outline',
      color: '#B45309',
      bg: '#FFFBEB',
      border: '#FDE68A',
    });
  }

  if (!options.attentionOnly && hasSignature) {
    const label = companyNames.length > 1 && signedCount > 0
      ? `Sign\u00e9e ${signedCount}/${companyNames.length}`
      : 'Sign\u00e9e';
    badges.push({
      key: 'signed',
      label,
      icon: 'create-outline',
      color: '#0EA5E9',
      bg: '#E0F2FE',
      border: '#7DD3FC',
    });
  }

  return badges;
}

export function getEnterpriseWorkflowStats(reserves: Reserve[]) {
  const activeAssigned = reserves.filter(isEnterpriseWorkflowActive);
  return {
    all: reserves.length,
    needs_validation: reserves.filter(r => r.status === 'verification').length,
    ack_missing: activeAssigned.filter(r => !r.enterpriseAcknowledgedAt).length,
    ack_done: reserves.filter(r => Boolean(r.enterpriseAcknowledgedAt)).length,
    signed: reserves.filter(hasReserveEnterpriseSignature).length,
  } satisfies Record<EnterpriseWorkflowFilter, number>;
}
