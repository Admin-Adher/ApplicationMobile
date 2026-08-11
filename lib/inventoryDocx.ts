import type { InventoryMovement, InventoryProduct } from '@/constants/types';
import type { InventoryDocumentLanguage } from './inventoryDocumentCopy';
import {
  buildInventoryDocxBytes,
  inventoryDocxBytesToBase64,
} from './inventoryDocxEngine';
import type {
  InventoryWorkbookMovement,
  InventoryWorkbookProduct,
} from './inventoryWorkbookEngine';

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

export function buildInventoryDocx(
  products: InventoryProduct[],
  movements: InventoryMovement[],
  chantierName: string,
  language: InventoryDocumentLanguage,
  generatedAt = new Date(),
): Uint8Array {
  return buildInventoryDocxBytes(
    products.map(normalizeProduct),
    movements.map(normalizeMovement),
    chantierName,
    generatedAt,
    language,
  );
}

export function inventoryDocxToBase64(bytes: Uint8Array): string {
  return inventoryDocxBytesToBase64(bytes);
}

export function inventoryDocxToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
