import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { showAlert } from '@/lib/appAlert';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import {
  exportPDF as exportPDFHelper,
  buildLetterhead,
  buildKpiRow,
  buildDocFooter,
  wrapHTML,
  buildInfoGrid,
  loadPhotoAsDataUrl, loadPhotoAsDataUrlForPdf,
  escapeHtml,
} from '@/lib/pdfBase';
import { getISOWeek } from '@/lib/utils';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useIncidents } from '@/context/IncidentsContext';
import Header from '@/components/Header';
import PageContainer from '@/components/PageContainer';
import BottomNavBar from '@/components/BottomNavBar';
import {
  buildPhotoAnnotationsOverlayHtml,
  enrichReservesForPdf as enrichReserveListForPdf,
  formatReserveLocation,
  getReservePdfPhotos,
} from '@/lib/pdfReserveHelpers';
import { buildPdfFilename } from '@/lib/pdfFilename';
import {
  RESERVE_PRIORITY_COLORS,
  RESERVE_PRIORITY_LABELS,
  RESERVE_STATUS_COLORS,
  RESERVE_STATUS_LABELS,
} from '@/lib/reserveLabels';
import { getReserveDescriptionText, hasCustomReserveDescription } from '@/lib/reserveDescription';
import { reserveMatchesCompany } from '@/lib/reserveVisibility';

type TFunc = (key: string, options?: Record<string, any>) => string;

function reserveStatusLabel(t: TFunc, status: string): string {
  const keyMap: Record<string, string> = {
    open: 'reserveLabels.status.open',
    in_progress: 'reserveLabels.status.in_progress',
    waiting: 'reserveLabels.status.waiting',
    verification: 'reserveLabels.status.verification',
    closed: 'reserveLabels.status.closed',
  };
  return keyMap[status] ? t(keyMap[status]) : status;
}

function reservePriorityLabel(t: TFunc, priority: string): string {
  const keyMap: Record<string, string> = {
    low: 'reserveLabels.priority.low',
    medium: 'reserveLabels.priority.medium',
    high: 'reserveLabels.priority.high',
    critical: 'reserveLabels.priority.critical',
  };
  return keyMap[priority] ? t(keyMap[priority]) : priority;
}

function incidentSeverityLabel(t: TFunc, severity: string): string {
  return t(`reportsScreen.severity.${severity}`, { defaultValue: severity });
}

function incidentStatusLabel(t: TFunc, status: string): string {
  return t(`reportsScreen.incidentStatus.${status}`, { defaultValue: status });
}

