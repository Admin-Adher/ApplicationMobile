import { describe, expect, it } from 'vitest';
import { buildJournalHTML } from '../lib/journalReportHtml';
import { fieldReportTranslator } from '../vercel-app/lib/field-report-translation';
import type { JournalEntry } from '../constants/types';
import { escapeHtml } from '../lib/pdfHtml';

const entry: JournalEntry = { id: 'J1', date: '07/11/2026', author: 'Chef', workerCount: 0,
  weather: 'Soleil', workDone: '<Travaux>', materials: 'Cuivre', incidents: 'Accès fermé',
  observations: 'Note', visitors: 'Visiteur', createdAt: '2026-11-07' };

describe('one journal document for web and mobile', () => {
  it('includes zero headcount, every field, signatures and certification without unsafe HTML', () => {
    const html = buildJournalHTML([entry], 'Chantier <A>', fieldReportTranslator('fr'));
    for (const text of ['&lt;Travaux&gt;', 'Cuivre', 'Accès fermé', 'Note', 'Visiteur', 'Chef', 'Chantier &lt;A&gt;',
      'Conducteur de travaux', 'Certification', '07/11/2026']) expect(html).toContain(text);
    expect(html).toContain('>0</td>');
    expect(html).not.toContain('<Travaux>');
    expect(html).toContain('class="sig-row"');
    expect(html).toContain('buildtrack-pdf-pagination');
  });

  it('sorts ISO and French calendar dates together without changing the input', () => {
    const entries = [entry, { ...entry, id: 'J2', date: '2026-11-08', workDone: 'Travaux plus récents' }];
    const html = buildJournalHTML(entries, 'Recette', fieldReportTranslator('fr'));
    expect(html.indexOf('Travaux plus récents')).toBeLessThan(html.indexOf('&lt;Travaux&gt;'));
    expect(html).toContain('08/11/2026');
    expect(entries[0].id).toBe('J1');
  });

  it('does not repeat weather measurements already saved in older mobile labels', () => {
    const html = buildJournalHTML([{ ...entry, weather: 'Soleil · 21°C · 13 km/h', weatherTemp: 21.4, weatherWind: 13.2 }],
      'Recette', fieldReportTranslator('fr'));
    expect(html.match(/21°C/g)).toHaveLength(1);
    expect(html.match(/13 km\/h/g)).toHaveLength(1);
  });

  it.each(['fr', 'en', 'es'] as const)('translates every journal label in %s', language => {
    const html = buildJournalHTML([entry], 'Recette', fieldReportTranslator(language));
    expect(html).not.toContain('journal.pdf.');
    expect(html).toContain(escapeHtml(fieldReportTranslator(language)('journal.pdf.certificationText')));
  });
});
