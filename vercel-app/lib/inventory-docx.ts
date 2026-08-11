import { buildInventoryDocxBytes } from '../../lib/inventoryDocxEngine';
import type {
  InventoryWorkbookMovement,
  InventoryWorkbookProduct,
} from '../../lib/inventoryWorkbookEngine';
import type { InventoryDocumentLanguage } from '../../lib/inventoryDocumentCopy';

type DownloadInventoryDocxOptions = {
  products: InventoryWorkbookProduct[];
  movements: InventoryWorkbookMovement[];
  chantierName: string;
  filename: string;
  language: InventoryDocumentLanguage;
};

export function downloadInventoryDocx({
  products,
  movements,
  chantierName,
  filename,
  language,
}: DownloadInventoryDocxOptions): void {
  const bytes = buildInventoryDocxBytes(products, movements, chantierName, new Date(), language);
  const blob = new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