function buildLotSummaryRows(reserves: any[], companies: any[], t: TFunc): string {
  const companyNames = [...new Set(reserves.map((r: any) => r.company))];
  return companyNames.map(name => {
    const co = companies.find((c: any) => c.name === name);
    const coReserves = co
      ? reserves.filter((r: any) => reserveMatchesCompany(r, co))
      : reserves.filter((r: any) => r.company === name);
    const open = coReserves.filter((r: any) => r.status !== 'closed').length;
    const closed = coReserves.filter((r: any) => r.status === 'closed').length;
    const pct = coReserves.length > 0 ? Math.round((closed / coReserves.length) * 100) : 0;
    const barColor = pct >= 80 ? '#059669' : pct >= 40 ? '#F59E0B' : '#DC2626';
    return `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:600">${escapeHtml(name)}</td>
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

function buildDailyHTML(reserves: any[], companies: any[], tasks: any[], incidents: any[], stats: any, userName: string, projectName: string, t: TFunc): string {
  const now = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString();
  const docRef = `RJ-${today.replace(/\//g, '')}`;

  const severityColors: Record<string, string> = { minor: '#6B7280', moderate: '#F59E0B', major: '#EF4444', critical: '#7F1D1D' };
  const statusColors = RESERVE_STATUS_COLORS as Record<string, string>;
  const pColor = RESERVE_PRIORITY_COLORS as Record<string, string>;
  const openIncidents = incidents.filter((i: any) => i.status !== 'resolved');
  const activeReserves = reserves.filter((r: any) => r.status !== 'closed');
  const totalWorkers = companies.reduce((s: number, c: any) => s + (c.actualWorkers || 0), 0);

  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;vertical-align:top';

  const personnelRows = companies.map((c: any) =>
    `<tr><td style="${tdS}">${escapeHtml(c.name)}</td><td style="${tdS};text-align:center;font-weight:700">${c.actualWorkers}</td><td style="${tdS};text-align:center">${c.plannedWorkers}</td><td style="${tdS};text-align:center;color:${c.actualWorkers >= c.plannedWorkers ? '#059669' : '#DC2626'}">${c.actualWorkers >= c.plannedWorkers ? '✓' : '↓'}</td></tr>`
  ).join('');

  const taskRows = tasks.filter((t: any) => t.status === 'in_progress').map((t: any) =>
    `<tr><td style="${tdS}">${escapeHtml(t.title)}</td><td style="${tdS}">${escapeHtml(t.assignee)}</td><td style="${tdS};text-align:center">
      <div style="background:#E8F0FE;border-radius:4px;height:8px;width:100%;margin-bottom:3px"><div style="background:#003082;height:8px;border-radius:4px;width:${t.progress}%"></div></div>
      <span style="font-size:10px;color:#003082;font-weight:700">${t.progress}%</span>
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
      <td style="${tdS}">${escapeHtml(r.company)}</td>
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

    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, t('reportsPdf.dailyDocumentTitle', { projectName }));
}

function buildWeeklyHTML(reserves: any[], companies: any[], tasks: any[], incidents: any[], stats: any, userName: string, weekNum: number, projectName: string, t: TFunc): string {
  const today = new Date().toLocaleDateString();
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
         <td style="${tdS}">${escapeHtml(formatReserveLocation(r))}</td><td style="${tdS}">${escapeHtml(r.company)}</td>
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

    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, t('reportsPdf.weeklyDocumentTitle', { week: weekNum, projectName }));
}

function buildIncidentHTML(incident: any, projectName: string, t: TFunc): string {
  const severityBg: Record<string, string> = { minor: '#F3F4F6', moderate: '#FFFBEB', major: '#FEF2F2', critical: '#FDF2F8' };
  const severityColor: Record<string, string> = { minor: '#6B7280', moderate: '#D97706', major: '#DC2626', critical: '#9D174D' };
  const statusColor: Record<string, string> = { open: '#DC2626', investigating: '#D97706', resolved: '#059669' };
  const statusBg: Record<string, string> = { open: '#FEF2F2', investigating: '#FFFBEB', resolved: '#ECFDF5' };
  const sevBg = severityBg[incident.severity] ?? '#F3F4F6';
  const sevCol = severityColor[incident.severity] ?? '#6B7280';
  const today = new Date().toLocaleDateString();
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
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, t('reportsPdf.incidentDocumentTitle', { id: incident.id }));
}

async function buildCompanyReserveHTML(company: any, companyReserves: any[], projectName: string, t: TFunc): Promise<string> {
  const now = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toLocaleDateString();
  const docRef = `BON-${company.name.slice(0, 4).toUpperCase().replace(/\s/g, '')}-${today.replace(/\//g, '')}`;
  const priorityColors = RESERVE_PRIORITY_COLORS as Record<string, string>;
  const statusColors = RESERVE_STATUS_COLORS as Record<string, string>;
  const openCount = companyReserves.filter((r: any) => r.status !== 'closed').length;
  const closedCount = companyReserves.filter((r: any) => r.status === 'closed').length;
  const criticalCount = companyReserves.filter((r: any) => r.priority === 'critical' && r.status !== 'closed').length;
  const thS = 'background:#003082;color:#fff;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.5px';
  const tdS = 'padding:7px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;vertical-align:top';

  const photoMap: Record<string, { src: string; annotations?: any[] | null }> = {};
  await Promise.all(
    companyReserves.map(async (r: any) => {
      const pdfPhotos = getReservePdfPhotos(r);
      const firstPhoto = pdfPhotos.find((p: any) => p.kind === 'defect') ?? pdfPhotos[0];
      if (firstPhoto?.uri) {
        const src = await loadPhotoAsDataUrlForPdf(firstPhoto.uri);
        if (src) photoMap[r.id] = { src, annotations: firstPhoto.annotations };
      }
    })
  );

  const rows = companyReserves.map((r: any, idx: number) => {
    const photo = photoMap[r.id];
    return `<tr style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
      <td style="${tdS};font-weight:700;white-space:nowrap;vertical-align:middle">${escapeHtml(r.id)}</td>
      <td style="${tdS}">
        ${photo ? `<div style="position:relative;display:inline-block;float:left;margin-right:8px;margin-bottom:2px;"><img src="${photo.src}" style="width:auto;height:auto;max-width:64px;max-height:64px;background:#F9FAFB;border-radius:5px;border:1px solid #DDE4EE;display:block" />${buildPhotoAnnotationsOverlayHtml(photo.annotations)}</div>` : ''}
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
    ${buildLetterhead(t('reportsPdf.reserveSlip'), company.name, docRef, now, projectName)}
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
    ${buildDocFooter(projectName)}
  `;

  return wrapHTML(body, t('reportsPdf.reserveSlipDocumentTitle', { company: company.name }));
}

function buildCsvReport(reserves: any[], t: TFunc): string {
  const header = ['ID', t('reportsPdf.title'), t('reportsPdf.status'), t('reportsPdf.priority'), t('reportsPdf.building'), 'Zone', t('reportsPdf.level'), t('reportsPdf.company'), t('reportsPdf.createdDate'), t('reportsPdf.deadline'), t('reportsPdf.closedDate'), t('reportsPdf.closedBy')];
  const rows = reserves.map(r => [
    r.id, `"${r.title}"`, reserveStatusLabel(t, r.status), reservePriorityLabel(t, r.priority),
    r.building, r.zone, r.level, `"${r.company}"`, r.createdAt, r.deadline,
    r.closedAt ?? '', `"${r.closedBy ?? ''}"`,
  ]);
  return [header, ...rows].map(row => row.join(';')).join('\n');
}

export default function RapportsScreen() {
  const { t } = useTranslation();
  const { reserves, companies, tasks, stats, chantiers, activeChantierId, photos } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const { incidents } = useIncidents();
  const userName = user?.name ?? t('reportsScreen.buildTrackTeam');
  const router = useRouter();

  if (user?.role === 'sous_traitant') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: '#1E293B', marginTop: 16, textAlign: 'center' }}>
          {t('common.restrictedAccess')}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: '#94A3B8', marginTop: 8, textAlign: 'center' }}>
          {t('reportsScreen.subcontractorDenied')}
        </Text>
        <TouchableOpacity
          onPress={() => router.canGoBack() ? router.back() : router.navigate('/(tabs)/' as any)}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#2563EB', borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>{t('reportsScreen.backDashboard')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekNum = getISOWeek(new Date());
  const pdfReserves = enrichReserveListForPdf(reserves, photos);

  async function exportPDF(type: 'daily' | 'weekly') {
    if (!permissions.canExport) {
      showAlert(t('documentsScreen.accessDenied'), t('reportsScreen.exportDenied'));
      return;
    }
    try {
      const html = type === 'daily'
        ? buildDailyHTML(pdfReserves, companies, tasks, incidents, stats, userName, projectName, t)
        : buildWeeklyHTML(pdfReserves, companies, tasks, incidents, stats, userName, weekNum, projectName, t);
      await exportPDFHelper(
        html,
        type === 'daily'
          ? buildPdfFilename('Rapport_Journalier', [projectName])
          : buildPdfFilename('Rapport_Hebdomadaire', [`Semaine_${weekNum}`, projectName]),
      );
    } catch (e: any) {
      showAlert(t('common.error'), t('reportsScreen.pdfError', { error: e?.message ?? e }));
    }
  }

  async function exportCSV() {
    if (!permissions.canExport) {
      showAlert(t('documentsScreen.accessDenied'), t('reportsScreen.exportDenied'));
      return;
    }
    try {
      const csv = buildCsvReport(reserves, t);

      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `buildtrack_reserves_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const filename = `buildtrack_reserves_${Date.now()}.csv`;
      const fileUri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: t('reportsScreen.shareCsv'), UTI: 'public.comma-separated-values-text' });
      } else {
        showAlert(t('reportsScreen.csvGenerated'), t('reportsScreen.csvGeneratedText', { count: reserves.length, fileUri }));
      }
    } catch (e: any) {
      showAlert(t('common.error'), t('reportsScreen.exportError', { error: e?.message ?? e }));
    }
  }

  return (
    <View style={styles.container}>
      <Header title={t('reportsScreen.title')} subtitle={t('reportsScreen.subtitle')} showBack />

      <PageContainer maxWidth={1000}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="document-text" size={20} color={C.inProgress} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>{t('reportsScreen.dailyReport')}</Text>
              <Text style={styles.reportDate}>{today}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('daily')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.personnelPresent')}</Text>
            {companies.map(co => (
              <View key={co.id} style={styles.coRow}>
                <View style={[styles.coDot, { backgroundColor: co.color }]} />
                <Text style={styles.coName}>{co.name}</Text>
                <Text style={[styles.coVal, { color: co.color }]}>{t('reportsScreen.peopleCount', { count: co.actualWorkers })}</Text>
              </View>
            ))}
            <View style={[styles.coRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={[styles.coVal, { color: C.primary }]}>{t('reportsScreen.plannedWorkers', { actual: stats.totalWorkers, planned: stats.plannedWorkers })}</Text>
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.reserves')}</Text>
            <View style={styles.statRow}>
              <StatItem label={t('reportsScreen.openFem')} val={stats.open} color={C.open} />
              <StatItem label={t('reportsScreen.inProgress')} val={stats.inProgress} color={C.inProgress} />
              <StatItem label={t('reportsScreen.closedFem')} val={stats.closed} color={C.closed} />
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.currentTasks')}</Text>
            {tasks.filter(t => t.status === 'in_progress').map(t => (
              <View key={t.id} style={styles.taskItem}>
                <View style={styles.taskDot} />
                <Text style={styles.taskText}>{t.title}</Text>
                <Text style={[styles.taskPct, { color: C.inProgress }]}>{t.progress}%</Text>
              </View>
            ))}
            {tasks.filter(t => t.status === 'in_progress').length === 0 && (
              <Text style={styles.emptyText}>{t('reportsScreen.noCurrentTask')}</Text>
            )}
          </View>
        </View>

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="calendar" size={20} color={C.closed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>{t('reportsScreen.weeklyReport')}</Text>
              <Text style={styles.reportDate}>{t('reportsScreen.weekNumber', { week: weekNum })}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('weekly')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.reserveSummary')}</Text>
            <View style={styles.statRow}>
              <StatItem label="Total" val={stats.total} color={C.textSub} />
              <StatItem label={t('reportsScreen.openFem')} val={stats.open + stats.inProgress} color={C.open} />
              <StatItem label={t('reportsScreen.closedFem')} val={stats.closed} color={C.closed} />
            </View>
            <View style={styles.progressWrap}>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${stats.progress}%` as any }]} />
              </View>
              <Text style={[styles.progressPct, { color: C.primary }]}>{stats.progress}%</Text>
            </View>
            <Text style={styles.progressLabel}>{t('reportsScreen.globalProgress')}</Text>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.openCriticalReserves')}</Text>
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').map(r => (
              <View key={r.id} style={styles.critItem}>
                <Ionicons name="warning" size={14} color={C.critical} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.critTitle}>{r.id} — {r.title}</Text>
                  <Text style={styles.critSub}>{t('reportsScreen.reserveCriticalMeta', { building: r.building, deadline: r.deadline })}</Text>
                </View>
              </View>
            ))}
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').length === 0 && (
              <Text style={styles.emptyText}>{t('reportsScreen.noCriticalReserve')}</Text>
            )}
          </View>

          <View style={[styles.reportSection, { marginBottom: 0, borderBottomWidth: 0 }]}>
            <Text style={styles.sectionTitle}>{t('reportsScreen.securityIncidents')}</Text>
            {incidents.filter(i => i.status !== 'resolved').map(i => {
              const sevColor: Record<string, string> = { minor: C.textSub, moderate: C.waiting, major: C.open, critical: C.critical };
              return (
                <View key={i.id} style={[styles.critItem, { borderLeftWidth: 3, borderLeftColor: sevColor[i.severity] ?? C.open, paddingLeft: 8, marginBottom: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.critTitle, { color: sevColor[i.severity] ?? C.open }]}>{incidentSeverityLabel(t, i.severity)} — {i.title}</Text>
                    <Text style={styles.critSub}>{t('reportsScreen.incidentMeta', { building: i.building, location: i.location, date: i.reportedAt })}</Text>
                  </View>
                  {permissions.canExport && (
                    <TouchableOpacity
                      onPress={async () => {
                        try {
                          const html = buildIncidentHTML(i, projectName, t);
                          await exportPDFHelper(html, buildPdfFilename('Incident', [i.id, i.title, projectName]));
                        } catch (e: any) {
                          showAlert(t('common.error'), e?.message ?? t('reportsScreen.pdfGenerateError'));
                        }
                      }}
                      style={[styles.exportBtn, { marginLeft: 8 }]}
                    >
                      <Ionicons name="download-outline" size={12} color={C.primary} />
                      <Text style={styles.exportBtnText}>PDF</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            {incidents.filter(i => i.status !== 'resolved').length === 0 && (
              <Text style={[styles.emptyText, { color: C.closed }]}>{t('reportsScreen.noOpenIncidentSafe')}</Text>
            )}
          </View>
        </View>

        {/* BON DE RÉSERVE PAR ENTREPRISE */}
        {permissions.canExport && companies.length > 0 && (
          <View style={styles.reportCard}>
            <View style={styles.reportHeader}>
              <Ionicons name="briefcase-outline" size={20} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{t('reportsScreen.reserveSlipsByCompany')}</Text>
                <Text style={styles.reportDate}>{t('reportsScreen.individualPdfBySubcontractor')}</Text>
              </View>
            </View>
            {companies.map(company => {
              const companyReserves = pdfReserves.filter(r => reserveMatchesCompany(r, company));
              const openCount = companyReserves.filter(r => r.status !== 'closed').length;
              const closedCount = companyReserves.filter(r => r.status === 'closed').length;
              const activeChantier = chantiers.find(c => c.id === activeChantierId);
              const projectName = activeChantier?.name ?? t('reportsScreen.buildTrackProject');
              return (
                <View key={company.id} style={styles.companyRow}>
                  <View style={[styles.companyDot, { backgroundColor: company.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.companyName}>{company.name}</Text>
                    <Text style={styles.companyMeta}>
                      {t('reportsScreen.companyReserveCount', { count: companyReserves.length })}
                      {openCount > 0 ? ` · ${t('reportsScreen.toCloseCount', { count: openCount })}` : ''}
                      {closedCount > 0 ? ` · ${t('reportsScreen.closedCount', { count: closedCount })}` : ''}
                    </Text>
                  </View>
                  {companyReserves.length > 0 ? (
                    <TouchableOpacity
                      style={styles.exportBtn}
                      onPress={async () => {
                        try {
                          const html = await buildCompanyReserveHTML(company, companyReserves, projectName, t);
                          await exportPDFHelper(html, buildPdfFilename('Bon_Reserves', [company.name, projectName]));
                        } catch (e: any) {
                          showAlert(t('common.error'), e?.message ?? t('reportsScreen.pdfGenerateError'));
                        }
                      }}
                    >
                      <Ionicons name="document-text-outline" size={13} color={C.primary} />
                      <Text style={styles.exportBtnText}>PDF</Text>
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted }}>{t('reportsScreen.none')}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="warning" size={20} color={C.waiting} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>{t('reportsScreen.reservesReport')}</Text>
              <Text style={styles.reportDate}>{t('reportsScreen.totalReservesCount', { count: stats.total })}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={exportCSV}>
                <Ionicons name="download-outline" size={14} color={C.closed} />
                <Text style={[styles.exportBtnText, { color: C.closed }]}>CSV</Text>
              </TouchableOpacity>
            )}
          </View>

          {(['open', 'in_progress', 'waiting', 'verification', 'closed'] as const).map(s => {
            const colors = RESERVE_STATUS_COLORS as Record<string, string>;
            const count = reserves.filter(r => r.status === s).length;
            return (
              <View key={s} style={styles.statusBreakRow}>
                <View style={[styles.statusDot, { backgroundColor: colors[s] }]} />
                <Text style={styles.statusLabel}>{reserveStatusLabel(t, s)}</Text>
                <View style={styles.statusBarBg}>
                  <View style={[styles.statusBarFill, {
                    width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` as any,
                    backgroundColor: colors[s],
                  }]} />
                </View>
                <Text style={[styles.statusCount, { color: colors[s] }]}>{count}</Text>
              </View>
            );
          })}

          {permissions.canExport && (
            <TouchableOpacity style={styles.fullExportBtn} onPress={exportCSV}>
              <Ionicons name="document-outline" size={16} color="#fff" />
              <Text style={styles.fullExportBtnText}>{t('reportsScreen.exportAllReservesCsv')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
      </PageContainer>
      <BottomNavBar />
    </View>
  );
}

function StatItem({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statVal, { color }]}>{val}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  reportCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  reportTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  reportDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  exportBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  reportSection: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  companyDot: { width: 10, height: 10, borderRadius: 5 },
  companyName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  companyMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  coVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  totalRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginTop: 4 },
  totalLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  statRow: { flexDirection: 'row', gap: 8 },
  statItem: { flex: 1, alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, padding: 10 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  taskDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.inProgress },
  taskText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  taskPct: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressPct: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  critItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  critTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  critSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  statusBreakRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 82 },
  statusBarBg: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 3 },
  statusCount: { fontSize: 13, fontFamily: 'Inter_600SemiBold', width: 20, textAlign: 'right' },
  fullExportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, marginTop: 10 },
  fullExportBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
