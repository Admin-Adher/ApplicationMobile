import { describe, expect, it } from 'vitest';
import { buildCsvReport } from '../lib/reserveCsv';
import { buildFieldReportHtml, validFieldReportPayload } from '../vercel-app/lib/field-reports';
import { fieldReportTranslator } from '../vercel-app/lib/field-report-translation';
import { buildOprWorkspaceModel } from '../vercel-app/app/web/opr-workspace/opr-workspace-model';
import { buildWebOprPrint } from '../vercel-app/app/web/opr-workspace/opr-print';

const company = { id: 'company-1', name: 'Électricité & Co', color: '#F97316', actual_workers: 3, planned_workers: 5 };
const reserve = { id: 'RSV-1', title: 'Prise à tester', company: company.name, status: 'open', priority: 'critical' };
const payload = { chantierName: 'Chantier <recette>', companies: [company], company, reserves: [reserve], tasks: [], incidents: [], language: 'fr' };

describe('shared field exports', () => {
  it('uses the company’s configured color in daily, weekly and individual company reports', async () => {
    for (const type of ['daily', 'weekly', 'company_slip'] as const) {
      expect(validFieldReportPayload(type, payload)).toBe(true);
      const html = await buildFieldReportHtml(type, payload);
      expect(html).toContain('#F97316');
      expect(html).toContain('Électricité &amp; Co');
      expect(html).toContain('Chantier &lt;recette&gt;');
      expect(html).not.toContain('Chantier <recette>');
    }
  });

  it('reuses translated templates and exports incident and meeting data', async () => {
    const incident = { id: 'INC-1', title: 'Sécuriser l’accès', status: 'resolved', severity: 'minor', closed_at: '2026-11-05' };
    const sheet = await buildFieldReportHtml('incident', { ...payload, language: 'en', incident });
    expect(sheet).toContain('Sécuriser l’accès');
    expect(sheet).toContain('2026-11-05');
    expect(sheet).not.toContain('reportsPdf.');
    const meeting = { id: 'MTG-1', date: '05/11/2026', subject: 'Coordination', participants: company.name, agenda: 'Électricité',
      decisions: ['Prévoir une visite'], actions: [{ description: 'Valider la prise', responsible: company.name, status: 'pending' }] };
    expect(validFieldReportPayload('meeting', { ...payload, meeting })).toBe(true);
    const report = await buildFieldReportHtml('meeting', { ...payload, meeting });
    expect(report).toContain('#F97316');
    expect(report).toContain('Prévoir une visite');
    expect(report).toContain('Valider la prise');
    expect(validFieldReportPayload('meeting', { ...payload, meeting: { ...meeting, actions: [null] } })).toBe(false);
  });

  it('quotes text and neutralizes spreadsheet formulas in reserve exports', () => {
    const csv = buildCsvReport([{ ...reserve, title: ' =HYPERLINK("site");test' }], fieldReportTranslator('fr'), 'fr-FR');
    expect(csv).toContain('"\' =HYPERLINK(""site"");test"');
    expect(csv).toContain('"Électricité & Co"');
  });

  it('prints attendance and the two signatures recorded by older Android versions', () => {
    const signature = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>';
    const opr = { id: 'OPR-1', title: 'Réception', status: 'signed', date: '2026-11-05', conducteur: 'Chef de chantier',
      conducteur_signature: signature, mo_signature: signature, maire_ouvrage: 'Maître d’ouvrage',
      visit_participants: [{ id: 'person-1', name: 'Personne <A>', company: company.name, present: false }] };
    const model = buildOprWorkspaceModel([opr], []);
    const row = model.summaries[0];
    const pdf = buildWebOprPrint(row, 'Chantier', [], 'pv', [company]);
    expect(pdf).toContain('Personne &lt;A&gt;');
    expect(pdf).toContain('Absent');
    expect(pdf.match(/data:image\/svg\+xml/g)).toHaveLength(2);
    expect(buildWebOprPrint(row, 'Chantier', [], 'convocation', [company])).not.toContain('data:image/svg+xml');
  });
});
