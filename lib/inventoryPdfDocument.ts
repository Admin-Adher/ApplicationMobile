import { inventoryDocumentCopy, type InventoryDocumentLanguage } from './inventoryDocumentCopy';
import type { InventoryWorkbookMovement, InventoryWorkbookProduct } from './inventoryWorkbookEngine';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function rows(cells: string[][], empty: string, columns: number): string {
  if (!cells.length) return `<tr><td colspan="${columns}" class="empty">${escapeHtml(empty)}</td></tr>`;
  return cells.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
}

function headers(labels: string[]): string {
  return `<tr>${labels.map(label => `<th>${escapeHtml(label)}</th>`).join('')}</tr>`;
}

function totalsBy(
  movements: InventoryWorkbookMovement[],
  key: (movement: InventoryWorkbookMovement) => string,
  fallback: string,
): Array<[string, number]> {
  const totals = new Map<string, number>();
  movements.forEach(movement => {
    if (movement.movementType !== 'out') return;
    const label = key(movement).trim() || fallback;
    totals.set(label, (totals.get(label) ?? 0) + Number(movement.quantity || 0));
  });
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

function formatDate(value: Date | string | number, locale: string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? '') : date.toLocaleString(locale);
}

export function buildInventoryPdfHtml(
  products: InventoryWorkbookProduct[],
  movements: InventoryWorkbookMovement[],
  chantierName: string,
  language: InventoryDocumentLanguage,
  generatedAt = new Date(),
): string {
  const copy = inventoryDocumentCopy(language);
  const lowStock = products.filter(product => product.minStock > 0 && product.currentStock <= product.minStock);
  const entries = movements.filter(movement => movement.movementType === 'in');
  const exits = movements.filter(movement => movement.movementType === 'out');
  const entryQuantity = entries.reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  const exitQuantity = exits.reduce((sum, movement) => sum + Number(movement.quantity || 0), 0);
  const byBuilding = totalsBy(movements, movement => [movement.buildingName, movement.zoneName].filter(Boolean).join(' / '), copy.notProvided);
  const byCompany = totalsBy(movements, movement => movement.companyName ?? '', copy.notProvided);
  const totalStock = products.reduce((sum, product) => sum + Number(product.currentStock || 0), 0);
  const generated = generatedAt.toLocaleString(copy.locale);

  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.pdf.documentType)} — ${escapeHtml(chantierName)}</title><style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #17243a; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 9px; line-height: 1.42; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .container { width: 100%; }
    .letterhead { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; padding-bottom: 12px; border-bottom: 3px solid #0f3b75; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .mark { width: 38px; height: 38px; display: grid; place-items: center; color: #fff; background: #0f3b75; border-radius: 8px; font-size: 14px; font-weight: 800; }
    .brand strong { display: block; color: #0f3b75; font-size: 18px; line-height: 1; }
    .brand span, .meta { color: #64748b; }
    .doc { max-width: 58%; text-align: right; }
    .doc small { color: #0f3b75; font-weight: 800; letter-spacing: .12em; }
    .doc h1 { margin: 4px 0; font-size: 19px; line-height: 1.12; }
    .kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 14px 0; }
    .kpi { padding: 9px 10px; border: 1px solid #d8e1ec; border-radius: 7px; background: #f7f9fc; }
    .kpi b { display: block; color: #0f3b75; font-size: 18px; }
    .kpi span { color: #64748b; font-size: 8px; font-weight: 700; letter-spacing: .05em; }
    .kpi.alert b { color: #b42318; }
    .alert-box { margin: 0 0 12px; padding: 8px 10px; color: #9a5b00; background: #fff4d6; border: 1px solid #f4c95d; border-radius: 6px; }
    h2 { margin: 16px 0 6px; padding: 6px 8px; color: #0f3b75; background: #eaf1f8; border-left: 4px solid #0f3b75; font-size: 11px; }
    h2 { break-after: avoid-page; page-break-after: avoid; }
    table { width: 100%; border-collapse: collapse; table-layout: auto; page-break-inside: auto; }
    tr { page-break-inside: avoid; }
    th { padding: 6px; color: #fff; background: #0f3b75; border: 1px solid #0f3b75; text-align: left; font-size: 8px; }
    td { padding: 5px 6px; border: 1px solid #d8e1ec; vertical-align: top; }
    tbody tr:nth-child(even) { background: #f7f9fc; }
    .empty { padding: 14px; color: #64748b; text-align: center; font-style: italic; }
    .footer { margin-top: 14px; padding-top: 8px; display: flex; justify-content: space-between; color: #94a3b8; border-top: 1px solid #d8e1ec; }
    @media screen and (max-width: 720px) { .kpis { grid-template-columns: repeat(2, 1fr); } .doc { max-width: 50%; } }
  </style></head><body><main class="container">
    <header class="letterhead"><div class="brand"><div class="mark">BT</div><div><strong>BuildTrack</strong><span>${escapeHtml(copy.pdf.tagline)}</span></div></div><div class="doc"><small>${escapeHtml(copy.pdf.documentType)}</small><h1>${escapeHtml(chantierName)}</h1><div class="meta">${escapeHtml(copy.pdf.generatedOn)} <b>${escapeHtml(generated)}</b></div></div></header>
    <section class="kpis"><div class="kpi"><b>${products.length}</b><span>${escapeHtml(copy.pdf.kpiReferences)}</span></div><div class="kpi"><b>${totalStock}</b><span>${escapeHtml(copy.pdf.kpiUnits)}</span></div><div class="kpi"><b>${entryQuantity}</b><span>${escapeHtml(copy.pdf.kpiEntries)}</span></div><div class="kpi"><b>${exitQuantity}</b><span>${escapeHtml(copy.pdf.kpiExits)}</span></div><div class="kpi alert"><b>${lowStock.length}</b><span>${escapeHtml(copy.pdf.kpiReorder)}</span></div></section>
    ${lowStock.length ? `<div class="alert-box"><b>${escapeHtml(copy.pdf.lowStock(lowStock.length))}</b></div>` : ''}
    <h2>${escapeHtml(copy.pdf.stockSection)}</h2><table><thead>${headers(copy.pdf.stockHeaders)}</thead><tbody>${rows(products.map(product => [product.reference, product.designation, String(product.currentStock), String(product.minStock), String(product.totalEntries), String(product.totalExits), product.location ?? '']), copy.noData, copy.pdf.stockHeaders.length)}</tbody></table>
    <h2>${escapeHtml(copy.pdf.reorderSection)}</h2><table><thead>${headers(copy.pdf.reorderHeaders)}</thead><tbody>${rows(lowStock.map(product => [product.reference, product.designation, String(product.currentStock), String(product.minStock), product.supplier ?? '']), copy.noData, copy.pdf.reorderHeaders.length)}</tbody></table>
    <h2>${escapeHtml(copy.pdf.buildingSection)}</h2><table><thead>${headers(copy.pdf.buildingHeaders)}</thead><tbody>${rows(byBuilding.map(([label, quantity]) => [label, String(quantity)]), copy.noData, copy.pdf.buildingHeaders.length)}</tbody></table>
    <h2>${escapeHtml(copy.pdf.companySection)}</h2><table><thead>${headers(copy.pdf.companyHeaders)}</thead><tbody>${rows(byCompany.map(([label, quantity]) => [label, String(quantity)]), copy.noData, copy.pdf.companyHeaders.length)}</tbody></table>
    <section ${movements.length ? 'style="break-before:page;page-break-before:always"' : ''}><h2>${escapeHtml(copy.pdf.movementsSection)}</h2><table><thead>${headers(copy.pdf.movementHeaders)}</thead><tbody>${rows(movements.slice(0, 100).map(movement => [formatDate(movement.createdAt, copy.locale), movement.movementType === 'in' ? copy.movement.in : copy.movement.out, movement.reference, String(movement.quantity), movement.buildingName ?? movement.supplier ?? '', movement.companyName ?? '', movement.userName ?? '']), copy.noData, copy.pdf.movementHeaders.length)}</tbody></table></section>
    <footer class="footer"><span>BuildTrack · ${escapeHtml(copy.pdf.tagline)}</span><span>${escapeHtml(language.toUpperCase())}</span></footer>
  </main></body></html>`;
}
