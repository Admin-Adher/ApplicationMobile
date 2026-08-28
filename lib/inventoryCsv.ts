import { inventoryDocumentCopy, type InventoryDocumentLanguage } from './inventoryDocumentCopy';
import type { InventoryWorkbookMovement, InventoryWorkbookProduct } from './inventoryWorkbookEngine';

export type InventoryCsvKind = 'stock' | 'history';

type InventoryCsvOptions = {
  kind: InventoryCsvKind;
  products: InventoryWorkbookProduct[];
  movements: InventoryWorkbookMovement[];
  language: InventoryDocumentLanguage;
};

function finite(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function csvText(value: unknown): string {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown, delimiter: string): string {
  const text = csvText(value);
  return text.includes(delimiter) || /["\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function formatNumber(value: unknown, locale: string): string {
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    maximumFractionDigits: 3,
  }).format(finite(value));
}

function formatDate(value: Date | string | number, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return csvText(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function buildInventoryCsv({ kind, products, movements, language }: InventoryCsvOptions): string {
  const copy = inventoryDocumentCopy(language);
  const delimiter = language === 'en' ? ',' : ';';
  const rows: unknown[][] = kind === 'history'
    ? [
        copy.workbook.headers.movements,
        ...movements.map(movement => [
          formatDate(movement.createdAt, copy.locale),
          movement.movementType === 'in' ? copy.movement.in : copy.movement.out,
          movement.reference,
          movement.designation,
          formatNumber(movement.quantity, copy.locale),
          formatNumber(movement.stockBefore, copy.locale),
          formatNumber(movement.stockAfter, copy.locale),
          movement.userName,
          movement.buildingName,
          movement.zoneName,
          movement.companyName,
          movement.personName,
          movement.supplier,
          movement.comment,
        ]),
      ]
    : [
        copy.workbook.headers.stock,
        ...products.map(product => [
          product.reference,
          product.designation,
          product.currentStock <= 0
            ? copy.status.out
            : product.minStock > 0 && product.currentStock <= product.minStock
              ? copy.status.low
              : copy.status.available,
          formatNumber(product.currentStock, copy.locale),
          formatNumber(product.minStock, copy.locale),
          formatNumber(Math.max(product.minStock - product.currentStock, 0), copy.locale),
          formatNumber(product.totalEntries, copy.locale),
          formatNumber(product.totalExits, copy.locale),
          product.location,
          product.supplier,
          product.barcode,
          product.photoUrl,
        ]),
      ];

  return `\uFEFF${rows.map(row => row.map(value => csvCell(value, delimiter)).join(delimiter)).join('\r\n')}\r\n`;
}
