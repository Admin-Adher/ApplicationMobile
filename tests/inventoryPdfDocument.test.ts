import { describe, expect, it } from 'vitest';
import { buildInventoryPdfHtml } from '../lib/inventoryPdfDocument';
import type { InventoryWorkbookMovement, InventoryWorkbookProduct } from '../lib/inventoryWorkbookEngine';

const products: InventoryWorkbookProduct[] = [
  {
    reference: 'ELC-44102',
    designation: 'Disjoncteur 20A',
    currentStock: 8,
    minStock: 10,
    totalEntries: 20,
    totalExits: 12,
    location: 'Rack E-04',
    supplier: 'Legrand',
  },
];

const movements: InventoryWorkbookMovement[] = [
  {
    createdAt: '2026-08-10T14:32:00Z',
    movementType: 'out',
    reference: 'ELC-44102',
    designation: 'Disjoncteur 20A',
    quantity: 2,
    stockBefore: 10,
    stockAfter: 8,
    buildingName: 'Service Building',
    companyName: 'INICA',
    userName: 'Balbino',
  },
];

describe('inventory PDF document', () => {
  it.each([
    { language: 'fr' as const, title: 'ÉTAT DU STOCK', section: 'Produits à commander', issue: 'SORTIE' },
    { language: 'en' as const, title: 'STOCK STATUS', section: 'Products to reorder', issue: 'ISSUE' },
    { language: 'es' as const, title: 'ESTADO DEL STOCK', section: 'Productos por pedir', issue: 'SALIDA' },
  ])('renders a complete $language document', ({ language, title, section, issue }) => {
    const html = buildInventoryPdfHtml(products, movements, 'Tropicalia', language, new Date('2026-08-11T10:00:00Z'));

    expect(html).toContain(`<html lang="${language}">`);
    expect(html).toContain(title);
    expect(html).toContain(section);
    expect(html).toContain(issue);
    expect(html).toContain('ELC-44102');
    expect(html).toContain('INICA');
  });
});
