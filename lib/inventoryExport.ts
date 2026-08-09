import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type { InventoryMovement, InventoryProduct } from '@/constants/types';
import { escapeHtml, exportPDF, PDF_BASE_CSS, PDF_BRAND_COLOR } from '@/lib/pdfBase';
import { formatDateTimeFR } from '@/lib/utils';
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

function sumBy(movements: InventoryMovement[], key: (movement: InventoryMovement) => string): [string, number][] {
  const totals = new Map<string, number>();
  for (const movement of movements) {
    if (movement.movementType !== 'out') continue;
    const label = key(movement) || 'Non renseigné';
    totals.set(label, (totals.get(label) ?? 0) + movement.quantity);
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

async function shareXlsx(kind: InventoryExportKind, products: InventoryProduct[], movements: InventoryMovement[], chantierName: string, filename: string): Promise<void> {
  const workbook = buildInventoryWorkbook(kind, products, movements, chantierName);
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
    URL.revokeObjectURL(url);
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
): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  await shareXlsx(kind, products, movements, chantierName, `buildtrack-stock-${kind}-${safeFilename(chantierName)}-${date}.xlsx`);
}

function tableRows(rows: string[][]): string {
  if (!rows.length) return '<tr><td colspan="8">Aucune donnée</td></tr>';
  return rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
}

export async function exportInventoryPdf(
  products: InventoryProduct[],
  movements: InventoryMovement[],
  chantierName: string,
): Promise<void> {
  const lowStock = products.filter(product => product.minStock > 0 && product.currentStock <= product.minStock);
  const entries = movements.filter(movement => movement.movementType === 'in');
  const exits = movements.filter(movement => movement.movementType === 'out');
  const byBuilding = sumBy(movements, movement => movement.buildingName ?? '');
  const byCompany = sumBy(movements, movement => movement.companyName ?? '');
  const totalStock = products.reduce((sum, product) => sum + product.currentStock, 0);
  const generatedAt = formatDateTimeFR(new Date());
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><style>${PDF_BASE_CSS}
  .stock-low { color:#B91C1C; font-weight:700; }
  .brand-line { color:${PDF_BRAND_COLOR}; font-weight:700; }
</style></head><body><div class="container">
  <div class="letterhead">
    <div class="letterhead-logo"><div class="letterhead-logo-mark">BT</div><div><div class="letterhead-brand">BuildTrack</div><div class="letterhead-tagline">Gestion de stock chantier</div></div></div>
    <div class="letterhead-right"><div class="letterhead-doc-type">ÉTAT DU STOCK</div><div class="letterhead-doc-title">${escapeHtml(chantierName)}</div><div class="letterhead-ref">Généré le <strong>${escapeHtml(generatedAt)}</strong></div></div>
  </div>
  <div class="kpi-row">
    <div class="kpi-card"><div class="kpi-val">${products.length}</div><div class="kpi-label">RÉFÉRENCES</div></div>
    <div class="kpi-card"><div class="kpi-val">${totalStock}</div><div class="kpi-label">UNITÉS EN STOCK</div></div>
    <div class="kpi-card"><div class="kpi-val">${entries.length}</div><div class="kpi-label">ENTRÉES</div></div>
    <div class="kpi-card"><div class="kpi-val">${exits.length}</div><div class="kpi-label">SORTIES</div></div>
    <div class="kpi-card"><div class="kpi-val stock-low">${lowStock.length}</div><div class="kpi-label">À COMMANDER</div></div>
  </div>
  ${lowStock.length ? `<div class="alert alert-warning"><strong>Stock faible :</strong> ${lowStock.length} produit(s) à commander.</div>` : ''}
  <div class="section-header">État du stock</div>
  <table><thead><tr><th>Référence</th><th>Désignation</th><th>Stock</th><th>Mini.</th><th>Entrées</th><th>Sorties</th><th>Localisation</th></tr></thead><tbody>
    ${tableRows(products.map(product => [product.reference, product.designation, String(product.currentStock), String(product.minStock), String(product.totalEntries), String(product.totalExits), product.location ?? '']))}
  </tbody></table>
  <div class="section-header">Produits à commander</div>
  <table><thead><tr><th>Référence</th><th>Désignation</th><th>Stock</th><th>Minimum</th><th>Fournisseur</th></tr></thead><tbody>
    ${tableRows(lowStock.map(product => [product.reference, product.designation, String(product.currentStock), String(product.minStock), product.supplier ?? '']))}
  </tbody></table>
  <div class="section-header">Consommation par bâtiment</div>
  <table><thead><tr><th>Bâtiment / zone</th><th>Quantité sortie</th></tr></thead><tbody>${tableRows(byBuilding.map(([label, quantity]) => [label, String(quantity)]))}</tbody></table>
  <div class="section-header">Consommation par entreprise</div>
  <table><thead><tr><th>Entreprise</th><th>Quantité sortie</th></tr></thead><tbody>${tableRows(byCompany.map(([label, quantity]) => [label, String(quantity)]))}</tbody></table>
  <div class="section-header">Derniers mouvements</div>
  <table><thead><tr><th>Date</th><th>Type</th><th>Référence</th><th>Qté</th><th>Destination</th><th>Entreprise</th><th>Utilisateur</th></tr></thead><tbody>
    ${tableRows(movements.slice(0, 100).map(movement => [formatDateTimeFR(movement.createdAt), movement.movementType === 'in' ? 'Entrée' : 'Sortie', movement.reference, String(movement.quantity), movement.buildingName ?? movement.supplier ?? '', movement.companyName ?? '', movement.userName]))}
  </tbody></table>
</div></body></html>`;
  const date = new Date().toISOString().slice(0, 10);
  await exportPDF(html, `buildtrack-stock-${safeFilename(chantierName)}-${date}.pdf`);
}
