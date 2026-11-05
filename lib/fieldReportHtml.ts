import { reservePriorityLabel, reserveStatusLabel, type TFunc } from './reportLabels';
export type { TFunc } from './reportLabels';
import { getPdfCompanyPalette, renderPdfCompanyLabel, renderPdfReserveCompanies } from './pdfCompanyColors';
import { getReserveCompanyNames } from './planPinColor';
import { buildLetterhead, buildKpiRow, buildDocFooter, wrapHTML, buildInfoGrid, escapeHtml } from './pdfHtml';
import { buildPhotoAnnotationsOverlayHtml, formatReserveLocation, getReservePdfPhotos } from './pdfReserveHelpers';
import { RESERVE_PRIORITY_COLORS, RESERVE_STATUS_COLORS } from './reserveLabels';
import { getReserveDescriptionText, hasCustomReserveDescription } from './reserveDescription';
import { reserveMatchesCompany } from './reserveVisibility';

export function incidentSeverityLabel(t: TFunc, severity: string): string {
  return t(`reportsScreen.severity.${severity}`, { defaultValue: severity });
}

function incidentStatusLabel(t: TFunc, status: string): string {
  return t(`reportsScreen.incidentStatus.${status}`, { defaultValue: status });
}

function buildLotSummaryRows(reserves: any[], companies: any[], t: TFunc): string {
  const palette = getPdfCompanyPalette(companies);
  const companyNames = [...new Set(reserves.flatMap(getReserveCompanyNames))];
  return companyNames.map(name => {
    const co = companies.find((c: any) => c.name === name);
    const coReserves = co
      ? reserves.filter((r: any) => reserveMatchesCompany(r, co))
      : reserves.filter(r => getReserveCompanyNames(r).includes(name));
    const open = coReserves.filter((r: any) => r.status !== 'closed').length;
    const closed = coReserves.filter((r: any) => r.status === 'closed').length;
    const pct = coReserves.length > 0 ? Math.round((closed / coReserves.length) * 100) : 0;
    const barColor = pct >= 80 ? '#059669' : pct >= 40 ? '#F59E0B' : '#DC2626';
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:600">${renderPdfCompanyLabel(name, palette)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;font-weight:700;color:#003082">${coReserves.length}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;color:#DC2626;font-weight:700">${open}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;color:#059669;font-weight:700">${closed}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;background:#EEF3FA;border-radius:4px;height:8px;overflow:hidden">
            <div style="background:${barColor};height:8px;width:${pct}%"></div>
          </div>
          <span style="font-size:10px;font-weight:700;color:${barColor};min-width:28px">${pct}%</span>
        </div>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" style="padding:12px;text-align:center;color:#059669">${escapeHtml(t('reportsPdf.noReserve'))}</td></tr>`;
}

export function buildDailyHTML(reserves: any[], companies: any[], tasks: any[], incidents: any[], stats: any, userName: string, projectName: string, t: TFunc, locale = 'fr-FR'): string {
  const now = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString(locale);
  const palette = getPdfCompanyPalette(companies);
  const docRef = `RJ-${today.replace(/\//g, '')}`;

  const severityColors: Record<string, string> = { minor: '#6B7280', moderate: '#F59E0B', major: '#EF4444', critical: '#7F1D1D' };
  const statusColors = RESERVE_STATUS_COLORS as Record<string, string>;
  const pColor = RESERVE_PRIORITY_COLORS as Record<string, string>;
  const openIncidents = incidents.filter((i: any) => i.status !== 'resolved');
  const activeReserves = reserves.filter((r: any) => r.status !== 'closed');
  const totalWorkers = companies.reduce((s: number, c: any) => s + (Number(c.actualWorkers) || 0), 0);

  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;vertical-align:top';

  const personnelRows = companies.map((c: any) =>
    `<tr><td style="${tdS}">${renderPdfCompanyLabel(c.name, palette)}</td><td style="${tdS};text-align:center;font-weight:700">${Number(c.actualWorkers) || 0}</td><td style="${tdS};text-align:center">${Number(c.plannedWorkers) || 0}</td><td style="${tdS};text-align:center;color:${c.actualWorkers >= c.plannedWorkers ? '#059669' : '#DC2626'}">${c.actualWorkers >= c.plannedWorkers ? '✓' : '↓'}</td></tr>`
  ).join('');

  const taskRows = tasks.filter((t: any) => t.status === 'in_progress').map((t: any) =>
    `<tr><td style="${tdS}">${escapeHtml(t.title)}</td><td style="${tdS}">${escapeHtml(t.assignee)}</td><td style="${tdS};text-align:center">
      <div style="background:#E8F0FE;border-radius:4px;height:8px;width:100%;margin-bottom:3px"><div style="background:#003082;height:8px;border-radius:4px;width:${Math.max(0, Math.min(100, Number(t.progress) || 0))}%"></div></div>
      <span style="font-size:10px;color:#003082;font-weight:700">${Math.max(0, Math.min(100, Number(t.progress) || 0))}%</span>
    </td><td style="${tdS}">${escapeHtml(t.deadline)}</td></tr>`
  ).join('');

  const incidentRows = openIncidents.map((i: any) =>
    `<tr><td style="${tdS}"><span style="color:${severityColors[i.severity] || '#000'};font-weight:700">${escapeHtml(incidentSeverityLabel(t, i.severity))}</span></td>
      <td style="${tdS}">${escapeHtml(i.title)}</td><td style="${tdS}">Bât. ${escapeHtml(i.building)} — ${escapeHtml(i.location)}</td>
      <td style="${tdS}">${escapeHtml(incidentStatusLabel(t, i.status))}</td>
      <td style="${tdS}">${escapeHtml(i.reportedAt)}</td><td style="${tdS}">${escapeHtml(i.reportedBy)}</td></tr>`
  ).join('');

  const reserveRows = activeReserves.map((r: any) =>
    `<tr><td style="${tdS};font-weight:700;font-size:10px">${escapeHtml(r.id)}</td>
      <td style="${tdS}">${escapeHtml(r.title)}</td>
      <td style="${tdS}">${escapeHtml(formatReserveLocation(r))}</td>
      <td style="${tdS}">${renderPdfReserveCompanies(r, palette)}</td>
      <td style="${tdS}"><span style="color:${pColor[r.priority] || '#000'};font-weight:700">${escapeHtml(reservePriorityLabel(t, r.priority))}</span></td>
      <td style="${tdS}"><span style="color:${statusColors[r.status] || '#000'}">${escapeHtml(reserveStatusLabel(t, r.status))}</span></td>
      <td style="${tdS}">${escapeHtml(r.deadline)}</td></tr>`
  ).join('');

  const incidentAlert = openIncidents.length > 0
    ? `<div class="alert alert-danger">⚠️ <strong>${escapeHtml(t('reportsPdf.openIncidentsAlert', { count: openIncidents.length }))}</strong> — ${escapeHtml(t('reportsPdf.priorityTreatment'))}</div>`
    : `<div class="alert alert-success">✅ ${escapeHtml(t('reportsPdf.safeSite'))}</div>`;

  const body = `
    ${buildLetterhead(t('reportsScreen.dailyReport'), now, docRef, today, projectName)}
    <div style="font-size:10px;color:#6B7280;margin-top:-16px;margin-bottom:20px">${escapeHtml(t('reportsPdf.writtenBy'))} : <strong style="color:#1A2742">${escapeHtml(userName)}</strong></div>
    ${incidentAlert}
    ${buildKpiRow([
      { val: stats.total, label: t('reportsScreen.totalReserves'), color: '#003082' },
      { val: stats.open + stats.inProgress, label: t('reportsScreen.inProgress'), color: '#F59E0B' },
      { val: stats.closed, label: t('reportsScreen.closed'), color: '#059669' },
      { val: stats.progress + '%', label: t('reportsScreen.closureRate'), color: '#003082' },
      { val: openIncidents.length, label: t('reportsScreen.openIncidents'), color: openIncidents.length > 0 ? '#DC2626' : '#059669' },
      { val: totalWorkers, label: t('reportsScreen.presentWorkforce'), color: '#1A2742' },
    ])}
    <div style="background:#E8F0FE;border-radius:6px;height:12px;margin:8px 0 4px;overflow:hidden"><div style="background:#003082;height:12px;border-radius:6px;width:${stats.progress}%"></div></div>
    <div style="font-size:10px;color:#003082;font-weight:700;text-align:right;margin-bottom:20px">${escapeHtml(t('reportsPdf.globalClosure', { progress: stats.progress }))}</div>

    <div class="section-header">${escapeHtml(t('reportsPdf.companySummary'))}</div>
    <table>
      <thead><tr><th style="${thS}">${escapeHtml(t('reportsPdf.companyLot'))}</th><th style="${thS};text-align:center">Total</th><th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.toClose'))}</th><th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.closedPlural'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.progress'))}</th></tr></thead>
      <tbody>${buildLotSummaryRows(reserves, companies, t)}</tbody>
    </table>

    <div class="section-header">${escapeHtml(t('reportsScreen.personnelPresent'))}</div>
    <table>
      <thead><tr><th style="${thS}">${escapeHtml(t('reportsPdf.company'))}</th><th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.present'))}</th><th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.planned'))}</th><th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.delta'))}</th></tr></thead>
      <tbody>${personnelRows || `<tr><td style="${tdS}" colspan="4">${escapeHtml(t('reportsPdf.noPersonnelData'))}</td></tr>`}</tbody>
    </table>

    <div class="section-header">${escapeHtml(t('reportsScreen.currentTasks'))}</div>
    <table>
      <thead><tr><th style="${thS}">${escapeHtml(t('reportsPdf.task'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.responsible'))}</th><th style="${thS};width:120px">${escapeHtml(t('reportsPdf.progress'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.deadline'))}</th></tr></thead>
      <tbody>${taskRows || `<tr><td style="${tdS}" colspan="4">${escapeHtml(t('reportsScreen.noCurrentTask'))}</td></tr>`}</tbody>
    </table>

    <div class="section-header">${escapeHtml(t('reportsPdf.securityIncidentsWithCount', { count: openIncidents.length }))}</div>
    <table>
      <thead><tr><th style="${thS}">${escapeHtml(t('reportsPdf.severity'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.title'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.place'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.status'))}</th><th style="${thS}">Date</th><th style="${thS}">${escapeHtml(t('reportsPdf.reportedBy'))}</th></tr></thead>
      <tbody>${incidentRows || `<tr><td style="${tdS};color:#059669" colspan="6">${escapeHtml(t('reportsScreen.noOpenIncident'))}</td></tr>`}</tbody>
    </table>

    <div class="section-header">${escapeHtml(t('reportsPdf.activeReservesWithCount', { count: activeReserves.length }))}</div>
    <table>
      <thead><tr><th style="${thS}">${escapeHtml(t('reportsPdf.ref'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.title'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.location'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.company'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.priority'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.status'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.deadline'))}</th></tr></thead>
      <tbody>${reserveRows || `<tr><td style="${tdS};color:#059669" colspan="7">${escapeHtml(t('reportsPdf.noActiveReserve'))}</td></tr>`}</tbody>
    </table>

    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, t('reportsPdf.dailyDocumentTitle', { projectName }));
}

export function buildWeeklyHTML(reserves: any[], companies: any[], tasks: any[], incidents: any[], stats: any, userName: string, weekNum: number, projectName: string, t: TFunc, locale = 'fr-FR'): string {
  const palette = getPdfCompanyPalette(companies);
  const today = new Date().toLocaleDateString(locale);
  const docRef = `RH-S${weekNum}-${new Date().getFullYear()}`;

  const openIncidents = incidents.filter((i: any) => i.status !== 'resolved');
  const resolvedThisWeek = incidents.filter((i: any) => i.status === 'resolved');
  const severityColors: Record<string, string> = { minor: '#6B7280', moderate: '#F59E0B', major: '#EF4444', critical: '#7F1D1D' };

  const reserveByStatus = [
    { label: reserveStatusLabel(t, 'open'), count: stats.open, color: RESERVE_STATUS_COLORS.open },
    { label: reserveStatusLabel(t, 'in_progress'), count: stats.inProgress, color: RESERVE_STATUS_COLORS.in_progress },
    { label: reserveStatusLabel(t, 'waiting'), count: stats.waiting, color: RESERVE_STATUS_COLORS.waiting },
    { label: reserveStatusLabel(t, 'verification'), count: stats.verification, color: RESERVE_STATUS_COLORS.verification },
    { label: reserveStatusLabel(t, 'closed'), count: stats.closed, color: RESERVE_STATUS_COLORS.closed },
  ];
  const criticalReserves = reserves.filter((r: any) => r.priority === 'critical' && r.status !== 'closed');
  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px';

  const body = `
    ${buildLetterhead(t('reportsPdf.weeklyTitle', { week: weekNum }), projectName, docRef, today, projectName)}
    <div style="font-size:10px;color:#6B7280;margin-top:-16px;margin-bottom:20px">${escapeHtml(t('reportsPdf.writtenBy'))} : <strong style="color:#1A2742">${escapeHtml(userName)}</strong></div>
    ${buildKpiRow([
      { val: `${stats.progress}%`, label: t('reportsScreen.closureRate'), color: '#003082' },
      { val: `${stats.closed}/${stats.total}`, label: t('reportsScreen.closedReserves'), color: '#059669' },
      { val: openIncidents.length, label: t('reportsScreen.openIncidents'), color: openIncidents.length > 0 ? '#DC2626' : '#059669' },
      { val: resolvedThisWeek.length, label: t('reportsScreen.resolvedIncidents'), color: '#059669' },
      { val: criticalReserves.length, label: t('reportsScreen.criticalReserves'), color: criticalReserves.length > 0 ? '#7C3AED' : '#059669' },
    ])}
    <div style="background:#E8F0FE;border-radius:6px;height:12px;margin:4px 0 4px;overflow:hidden"><div style="background:#003082;height:12px;border-radius:6px;width:${stats.progress}%"></div></div>
    <div style="font-size:10px;color:#003082;font-weight:700;text-align:right;margin-bottom:20px">${escapeHtml(t('reportsPdf.globalClosure', { progress: stats.progress }))}</div>

    <div class="section-header">${escapeHtml(t('reportsPdf.companySummary'))}</div>
    <table>
      <thead><tr><th style="${thS}">${escapeHtml(t('reportsPdf.companyLot'))}</th><th style="${thS};text-align:center">Total</th><th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.toClose'))}</th><th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.closedPlural'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.progress'))}</th></tr></thead>
      <tbody>${buildLotSummaryRows(reserves, companies, t)}</tbody>
    </table>

    <div class="section-header">${escapeHtml(t('reportsPdf.reserveByStatus'))}</div>
    <table>
      <thead><tr>
        <th style="${thS}">${escapeHtml(t('reportsPdf.status'))}</th>
        <th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.count'))}</th>
        <th style="${thS};text-align:center">${escapeHtml(t('reportsPdf.proportion'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.indicator'))}</th>
      </tr></thead>
      <tbody>
        ${reserveByStatus.map(s => `
          <tr>
            <td style="${tdS}"><span style="color:${s.color};font-weight:700">${s.label}</span></td>
            <td style="${tdS};text-align:center;font-weight:700">${s.count}</td>
            <td style="${tdS};text-align:center">${stats.total ? Math.round((s.count / stats.total) * 100) : 0}%</td>
            <td style="${tdS}">
              <div style="background:#EEF3FA;border-radius:4px;height:8px;width:180px;overflow:hidden">
                <div style="background:${s.color};height:8px;width:${stats.total ? Math.round((s.count / stats.total) * 100) : 0}%"></div>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>

    <div class="section-header">${escapeHtml(t('reportsPdf.openCriticalReservesWithCount', { count: criticalReserves.length }))}</div>
    <table>
      <thead><tr>
        <th style="${thS}">${escapeHtml(t('reportsPdf.ref'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.title'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.location'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.company'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.deadline'))}</th>
      </tr></thead>
      <tbody>${criticalReserves.map((r: any) =>
        `<tr><td style="${tdS};font-weight:700">${escapeHtml(r.id)}</td><td style="${tdS}">${escapeHtml(r.title)}</td>
         <td style="${tdS}">${escapeHtml(formatReserveLocation(r))}</td><td style="${tdS}">${renderPdfReserveCompanies(r, palette)}</td>
         <td style="${tdS};color:#DC2626;font-weight:600">${escapeHtml(r.deadline)}</td></tr>`
      ).join('') || `<tr><td style="${tdS};color:#059669" colspan="5">${escapeHtml(t('reportsScreen.noCriticalReserve'))}</td></tr>`}</tbody>
    </table>

    <div class="section-header">${escapeHtml(t('reportsPdf.securityIncidentsWeek', { week: weekNum }))}</div>
    <table>
      <thead><tr>
        <th style="${thS}">${escapeHtml(t('reportsPdf.severity'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.title'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.place'))}</th><th style="${thS}">${escapeHtml(t('reportsPdf.status'))}</th><th style="${thS}">Date</th>
      </tr></thead>
      <tbody>${openIncidents.map((i: any) =>
        `<tr>
          <td style="${tdS}"><span style="color:${severityColors[i.severity]||'#000'};font-weight:700">${escapeHtml(incidentSeverityLabel(t, i.severity))}</span></td>
          <td style="${tdS}">${escapeHtml(i.title)}</td><td style="${tdS}">${escapeHtml([i.building ? `Bât. ${i.building}` : '', i.location].filter(Boolean).join(' · '))}</td>
          <td style="${tdS}">${escapeHtml(incidentStatusLabel(t, i.status))}</td><td style="${tdS}">${escapeHtml(i.reportedAt)}</td>
        </tr>`
      ).join('') || `<tr><td style="${tdS};color:#059669" colspan="5">${escapeHtml(t('reportsPdf.noOpenIncidentThisWeek'))}</td></tr>`}</tbody>
    </table>

    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, t('reportsPdf.weeklyDocumentTitle', { week: weekNum, projectName }));
}

export function buildIncidentHTML(incident: any, projectName: string, t: TFunc, locale = 'fr-FR'): string {
  const severityBg: Record<string, string> = { minor: '#F3F4F6', moderate: '#FFFBEB', major: '#FEF2F2', critical: '#FDF2F8' };
  const severityColor: Record<string, string> = { minor: '#6B7280', moderate: '#D97706', major: '#DC2626', critical: '#9D174D' };
  const statusColor: Record<string, string> = { open: '#DC2626', investigating: '#D97706', resolved: '#059669' };
  const statusBg: Record<string, string> = { open: '#FEF2F2', investigating: '#FFFBEB', resolved: '#ECFDF5' };
  const sevBg = severityBg[incident.severity] ?? '#F3F4F6';
  const sevCol = severityColor[incident.severity] ?? '#6B7280';
  const today = new Date().toLocaleDateString(locale);
  const docRef = `INC-${incident.id}`;

  const infoItems = [
    { label: t('reportsPdf.location'), value: `Bât. ${incident.building} — ${incident.location}` },
    { label: t('reportsPdf.reportedBy'), value: incident.reportedBy },
    { label: t('reportsPdf.reportDate'), value: incident.reportedAt },
    ...(incident.closedAt ? [{ label: t('reportsPdf.resolvedOn'), value: incident.closedAt }] : []),
  ];

  const body = `
    ${buildLetterhead(t('reportsPdf.incidentSheet'), incident.title, docRef, today, projectName)}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <span style="display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px;background:${sevBg};color:${sevCol}">⚠ ${escapeHtml(incidentSeverityLabel(t, incident.severity))}</span>
      <span style="display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px;background:${statusBg[incident.status]??'#F9FAFB'};color:${statusColor[incident.status]??'#6B7280'}">${escapeHtml(incidentStatusLabel(t, incident.status))}</span>
      ${incident.closedAt ? `<span style="display:inline-block;padding:4px 14px;border-radius:14px;font-weight:700;font-size:12px;background:#ECFDF5;color:#059669">✓ ${escapeHtml(t('reportsScreen.incidentStatus.resolved'))}</span>` : ''}
    </div>
    ${buildInfoGrid(infoItems)}
    <div class="section-header">${escapeHtml(t('reportsPdf.incidentDescription'))}</div>
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #3B82F6;font-size:13px;color:#1A2742;line-height:1.6">
      ${escapeHtml(incident.description) || escapeHtml(t('reportsPdf.noDescription'))}
    </div>
    <div class="section-header">${escapeHtml(t('reportsPdf.witnesses'))}</div>
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #6B7280;font-size:13px;color:#1A2742;line-height:1.6">
      ${escapeHtml(incident.witnesses) || escapeHtml(t('reportsPdf.noWitness'))}
    </div>
    <div class="section-header">${escapeHtml(t('reportsPdf.correctiveActions'))}</div>
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #F59E0B;font-size:13px;color:#1A2742;line-height:1.6">
      ${escapeHtml(incident.actions) || escapeHtml(t('reportsPdf.noCorrectiveAction'))}
    </div>
    ${incident.closedAt ? `
      <div class="section-header">${escapeHtml(t('reportsPdf.closure'))}</div>
      <div style="background:#ECFDF5;border-radius:10px;padding:14px 18px;margin-bottom:14px;border-left:4px solid #059669;font-size:13px;color:#1A2742;line-height:1.6">
        ${escapeHtml(t('reportsPdf.resolvedSentence', { date: incident.closedAt, by: incident.closedBy ? t('reportsPdf.byName', { name: incident.closedBy }) : '' }))}
      </div>` : ''}
    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, t('reportsPdf.incidentDocumentTitle', { id: incident.id }));
}

export async function buildCompanyReserveHTML(company: any, companyReserves: any[], projectName: string, t: TFunc, locale: string, loadPhoto: (uri: string) => Promise<string | null>): Promise<string> {
  const now = new Date().toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString(locale);
  const docRef = `BON-${company.name.slice(0, 4).toUpperCase().replace(/\s/g, '')}-${today.replace(/\//g, '')}`;
  const priorityColors = RESERVE_PRIORITY_COLORS as Record<string, string>;
  const statusColors = RESERVE_STATUS_COLORS as Record<string, string>;
  const openCount = companyReserves.filter((r: any) => r.status !== 'closed').length;
  const closedCount = companyReserves.filter((r: any) => r.status === 'closed').length;
  const criticalCount = companyReserves.filter((r: any) => r.priority === 'critical' && r.status !== 'closed').length;
  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;vertical-align:top';

  const photoMap = new Map<string, { src: string; annotations?: any[] | null }>();
  await Promise.all(
    companyReserves.map(async (r: any) => {
      const pdfPhotos = getReservePdfPhotos(r);
      const firstPhoto = pdfPhotos.find((p: any) => p.kind === 'defect') ?? pdfPhotos[0];
      if (firstPhoto?.uri) {
        const src = await loadPhoto(firstPhoto.uri);
        if (src) photoMap.set(r.id, { src, annotations: firstPhoto.annotations });
      }
    })
  );

  const rows = companyReserves.map((r: any, idx: number) => {
    const photo = photoMap.get(r.id);
    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="${tdS};font-weight:700;white-space:nowrap;vertical-align:middle">${escapeHtml(r.id)}</td>
      <td style="${tdS}">
        ${photo ? `<div style="position:relative;display:inline-block;float:left;margin-right:8px;margin-bottom:2px;"><img src="${escapeHtml(photo.src)}" style="width:auto;height:auto;max-width:64px;max-height:64px;background:#F9FAFB;border-radius:5px;border:1px solid #DDE4EE;display:block" />${buildPhotoAnnotationsOverlayHtml(photo.annotations)}</div>` : ''}
        <span style="font-weight:600">${escapeHtml(r.title)}</span>
        ${hasCustomReserveDescription(r.description, r.title) ? `<div style="color:#6B7280;font-size:10px;margin-top:2px;clear:both">${escapeHtml(getReserveDescriptionText(r.description, r.title).slice(0, 80))}${getReserveDescriptionText(r.description, r.title).length > 80 ? '…' : ''}</div>` : ''}
      </td>
      <td style="${tdS};white-space:nowrap">${escapeHtml(formatReserveLocation(r))}</td>
      <td style="${tdS}"><span style="color:${priorityColors[r.priority]||'#000'};font-weight:700">${escapeHtml(reservePriorityLabel(t, r.priority))}</span></td>
      <td style="${tdS}"><span style="color:${statusColors[r.status]||'#000'};font-weight:700">${escapeHtml(reserveStatusLabel(t, r.status))}</span></td>
      <td style="${tdS};white-space:nowrap${r.deadline && r.deadline !== '—' && !r.closedAt ? ';color:#DC2626;font-weight:600' : ''}">${escapeHtml(r.deadline)||'—'}</td>
      <td style="${tdS};color:#059669">${escapeHtml(r.closedAt)||'—'}</td>
    </tr>`;
  }).join('');

  const alertHtml = openCount > 0
    ? `<div class="alert alert-danger">⚠️ <strong>${escapeHtml(t('reportsPdf.toCloseReserves', { count: openCount }))}</strong> — ${escapeHtml(t('reportsPdf.contractDeadlines'))}</div>`
    : `<div class="alert alert-success">✅ ${escapeHtml(t('reportsPdf.allReservesClosed'))}</div>`;

  const body = `
    ${buildLetterhead(t('reportsPdf.reserveSlip'), company.name, docRef, now, projectName, { company })}
    ${buildInfoGrid([
      ...(company.phone ? [{ label: t('reportsPdf.phone'), value: company.phone }] : []),
      ...(company.email ? [{ label: 'Email', value: company.email }] : []),
      ...(company.specialty ? [{ label: t('reportsPdf.specialty'), value: company.specialty }] : []),
    ])}
    ${buildKpiRow([
      { val: companyReserves.length, label: t('reportsScreen.totalReserves'), color: '#003082' },
      { val: openCount, label: t('reportsPdf.toClose'), color: openCount > 0 ? '#DC2626' : '#059669' },
      { val: closedCount, label: t('reportsPdf.closedPlural'), color: '#059669' },
      { val: criticalCount, label: t('reportsScreen.critical'), color: criticalCount > 0 ? '#7C3AED' : '#059669' },
    ])}
    ${alertHtml}
    <div class="section-header">${escapeHtml(t('reportsPdf.reserveListWithCount', { count: companyReserves.length }))}</div>
    <table>
      <thead><tr>
        <th style="${thS}">${escapeHtml(t('reportsPdf.ref'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.wording'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.location'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.priority'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.status'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.deadline'))}</th>
        <th style="${thS}">${escapeHtml(t('reportsPdf.closedDate'))}</th>
      </tr></thead>
      <tbody>
        ${rows || `<tr><td style="${tdS};color:#059669;text-align:center" colspan="7">${escapeHtml(t('reportsPdf.noReserveForCompany'))}</td></tr>`}
      </tbody>
    </table>
    <div class="alert alert-info" style="margin-top:20px">
      <strong>${escapeHtml(t('reportsPdf.instructions'))} :</strong> ${escapeHtml(t('reportsPdf.reserveSlipInstruction'))}
    </div>
    <div class="sig-row" style="margin-top:20px">
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('reportsPdf.companyRepresentative'))}</div>
        <div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
        <div style="font-size:11px;color:#6B7280">${escapeHtml(t('reportsPdf.nameStamp'))}</div>
        <div class="sig-date">Date : _______________</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('reportsPdf.constructionManager'))}</div>
        <div style="height:70px;border-bottom:2px solid #1A2742;margin-bottom:8px"></div>
        <div style="font-size:11px;color:#6B7280">${escapeHtml(t('reportsPdf.signatureStamp'))}</div>
        <div class="sig-date">Date : _______________</div>
      </div>
    </div>
    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, t('reportsPdf.reserveSlipDocumentTitle', { company: company.name }));
}
