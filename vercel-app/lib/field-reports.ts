import { buildCompanyReserveHTML, buildDailyHTML, buildIncidentHTML, buildWeeklyHTML } from '../../lib/fieldReportHtml';
import { fieldReportTranslator } from './field-report-translation';
import { toCompany, toReserve, toTask } from '../../lib/mappers';
import { getISOWeek } from '../../lib/utils';
import { buildMeetingHTML } from '../../lib/meetingReportHtml';
import { localeForLang, normalizeLang } from './i18n';
import { activeReportReserves } from '../../lib/reportReserveScope';

export const FIELD_REPORT_TYPES = ['daily', 'weekly', 'incident', 'company_slip', 'meeting'] as const;
export type FieldReportType = typeof FIELD_REPORT_TYPES[number];

export function isFieldReportType(type: string): type is FieldReportType {
  return FIELD_REPORT_TYPES.some(value => value === type);
}

export function validFieldReportPayload(type: FieldReportType, payload: any) {
  const row = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value);
  const rows = (value: unknown, limit: number) => Array.isArray(value) && value.length <= limit && value.every(row);
  if (typeof payload.chantierName !== 'string' || !payload.chantierName.trim() || payload.sendByEmail) return false;
  if (type === 'meeting') {
    const meeting = payload.meeting;
    return row(meeting) && ['id', 'subject', 'date', 'participants', 'agenda'].every(key => typeof meeting[key] === 'string')
      && Array.isArray(meeting.decisions) && meeting.decisions.length <= 1000 && rows(meeting.actions, 1000)
      && rows(payload.companies, 500);
  }
  if (type === 'incident') return row(payload.incident);
  if (!rows(payload.reserves, 10000)) return false;
  if (type === 'company_slip') return typeof payload.company?.name === 'string';
  return rows(payload.companies, 500) && rows(payload.tasks, 5000) && rows(payload.incidents, 5000);
}

export async function buildFieldReportHtml(type: FieldReportType, payload: any) {
  const language = normalizeLang(payload.language);
  const locale = localeForLang(language);
  const t = fieldReportTranslator(language);
  const project = payload.chantierName;
  if (type === 'meeting') return buildMeetingHTML(payload.meeting, project, payload.companies, t, locale);
  const incidentView = (row: any) => ({
    ...row,
    reportedAt: row.reported_at,
    reportedBy: row.reported_by,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  });
  if (type === 'incident') return buildIncidentHTML(incidentView(payload.incident), project, t, locale);

  const reserves = activeReportReserves<any>(payload.reserves).map(toReserve) as ReturnType<typeof toReserve>[];
  if (type === 'company_slip') {
    return buildCompanyReserveHTML(toCompany(payload.company), reserves, project, t, locale, async uri =>
      typeof uri === 'string' && /^https:\/\//i.test(uri) ? uri : null);
  }

  const companies = payload.companies.map(toCompany);
  const tasks = payload.tasks.map(toTask);
  const incidents = payload.incidents.map(incidentView);
  const author = typeof payload.author === 'string' ? payload.author : 'BuildTrack';
  const countStatus = (status: string) => reserves.filter(reserve => reserve.status === status).length;
  const closed = countStatus('closed');
  const stats = {
    total: reserves.length, closed, open: countStatus('open'), inProgress: countStatus('in_progress'),
    waiting: countStatus('waiting'), verification: countStatus('verification'),
    progress: reserves.length ? Math.round(100 * closed / reserves.length) : 0,
  };
  return type === 'daily'
    ? buildDailyHTML(reserves, companies, tasks, incidents, stats, author, project, t, locale)
    : buildWeeklyHTML(reserves, companies, tasks, incidents, stats, author, getISOWeek(new Date()), project, t, locale);
}
