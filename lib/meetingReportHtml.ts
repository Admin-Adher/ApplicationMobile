import { getPdfCompanyPalette, renderPdfCompanyLabel, type PdfCompany } from './pdfCompanyColors';
import { normalizeCompanyName } from './planPinColor';
import { wrapHTML, buildLetterhead, buildInfoGrid, buildDocFooter, escapeHtml } from './pdfHtml';
import type { MeetingReport } from '../constants/types';

export function buildMeetingHTML(report: MeetingReport, projectName: string, companies: PdfCompany[], t: (key: string, options?: any) => string, locale = 'fr-FR'): string {
  const palette = getPdfCompanyPalette(companies);
  const exportDate = new Date().toLocaleString(locale);
  const localizedDate = (value: string) => {
    const parts = value.split('/').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return value;
    return new Date(parts[2], parts[1] - 1, parts[0]).toLocaleDateString(locale);
  };
  const docRef = `CRR-${report.date.replace(/\//g, '')}-${report.id.slice(0, 6).toUpperCase()}`;
  const doneCount = report.actions.filter(a => a.status === 'done').length;
  const pendingCount = report.actions.length - doneCount;

  const decisionsHtml = report.decisions.length > 0
    ? report.decisions.map((d, i) =>
        `<div style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #EEF3FA">
          <div style="min-width:22px;height:22px;background:#003082;border-radius:50%;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center">${i + 1}</div>
          <div style="font-size:12px;color:#1A2742;line-height:1.5">${escapeHtml(d)}</div>
        </div>`
      ).join('')
    : `<div style="font-size:12px;color:#6B7280;font-style:italic">${escapeHtml(t('meetingReport.pdf.noDecision'))}</div>`;

  const actionsHtml = report.actions.map(a =>
    `<tr>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${escapeHtml(a.description)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;font-weight:600">${renderPdfCompanyLabel(a.responsible, palette)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">${escapeHtml(a.deadline)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center">
        <span style="background:${a.status === 'done' ? '#ECFDF5' : '#FFFBEB'};color:${a.status === 'done' ? '#059669' : '#D97706'};font-size:10px;font-weight:700;padding:2px 10px;border-radius:10px">
          ${escapeHtml(a.status === 'done' ? t('meetingReport.pdf.done') : t('meetingReport.pdf.pending'))}
        </span>
      </td>
    </tr>`
  ).join('');

  const sH = (t: string) => `<div class="section-header">${t}</div>`;

  const companyNames = new Set(companies.map(company => normalizeCompanyName(company.name)));
  const participantsList = report.participants.split('\n').map(name => name.trim()).filter(Boolean).flatMap(name => {
    if (companyNames.has(normalizeCompanyName(name))) return [name];
    const names = name.split(', ');
    return names.every(part => companyNames.has(normalizeCompanyName(part))) ? names : [name];
  }).map(p =>
    `<span style="display:inline-block;background:#F4F7FB;border:1px solid #DDE4EE;border-radius:20px;padding:3px 10px;font-size:11px;margin:3px 4px 3px 0">${renderPdfCompanyLabel(p.trim(), palette)}</span>`
  ).join('');

  const agendaItems = report.agenda.split('\n').filter(a => a.trim()).map((item, i) =>
    `<div style="display:flex;gap:10px;padding:6px 0;font-size:12px">
      <span style="color:#003082;font-weight:700;min-width:20px">${i + 1}.</span>
      <span>${escapeHtml(item.replace(/^\d+\.\s*/, ''))}</span>
    </div>`
  ).join('');

  const body = `
    ${buildLetterhead(t('meetingReport.pdf.title'), report.subject, docRef, exportDate, projectName)}
    ${buildInfoGrid([
      { label: t('meetingReport.pdf.meetingDate'), value: localizedDate(report.date) },
      { label: t('meetingReport.pdf.location'), value: report.location || t('meetingReport.notSpecified') },
      { label: t('meetingReport.pdf.redactedBy'), value: report.redactedBy },
      { label: t('meetingReport.pdf.actionsTotal'), value: t('meetingReport.pdf.actionsDone', { done: doneCount, total: report.actions.length }) },
    ])}
    ${pendingCount > 0 ? `
      <div class="alert alert-warning">⏳ <strong>${escapeHtml(t('meetingReport.pdf.pendingActions', { count: pendingCount }))}</strong> ${escapeHtml(t('meetingReport.pdf.sinceMeeting'))}</div>` : ''}
    ${sH(t('meetingReport.agenda'))}
    <div style="background:#F4F7FB;border-radius:10px;padding:12px 16px;margin-bottom:4px">${agendaItems || `<div style="color:#6B7280;font-style:italic">${escapeHtml(t('meetingReport.pdf.agendaEmpty'))}</div>`}</div>
    ${sH(t('meetingReport.participants'))}
    <div style="padding:10px 0">${participantsList || `<span style="color:#6B7280;font-style:italic">${escapeHtml(t('meetingReport.notSpecified'))}</span>`}</div>
    ${sH(t('meetingReport.pdf.discussions'))}
    <div style="background:#F9FAFB;border-radius:10px;padding:14px 16px;border:1px solid #DDE4EE;font-size:12px;line-height:1.7;white-space:pre-wrap">${escapeHtml(report.notes) || escapeHtml(t('meetingReport.pdf.notesEmpty'))}</div>
    ${sH(t('meetingReport.decisions'))}
    ${decisionsHtml}
    ${report.actions.length > 0 ? `
      ${sH(t('meetingReport.pdf.actionPlan', { count: report.actions.length }))}
      <table>
        <thead><tr>
          <th>${escapeHtml(t('meetingReport.pdf.action'))}</th><th>${escapeHtml(t('meetingReport.pdf.responsible'))}</th><th>${escapeHtml(t('meetingReport.pdf.deadline'))}</th><th style="text-align:center">${escapeHtml(t('meetingReport.pdf.status'))}</th>
        </tr></thead>
        <tbody>${actionsHtml}</tbody>
      </table>` : ''}
    <div class="sig-row" style="margin-top:32px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('meetingReport.nextMeeting'))}</div>
        <div style="font-size:13px;font-weight:700;color:#1A2742">${escapeHtml(report.nextMeeting) || escapeHtml(t('meetingReport.toDefine'))}</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('meetingReport.pdf.writerSignature'))}</div>
        <div class="sig-line"></div>
        <div class="sig-name">${escapeHtml(report.redactedBy)}</div>
      </div>
    </div>
    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, t('meetingReport.pdf.documentTitle', { subject: report.subject }));
}
