import { reservePriorityLabel, reserveStatusLabel, type TFunc } from './reportLabels';
import { activeReportReserves } from './reportReserveScope';

export function buildCsvReport(reserves: any[], t: TFunc, locale: string): string {
  const localizedDate = (value?: string | null) => {
    if (!value || value === '—') return value ?? '';
    const frenchDate = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    const parsed = frenchDate
      ? new Date(Number(frenchDate[3]), Number(frenchDate[2]) - 1, Number(frenchDate[1]))
      : new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(locale);
  };
  const header = ['ID', t('reportsPdf.title'), t('reportsPdf.status'), t('reportsPdf.priority'), t('reportsPdf.building'), t('reportsPdf.zone'), t('reportsPdf.level'), t('reportsPdf.company'), t('reportsPdf.createdDate'), t('reportsPdf.deadline'), t('reportsPdf.closedDate'), t('reportsPdf.closedBy')];
  const rows = activeReportReserves(reserves).map(r => [
    r.id, r.title, reserveStatusLabel(t, r.status), reservePriorityLabel(t, r.priority),
    r.building, r.zone, r.level, r.company, localizedDate(r.createdAt), localizedDate(r.deadline),
    localizedDate(r.closedAt), r.closedBy,
  ]);
  const escapeCell = (value: unknown) => {
    const text = String(value ?? '');
    const safe = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
    return '"' + safe.replace(/"/g, '""') + '"';
  };
  return [header, ...rows].map(row => row.map(escapeCell).join(';')).join('\r\n');
}
