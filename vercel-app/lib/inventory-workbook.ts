import * as XLSX from 'xlsx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  buildInventoryWorkbookEngine,
  writeInventoryWorkbookBytesEngine,
  type InventoryWorkbookKind,
  type InventoryWorkbookMovement,
  type InventoryWorkbookProduct,
} from '../../lib/inventoryWorkbookEngine';

export type {
  InventoryWorkbookKind,
  InventoryWorkbookMovement,
  InventoryWorkbookProduct,
} from '../../lib/inventoryWorkbookEngine';

type DownloadInventoryWorkbookOptions = {
  kind: InventoryWorkbookKind;
  products: InventoryWorkbookProduct[];
  movements: InventoryWorkbookMovement[];
  chantierName: string;
  filename: string;
};

export function downloadInventoryWorkbook({
  kind,
  products,
  movements,
  chantierName,
  filename,
}: DownloadInventoryWorkbookOptions): void {
  const workbook = buildInventoryWorkbookEngine(
    XLSX as any,
    kind,
    products,
    movements,
    chantierName,
  );
  const bytes = writeInventoryWorkbookBytesEngine(XLSX as any, {
    strFromU8,
    strToU8,
    unzipSync,
    zipSync,
  }, workbook);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
