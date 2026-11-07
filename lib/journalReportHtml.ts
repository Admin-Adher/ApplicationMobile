import type { JournalEntry } from '../constants/types';
import { wrapHTML, buildLetterhead, buildKpiRow, buildDocFooter, escapeHtml } from './pdfHtml';

export function buildJournalHTML(entries: JournalEntry[], projectName: string, t: (key: string, options?: any) => string, locale = 'fr-FR'): string {
  const exportDate = new Date().toLocaleDateString(locale);
  const docRef = `JC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
  const calendarDate = (value: string) => {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!iso && !french) return null;
    const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [Number(french![3]), Number(french![2]), Number(french![1])];
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day ? parsed : null;
  };
  const localizedDate = (value: string) => calendarDate(value)?.toLocaleDateString(locale) ?? value;
  entries = [...entries].sort((a, b) => (calendarDate(b.date)?.getTime() ?? 0) - (calendarDate(a.date)?.getTime() ?? 0));

  const totalWorkers = entries.reduce((s, e) => s + (e.workerCount || 0), 0);
  const avgWorkers = entries.length > 0 ? Math.round(totalWorkers / entries.length) : 0;
  const entriesWithIncidents = entries.filter(e => e.incidents && e.incidents.trim()).length;
  const dateRange = entries.length > 0
    ? `${localizedDate(entries[entries.length - 1].date)} → ${localizedDate(entries[0].date)}`
    : '—';

  const rows = entries.map((e, idx) => {
    const longEntry = [e.workDone, e.materials, e.observations, e.visitors, e.incidents, e.author, e.weather].join('').length > 1800;
    const hasMaterials = e.materials && e.materials.trim();
    const hasObservations = e.observations && e.observations.trim();
    const hasVisitors = e.visitors && e.visitors.trim();
    const hasIncident = e.incidents && e.incidents.trim();
    const weatherParts = [
      e.weatherTemp != null && !/°\s*C/i.test(e.weather) ? `${Math.round(e.weatherTemp)}°C` : null,
      e.weatherWind != null && !/km\s*\/\s*h/i.test(e.weather) ? `${Math.round(e.weatherWind)} km/h` : null,
    ].filter(Boolean);
    const weatherExtra = weatherParts.length ? ` (${weatherParts.join(' · ')})` : '';
    return `
      <tr class="${longEntry ? 'journal-entry-long' : ''}" style="background:${idx % 2 === 0 ? '#fff' : '#F9FAFB'}">
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-weight:700;white-space:nowrap;font-size:11px">${escapeHtml(localizedDate(e.date))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:12px">${escapeHtml(e.weather)}${escapeHtml(weatherExtra)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;text-align:center;font-weight:700;font-size:13px;color:#003082">${e.workerCount}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;line-height:1.5">
          <div>${escapeHtml(e.workDone)}</div>
          ${hasMaterials ? `<div style="color:#6B7280;margin-top:4px;font-size:10px">📦 ${escapeHtml(e.materials)}</div>` : ''}
          ${hasObservations ? `<div style="color:#6B7280;margin-top:4px;font-size:10px">📝 ${escapeHtml(e.observations)}</div>` : ''}
          ${hasVisitors ? `<div style="color:#3B82F6;margin-top:4px;font-size:10px">👤 ${escapeHtml(t('journal.pdf.visitors'))} : ${escapeHtml(e.visitors)}</div>` : ''}
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px">
          ${hasIncident
            ? `<span style="color:#DC2626;font-weight:700">⚠ ${escapeHtml(e.incidents)}</span>`
            : `<span style="color:#059669">—</span>`
          }
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEF3FA;font-size:11px;color:#6B7280">${escapeHtml(e.author)}</td>
      </tr>
    `;
  }).join('');

  const body = `
    ${buildLetterhead(t('journal.pdf.title'), dateRange, docRef, exportDate, projectName, { locale })}
    ${buildKpiRow([
      { val: entries.length, label: t('journal.pdf.entries'), color: '#003082' },
      { val: totalWorkers, label: t('journal.pdf.totalWorkers'), color: '#003082' },
      { val: avgWorkers, label: t('journal.pdf.dailyAverage'), color: '#1A2742' },
      { val: entriesWithIncidents, label: t('journal.pdf.incidentDays'), color: entriesWithIncidents > 0 ? '#DC2626' : '#059669' },
    ])}
    <div class="section-header">${escapeHtml(t('journal.pdf.register', { count: entries.length }))}</div>
    <table class="journal-table">
      <thead>
        <tr>
          <th>${escapeHtml(t('journal.pdf.date'))}</th><th>${escapeHtml(t('journal.pdf.weather'))}</th><th style="text-align:center">${escapeHtml(t('journal.pdf.workers'))}</th>
          <th>${escapeHtml(t('journal.pdf.workMaterialsObservations'))}</th>
          <th>${escapeHtml(t('journal.pdf.incidents'))}</th><th>${escapeHtml(t('journal.pdf.author'))}</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="6" style="padding:20px;text-align:center;color:#6B7280">${escapeHtml(t('journal.pdf.noEntries'))}</td></tr>`}
      </tbody>
    </table>
    <div class="sig-row" style="margin-top:32px;padding-top:20px;border-top:2px solid #EEF3FA">
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('journal.pdf.conductor'))}</div>
        <div class="sig-line"></div>
        <div style="font-size:11px;color:#6B7280">${escapeHtml(t('journal.pdf.signatureStamp'))}</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('journal.pdf.projectManager'))}</div>
        <div class="sig-line"></div>
        <div style="font-size:11px;color:#6B7280">${escapeHtml(t('journal.pdf.signatureStamp'))}</div>
      </div>
      <div class="sig-block">
        <div class="sig-label">${escapeHtml(t('journal.pdf.certification'))}</div>
        <div style="font-size:11px;color:#1A2742;line-height:1.5">${escapeHtml(t('journal.pdf.certificationText'))}</div>
      </div>
    </div>
    ${buildDocFooter(projectName, { locale })}
  `;

  return wrapHTML(body, t('journal.pdf.documentTitle', { project: projectName }));
}

