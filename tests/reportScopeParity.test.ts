import { describe, expect, it } from 'vitest';
import { buildDailyHTML, buildWeeklyHTML, buildCompanyReserveHTML } from '../lib/fieldReportHtml';
import { buildCsvReport } from '../lib/reserveCsv';
import { buildFieldReportHtml } from '../vercel-app/lib/field-reports';
import { fieldReportTranslator } from '../vercel-app/lib/field-report-translation';

const t = fieldReportTranslator('fr');
const company = { id: 'co', name: 'Entreprise', color: '#F97316' };
const reserves = [
  { id: 'ACTIVE-open', title: 'Ouverte', company: company.name, status: 'open', priority: 'high' },
  { id: 'ACTIVE-closed', title: 'Clôturée', company: company.name, status: 'closed', priority: 'low' },
  { id: 'ARCHIVE-snake', title: 'Archive serveur', company: company.name, status: 'open', archived_at: '2026-11-07' },
  { id: 'ARCHIVE-camel', title: 'Archive mobile', company: company.name, status: 'open', archivedAt: '2026-11-07' },
];

describe('active reserve scope across report clients', () => {
  it('exports the same active and closed records without either archived representation', async () => {
    const source = JSON.stringify(reserves);
    const payload = { chantierName: 'Recette', language: 'fr', reserves, company, companies: [company], tasks: [], incidents: [] };
    // Deliberately stale cached counters must not disagree with the exported list.
    const stats = { total: 99, closed: 0, open: 99, progress: 0 };
    const reports = [
      buildDailyHTML(reserves, [company], [], [], stats, 'Chef', 'Recette', t),
      buildWeeklyHTML(reserves, [company], [], [], stats, 'Chef', 45, 'Recette', t),
      await buildCompanyReserveHTML(company, reserves, 'Recette', t, 'fr-FR', async () => null),
      await buildFieldReportHtml('daily', payload),
      await buildFieldReportHtml('weekly', payload),
      await buildFieldReportHtml('company_slip', payload),
    ];
    for (const report of reports) {
      expect(report).not.toContain('ARCHIVE-');
      expect(report).not.toContain('Archive serveur');
      expect(report).not.toContain('Archive mobile');
      expect(report).toContain('#F97316');
    }
    expect(reports[0]).toContain('50%');
    expect(reports[1]).toContain('1/2');
    expect(reports[2]).toContain('ACTIVE-closed');
    const csv = buildCsvReport(reserves, t, 'fr-FR');
    expect(csv.split('\r\n')).toHaveLength(3);
    expect(csv).toContain('ACTIVE-open');
    expect(csv).toContain('ACTIVE-closed');
    expect(csv).not.toContain('ARCHIVE-');
    expect(JSON.stringify(reserves)).toBe(source);
  });
});
