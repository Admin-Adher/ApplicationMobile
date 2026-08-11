import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { InventoryMovement, InventoryProduct } from '@/constants/types';
import { exportPDF } from '@/lib/pdfBase';
import { buildInventoryPdfHtml } from '@/lib/inventoryPdfDocument';
import { inventoryDocumentCopy } from '@/lib/inventoryDocumentCopy';
import type { ExportLanguage } from '@/lib/exportLanguage';
import {
  buildInventoryWorkbook,
  inventoryWorkbookToArrayBuffer,
  inventoryWorkbookToBase64,
  type InventoryExportKind,
} from '@/lib/inventoryWorkbook';

export type { InventoryExportKind } from '@/lib/inventoryWorkbook';

function safeFilename(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
}

async function shareXlsx(kind: InventoryExportKind, products: InventoryProduct[], movements: InventoryMovement[], chantierName: string, filename: string, language: ExportLanguage): Promise<void> {
  const workbook = buildInventoryWorkbook(kind, products, movements, chantierName, new Date(), language);
  if (Platform.OS === 'web') {
    const blob = new Blob([inventoryWorkbookToArrayBuffer(workbook)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return;
  }
  const baseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!baseDir) throw new Error('Répertoire d’export indisponible.');
  const uri = `${baseDir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, inventoryWorkbookToBase64(workbook), { encoding: FileSystem.EncodingType.Base64 });
  if (!(await Sharing.isAvailableAsync())) throw new Error('Partage de fichier indisponible sur cet appareil.');
  await Sharing.shareAsync(uri, {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dialogTitle: filename,
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
  });
}

export async function exportInventoryXlsx(
  kind: InventoryExportKind,
  products: InventoryProduct[],
  movements: InventoryMovement[],
  chantierName: string,
  language: ExportLanguage,
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const copy = inventoryDocumentCopy(language);
  const type = kind === 'history' ? copy.filename.movements : `${copy.filename.stock}-${kind}`;
  await shareXlsx(kind, products, movements, chantierName, `buildtrack-${type}-${safeFilename(chantierName)}-${language}-${date}.xlsx`, language);
}

export async function exportInventoryPdf(
  products: InventoryProduct[],
  movements: InventoryMovement[],
  chantierName: string,
  language: ExportLanguage,
): Promise<void> {
  const copy = inventoryDocumentCopy(language);
  const html = buildInventoryPdfHtml(products, movements, chantierName, language);
  const date = new Date().toISOString().slice(0, 10);
  await exportPDF(html, `buildtrack-${copy.filename.stock}-${safeFilename(chantierName)}-${language}-${date}.pdf`);
}
