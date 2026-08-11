import * as XLSX from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { InventoryMovement, InventoryProduct } from '@/constants/types';
import {
  buildInventoryWorkbookEngine,
  inventoryWorkbookBytesToBase64,
  writeInventoryWorkbookBytesEngine,
  type InventoryWorkbookKind,
  type InventoryWorkbookMovement,
  type InventoryWorkbookProduct,
} from './inventoryWorkbookEngine';

export type InventoryExportKind = InventoryWorkbookKind;

function normalizeProduct(product: InventoryProduct): InventoryWorkbookProduct {
  return {
    reference: product.reference,
    designation: product.designation,
    photoUrl: product.photoUrl,
    currentStock: product.currentStock,
    minStock: product.minStock,
    totalEntries: product.totalEntries,
    totalExits: product.totalExits,
    location: product.location,
    supplier: product.supplier,
    barcode: product.barcode,
  };
}

function normalizeMovement(movement: InventoryMovement): InventoryWorkbookMovement {
  return {
    createdAt: movement.createdAt,
    movementType: movement.movementType,
    reference: movement.reference,
    designation: movement.designation,
    quantity: movement.quantity,
    stockBefore: movement.stockBefore,
    stockAfter: movement.stockAfter,
    userName: movement.userName,
    buildingName: movement.buildingName,
    zoneName: movement.zoneName,
    companyName: movement.companyName,
    personName: movement.personName,
    supplier: movement.supplier,
    comment: movement.comment,
  };
}

export function buildInventoryWorkbook(
  kind: InventoryExportKind,
  products: InventoryProduct[],
  movements: InventoryMovement[],
  chantierName: string,
  generatedAt = new Date(),
): XLSX.WorkBook {
  return buildInventoryWorkbookEngine(
    XLSX as any,
    kind,
    products.map(normalizeProduct),
    movements.map(normalizeMovement),
    chantierName,
    generatedAt,
  ) as XLSX.WorkBook;
}

function workbookBytes(workbook: XLSX.WorkBook): Uint8Array {
  return writeInventoryWorkbookBytesEngine(XLSX as any, {
    strFromU8,
    strToU8,
    unzipSync,
    zipSync,
  }, workbook as any);
}

export function inventoryWorkbookToBase64(workbook: XLSX.WorkBook): string {
  return inventoryWorkbookBytesToBase64(workbookBytes(workbook));
}

export function inventoryWorkbookToArrayBuffer(workbook: XLSX.WorkBook): ArrayBuffer {
  const bytes = workbookBytes(workbook);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
