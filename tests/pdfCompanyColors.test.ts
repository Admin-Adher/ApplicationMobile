import { describe, expect, it } from 'vitest';
import {
  getPdfCompanyPalette,
  getPdfReservePinColor,
  renderPdfReserveCompanies,
} from '../lib/pdfCompanyColors';
import { createWebPdfBatchPayloads } from '../vercel-app/lib/pdf-report-batching';
import {
  buildGlobalReportHtml,
  buildGlobalReservesHtml,
  buildIndividualReserveHtml,
  buildVisitReportHtml,
} from '../vercel-app/lib/reportBuilder';

const companies = [
  { id: 'co1', name: 'A & B', color: '#D82092' },
  { id: 'co2', name: 'Atelier <C>', color: '#007F83' },
];
const plan = { id: 'p1', name: 'Plan', fileType: 'image', uri: 'data:image/png;base64,AA' };
const reserve = {
  id: 'r1', num: 1, title: 'Porte', company: ' a & b ', planId: plan.id, planX: 30, planY: 40,
  status: 'open', priority: 'medium', photos: [],
};
const multi = { ...reserve, id: 'r2', companies: ['A & B', 'Atelier <C>'], planX: 60 };
const payload = {
  chantierName: 'Démo', generatedAt: '2026-11-05T12:00:00Z', companyFilter: null,
  companies, plans: [plan], reserves: [reserve, multi], recipients: [], sendByEmail: false,
};

describe('company colors in PDF reports', () => {
  it('matches names independently of casing, escapes labels and rejects unsafe colors', () => {
    const palette = getPdfCompanyPalette([...companies, { name: 'Unknown', color: '" onload="alert(1)' }]);
    expect(getPdfReservePinColor(reserve, palette)).toBe(companies[0].color);
    expect(getPdfReservePinColor(multi, palette)).toBe('#6B7280');
    expect(getPdfReservePinColor({}, palette)).toBe('#6B7280');
    expect(getPdfReservePinColor({ company: 'Unknown' }, palette)).toBe('#003082');
    const label = renderPdfReserveCompanies(multi, palette);
    expect(label.match(/<circle /g)).toHaveLength(2);
    expect(label).toContain('Atelier &lt;C&gt;');
    expect(label).not.toContain('Atelier <C>');
  });

  it('keeps the color of each plan pin and renders both labels for a shared reserve', () => {
    const html = buildGlobalReportHtml(payload);
    expect(html).toMatch(/<circle cx="30%" cy="40%" r="10"\s+fill="#D82092"/);
    expect(html).toMatch(/<circle cx="60%" cy="40%" r="10"\s+fill="#6B7280"/);
    expect(html).toContain('fill="#007F83"');
  });

  it('retains the palette and assignments in each part of a split report', () => {
    const reserves = Array.from({ length: 151 }, (_, index) => ({ ...multi, id: String(index) }));
    const batches = createWebPdfBatchPayloads('global_reserves', { ...payload, reserves }, 'fr');
    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      const html = buildGlobalReservesHtml(batch);
      expect(html).toContain('fill="#D82092"');
      expect(html).toContain('fill="#007F83"');
    }
  });

  it('colors the visit companies and the companies on each reserve', () => {
    const html = buildVisitReportHtml({ ...payload, visit: { concerned_company_ids: ['co1', 'co2'] } });
    for (const { color } of companies) expect(html.split('fill="' + color + '"').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('prints company labels on the individual sheet and accepts the old single-color payload', () => {
    const html = buildIndividualReserveHtml({ ...payload, reserve: multi });
    expect(html).toContain('fill="#D82092"');
    expect(html).toContain('fill="#007F83"');

    const legacyHtml = buildIndividualReserveHtml({
      ...payload, companies: undefined, reserve, companyColor: '#D82092', planUri: plan.uri, planX: 30, planY: 40,
    });
    expect(legacyHtml).toContain('r="2.2" fill="#D82092"');
    expect(legacyHtml).toContain('r="4.5" fill="#D82092"');
  });
});
