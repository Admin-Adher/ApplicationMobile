import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';
import type { InventoryMovement, InventoryProduct } from '../constants/types';
import {
  buildInventoryWorkbook,
  inventoryWorkbookToArrayBuffer,
  inventoryWorkbookToBase64,
} from '../lib/inventoryWorkbook';

const products: InventoryProduct[] = [
  {
    id: 'p1', organizationId: 'org', chantierId: 'site', reference: 'ABC-12580', designation: 'Vanne laiton DN25',
    barcode: '3017620422003', photoUrl: 'https://example.test/vanne.jpg', currentStock: 27, totalEntries: 35,
    totalExits: 8, minStock: 10, location: 'Magasin principal', supplier: 'BTP Distribution',
    createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-10T08:00:00Z', version: 2,
  },
  {
    id: 'p2', organizationId: 'org', chantierId: 'site', reference: 'ELC-44102', designation: 'Disjoncteur 20A',
    barcode: '3245064079709', currentStock: 8, totalEntries: 20, totalExits: 12, minStock: 10,
    location: 'Rack E-04', supplier: 'Legrand', createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-10T08:00:00Z', version: 1,
  },
  {
    id: 'p3', organizationId: 'org', chantierId: 'site', reference: 'PLB-00815', designation: 'Coude PVC Ø100',
    currentStock: 0, totalEntries: 12, totalExits: 12, minStock: 6, location: 'Rack P-02', supplier: 'Nicoll',
    createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-10T08:00:00Z', version: 1,
  },
  {
    id: 'p4', organizationId: 'org', chantierId: 'site', reference: 'ARCHIVED-0001', designation: 'Référence sans seuil',
    currentStock: 0, totalEntries: 0, totalExits: 0, minStock: 0,
    createdAt: '2026-08-01T08:00:00Z', updatedAt: '2026-08-10T08:00:00Z', version: 1,
  },
];

const movements: InventoryMovement[] = [
  {
    id: 'm1', operationId: 'op1', organizationId: 'org', chantierId: 'site', productId: 'p1', movementType: 'in',
    quantity: 35, stockBefore: 0, stockAfter: 35, reference: 'ABC-12580', designation: 'Vanne laiton DN25',
    supplier: 'BTP Distribution', userName: 'Balbino', createdAt: '2026-08-06T12:32:00Z',
  },
  {
    id: 'm2', operationId: 'op2', organizationId: 'org', chantierId: 'site', productId: 'p1', movementType: 'out',
    quantity: 8, stockBefore: 35, stockAfter: 27, reference: 'ABC-12580', designation: 'Vanne laiton DN25',
    buildingName: 'Service Building', zoneName: 'RDC', companyName: 'INICA', personName: 'Carlos', comment: 'Pose plomberie',
    userName: 'Balbino', createdAt: '2026-08-10T14:32:00Z',
  },
];

describe('inventory Excel workbook', () => {
  it('creates a styled operational workbook with dashboard, formulas and all required reports', () => {
    const workbook = buildInventoryWorkbook('stock', products, movements, 'Tropicalia', new Date('2026-08-11T10:00:00Z'));
    const bytes = new Uint8Array(inventoryWorkbookToArrayBuffer(workbook));
    const files = unzipSync(bytes);
    const parsed = XLSX.read(bytes, { type: 'array', cellDates: true });

    expect(parsed.SheetNames).toEqual([
      'Synthèse', 'État du stock', 'À commander', 'Mouvements', 'Entrées', 'Sorties', 'Par bâtiment', 'Par entreprise',
    ]);
    expect(parsed.Sheets.Synthèse.A5.f).toContain("COUNTA('État du stock'!A5:A8)");
    expect(parsed.Sheets.Synthèse.E5.f).toBe("COUNTA('À commander'!A5:A6)");
    expect(parsed.Sheets.Synthèse.E5.v).toBe(2);
    expect(parsed.Sheets['État du stock'].F6.f).toBe('MAX(E6-D6,0)');
    expect(parsed.Sheets['État du stock'].F6.v).toBe(2);
    expect(parsed.Sheets['À commander'].A5.v).toBe('PLB-00815');
    expect(parsed.Sheets.Mouvements.A5.v).toBeInstanceOf(Date);

    const stylesXml = strFromU8(files['xl/styles.xml']);
    const stockXml = strFromU8(files['xl/worksheets/sheet2.xml']);
    expect(stylesXml).toContain('FF0F3B75');
    expect(stylesXml).toContain('cellXfs count="23"');
    expect(stockXml).toContain('showGridLines="0"');
    expect(stockXml).toContain('ySplit="4"');
    expect(stockXml).toContain('autoFilter ref="A4:L8"');
    expect(stockXml).toMatch(/<c r="C6"[^>]* s="15">/);
    expect(stockXml).toMatch(/<c r="C7"[^>]* s="16">/);
    expect(inventoryWorkbookToBase64(workbook).startsWith('UEsDB')).toBe(true);
  });
});
