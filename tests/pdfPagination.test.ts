import { describe, expect, it } from 'vitest';
import { withPdfPagination } from '../lib/pdfPagination';
import { wrapHTML } from '../lib/pdfHtml';
import { buildInventoryPdfHtml } from '../lib/inventoryPdfDocument';

describe('print pagination across export entry points', () => {
  it('adds print rules in the head once and preserves the report content', () => {
    const source = '<!doctype html><HTML><HEAD><title>Report</title></HEAD><body><p>Long report &amp; dates</p></body></HTML>';
    const html = withPdfPagination(source);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<body><p>Long report &amp; dates</p></body>');
    expect(html.indexOf('buildtrack-pdf-pagination')).toBeLessThan(html.indexOf('<body>'));
    expect(withPdfPagination(html)).toBe(html);
  });

  it('supports fragments and documents without a head without losing their doctype', () => {
    expect(withPdfPagination('<p>Fragment</p>')).toContain('</style><p>Fragment</p>');
    const html = withPdfPagination('<!doctype html><html lang="fr"><body>Signatures</body></html>');
    expect(html).toMatch(/^<!doctype html><html lang="fr"><head>/);
    expect(html).toContain('</style></head><body>Signatures</body>');
  });

  it('covers the shared mobile templates and the independently built inventory PDF', () => {
    const reports = [wrapHTML('<div class="sig-row">Signatures</div>', 'OPR'),
      buildInventoryPdfHtml([], [], 'Recette', 'fr', new Date('2026-11-07T12:00:00Z'))];
    reports.forEach(html => {
      expect((html.match(/id="buildtrack-pdf-pagination"/g) ?? [])).toHaveLength(1);
      expect(withPdfPagination(html)).toBe(html);
    });
  });
});
