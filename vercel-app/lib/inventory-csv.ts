import {
  buildInventoryCsv,
  type InventoryCsvKind,
} from '../../lib/inventoryCsv';
import type {
  InventoryWorkbookMovement,
  InventoryWorkbookProduct,
} from '../../lib/inventoryWorkbookEngine';
import type { InventoryDocumentLanguage } from '../../lib/inventoryDocumentCopy';

type DownloadInventoryCsvOptions = {
  kind: InventoryCsvKind;
  products: InventoryWorkbookProduct[];
  movements: InventoryWorkbookMovement[];
  filename: string;
  language: InventoryDocumentLanguage;
};

export function downloadInventoryCsv({
  kind,
  products,
  movements,
  filename,
  language,
}: DownloadInventoryCsvOptions): void {
  const csv = buildInventoryCsv({ kind, products, movements, language });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
