import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildInventoryDocxBytes } from '../lib/inventoryDocxEngine';

const products = [
  {
    reference: 'ABC-12580', designation: 'Vanne DN25 & raccord', currentStock: 27, minStock: 10,
    totalEntries: 35, totalExits: 8, location: 'Magasin principal', supplier: 'Fournisseur Démo', barcode: '1234567890123',
  },
  {
    reference: 'POM-002', designation: 'Pompe immergée', currentStock: 2, minStock: 5,
    totalEntries: 10, totalExits: 8, location: 'Zone A', supplier: 'INICA', barcode: '9876543210123',
  },
];

const movements = [
  {
    createdAt: '2026-08-11T10:30:00.000Z', movementType: 'in' as const, reference: 'ABC-12580',
    designation: 'Vanne DN25 & raccord', quantity: 35, stockBefore: 0, stockAfter: 35,
    userName: 'Balbino', buildingName: 'Service Building', companyName: 'INICA', supplier: 'Fournisseur Démo', comment: 'Réception',
  },
  {
    createdAt: '2026-08-11T12:45:00.000Z', movementType: 'out' as const, reference: 'ABC-12580',
    designation: 'Vanne DN25 & raccord', quantity: 8, stockBefore: 35, stockAfter: 27,
    userName: 'Balbino', buildingName: 'SPA', companyName: 'Symantel', personName: 'Carlos', comment: 'Installation',
  },
];

const expected = {
  fr: ['Rapport de stock chantier', 'Synthèse opérationnelle', 'État du stock', 'Derniers mouvements'],
  en: ['Construction inventory report', 'Operational summary', 'Stock status', 'Latest movements'],
  es: ['Informe de stock de obra', 'Resumen operativo', 'Estado del stock', 'Últimos movimientos'],
} as const;

describe('inventory DOCX export', () => {
  for (const language of ['fr', 'en', 'es'] as const) {
    it(`creates a valid localized OpenXML package in ${language}`, () => {
      const bytes = buildInventoryDocxBytes(products, movements, 'Tropicalia & Villas', new Date('2026-08-11T14:00:00.000Z'), language);
      expect(bytes.byteLength).toBeGreaterThan(5_000);

      const files = unzipSync(bytes);
      const requiredParts = [
        '[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml',
        'word/settings.xml', 'word/header1.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels',
        'docProps/core.xml', 'docProps/app.xml',
      ];
      for (const part of requiredParts) expect(files[part], part).toBeInstanceOf(Uint8Array);

      const document = strFromU8(files['word/document.xml']);
      const header = strFromU8(files['word/header1.xml']);
      const relationships = strFromU8(files['word/_rels/document.xml.rels']);
      const contentTypes = strFromU8(files['[Content_Types].xml']);

      for (const label of expected[language]) expect(document).toContain(label);
      expect(document).toContain('Vanne DN25 &amp; raccord');
      expect(document).not.toContain('Vanne DN25 & raccord');
      expect(document).toContain('w:orient="landscape"');
      expect(document).toContain('<w:tblHeader/>');
      expect(document).toContain('POM-002');
      expect(header).toContain('Tropicalia &amp; Villas');
      expect(relationships).toContain('relationships/header');
      expect(relationships).toContain('relationships/footer');
      expect(contentTypes).toContain('wordprocessingml.document.main+xml');
      expect(document).not.toMatch(/undefined|NaN|\[object Object\]/);
    });
  }
});
