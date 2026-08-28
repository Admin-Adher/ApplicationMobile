import { describe, expect, it } from 'vitest';
import { buildInventoryCsv } from '../lib/inventoryCsv';

const products = [{
  reference: '=DANGER',
  designation: 'Vanne; DN25',
  photoUrl: 'https://example.test/photo.jpg',
  currentStock: 4,
  minStock: 6,
  totalEntries: 10,
  totalExits: 6,
  location: 'Rack A',
  supplier: 'BTP "Distribution"',
  barcode: '3017620422003',
}];

const movements = [{
  createdAt: '2026-08-29T08:30:00Z',
  movementType: 'out' as const,
  reference: 'ABC-1',
  designation: 'Vanne',
  quantity: 2,
  stockBefore: 6,
  stockAfter: 4,
  userName: 'Balbino',
  buildingName: 'Villa 1',
  zoneName: 'RDC',
  companyName: 'INICA',
  personName: 'Carlos',
  supplier: 'BTP',
  comment: 'Pose\ncontrôlée',
}];

describe('inventory CSV export', () => {
  it('creates an Excel-friendly UTF-8 French stock file with escaped values', () => {
    const csv = buildInventoryCsv({ kind: 'stock', products, movements, language: 'fr' });

    expect(csv.startsWith('\uFEFFRéférence;Désignation;Statut')).toBe(true);
    expect(csv).toContain("'=DANGER");
    expect(csv).toContain('"Vanne; DN25"');
    expect(csv).toContain('"BTP ""Distribution"""');
    expect(csv).toContain('STOCK FAIBLE');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('localizes history headers and safely quotes multiline fields', () => {
    const csv = buildInventoryCsv({ kind: 'history', products, movements, language: 'en' });

    expect(csv.startsWith('\uFEFFDate and time,Type,Reference')).toBe(true);
    expect(csv).toContain(',ISSUE,ABC-1,Vanne,2,6,4,');
    expect(csv).toContain('"Pose\ncontrôlée"');
  });
});
