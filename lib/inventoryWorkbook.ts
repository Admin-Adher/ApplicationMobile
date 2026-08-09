import * as XLSX from 'xlsx';
import type { InventoryMovement, InventoryProduct } from '@/constants/types';

export type InventoryExportKind = 'stock' | 'entries' | 'exits' | 'by_building' | 'by_company' | 'reorder';

type Cell = string | number | boolean | null | undefined;

function formatMovementDate(value: unknown): string {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'string' || typeof value === 'number' ? value : String(value ?? ''));
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function consumptionBy(movements: InventoryMovement[], key: (movement: InventoryMovement) => string): Array<[string, number]> {
  const totals = new Map<string, number>();
  for (const movement of movements) {
    if (movement.movementType !== 'out') continue;
    const label = key(movement).trim() || 'Non renseigné';
    totals.set(label, (totals.get(label) ?? 0) + movement.quantity);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: Cell[][], widths: number[]): void {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map(width => ({ wch: width }));
  if (sheet['!ref'] && rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

export function buildInventoryWorkbook(
  kind: InventoryExportKind,
  products: InventoryProduct[],
  movements: InventoryMovement[],
  chantierName: string,
  generatedAt = new Date(),
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: `BuildTrack - Stock - ${chantierName}`,
    Subject: `Export ${kind} du stock chantier`,
    Author: 'BuildTrack',
    Company: 'BuildTrack',
    CreatedDate: generatedAt,
  };

  if (kind === 'stock' || kind === 'reorder') {
    const selected = kind === 'reorder'
      ? products.filter(product => product.minStock > 0 && product.currentStock <= product.minStock)
      : products;
    const rows: Cell[][] = [[
      'Référence', 'Désignation', 'Photo', 'Stock', 'Stock minimum', 'Entrées', 'Sorties',
      'Localisation', 'Fournisseur', 'Code-barres', 'À commander', 'Quantité suggérée',
    ]];
    rows.push(...selected.map(product => [
      product.reference,
      product.designation,
      product.photoUrl ?? '',
      product.currentStock,
      product.minStock,
      product.totalEntries,
      product.totalExits,
      product.location ?? '',
      product.supplier ?? '',
      product.barcode ?? '',
      product.minStock > 0 && product.currentStock <= product.minStock ? 'OUI' : 'NON',
      Math.max(product.minStock - product.currentStock, 0),
    ]));
    appendSheet(workbook, kind === 'reorder' ? 'À commander' : 'État du stock', rows, [18, 32, 34, 12, 14, 12, 12, 24, 24, 20, 14, 18]);
    return workbook;
  }

  if (kind === 'by_building' || kind === 'by_company') {
    const byBuilding = kind === 'by_building';
    const totals = consumptionBy(
      movements,
      byBuilding ? movement => [movement.buildingName, movement.zoneName].filter(Boolean).join(' / ') : movement => movement.companyName ?? '',
    );
    appendSheet(
      workbook,
      byBuilding ? 'Par bâtiment' : 'Par entreprise',
      [[byBuilding ? 'Bâtiment / zone' : 'Entreprise', 'Quantité sortie'], ...totals],
      [38, 20],
    );
    return workbook;
  }

  const movementType = kind === 'entries' ? 'in' : 'out';
  const selected = movements.filter(movement => movement.movementType === movementType);
  const rows: Cell[][] = [[
    'Date', 'Type', 'Référence', 'Désignation', 'Quantité', 'Stock avant', 'Stock après',
    'Utilisateur', 'Bâtiment / zone', 'Entreprise', 'Personne', 'Fournisseur', 'Commentaire',
  ]];
  rows.push(...selected.map(movement => [
    formatMovementDate(movement.createdAt),
    movement.movementType === 'in' ? 'ENTRÉE' : 'SORTIE',
    movement.reference,
    movement.designation,
    movement.quantity,
    movement.stockBefore,
    movement.stockAfter,
    movement.userName,
    [movement.buildingName, movement.zoneName].filter(Boolean).join(' / '),
    movement.companyName ?? '',
    movement.personName ?? '',
    movement.supplier ?? '',
    movement.comment ?? '',
  ]));
  appendSheet(workbook, kind === 'entries' ? 'Entrées' : 'Sorties', rows, [22, 12, 18, 32, 12, 14, 14, 22, 28, 24, 22, 24, 42]);
  return workbook;
}

export function inventoryWorkbookToBase64(workbook: XLSX.WorkBook): string {
  return XLSX.write(workbook, { type: 'base64', bookType: 'xlsx', compression: true });
}

export function inventoryWorkbookToArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer;
}
