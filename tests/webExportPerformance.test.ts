import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web export performance contracts', () => {
  it('inlines authorized remote images in bounded parallel batches', () => {
    const route = read('vercel-app/app/api/generate-pdf/route.ts');

    expect(route).toContain('const PDF_REMOTE_IMAGE_CONCURRENCY = 6');
    expect(route).toContain('Promise.all(batch.map');
    expect(route).toContain('PDF_REMOTE_IMAGE_PER_ITEM_MAX_BYTES');
  });

  it('reuses a healthy Chromium process while closing every report page', () => {
    const route = read('vercel-app/app/api/generate-pdf/route.ts');
    const renderer = route.slice(route.indexOf('let pdfBrowserPromise'), route.indexOf('async function resolveRecipientLanguage'));

    expect(renderer).toContain('browser?.isConnected?.()');
    expect(renderer).toContain('diagnostic.browserReused = true');
    expect(renderer).toContain('await page.close()');
    expect(renderer).not.toContain('await browser.close()');
    expect(renderer).toContain('Promise.all([browserPromise, htmlPromise])');
  });

  it('uses binary PDF transfer on web while retaining the base64 compatibility response', () => {
    const route = read('vercel-app/app/api/generate-pdf/route.ts');
    const page = read('vercel-app/app/web/page.tsx');
    const batching = read('vercel-app/lib/pdf-report-batching.ts');

    expect(route).toContain("startsWith('application/pdf')");
    expect(route).toContain("'X-BuildTrack-PDF-Transfer': 'binary'");
    expect(route).toContain("'X-BuildTrack-PDF-Transfer': 'base64'");
    expect(page).toContain("Accept: 'application/pdf, application/json'");
    expect(page).toContain("responseType.includes('application/pdf')");
    expect(page).toContain('return { blob: pdfBlob }');
    expect(batching).toContain('Le rapport a dépassé le délai de génération.');
  });

  it('caches plan rasterization and prepares independent plans concurrently', () => {
    const page = read('vercel-app/app/web/page.tsx');

    expect(page).toContain('const PDF_PLAN_RENDER_CONCURRENCY = 6');
    expect(page).toContain('const pdfPlanDataUrlCache');
    expect(page).toContain('mapWithConcurrency(planItems, PDF_PLAN_RENDER_CONCURRENCY');
    expect(page).toContain('getCachedPlanImageForReport(plan, uri, clientUri, 720)');
    expect(page).toContain('primePlanReportCacheFromPreview(selectedPlan, selectedPlanReportSource, preview.blob, 720)');
  });

  it('generates large reports in bounded parts and merges them into one download', () => {
    const page = read('vercel-app/app/web/page.tsx');

    expect(page).toContain('createWebPdfBatchPayloads(type, payload, language)');
    expect(page).toContain('WEB_PDF_BATCH_CONCURRENCY');
    expect(page).toContain("const { PDFDocument } = await import('pdf-lib')");
    expect(page).toContain('await merged.copyPages(source, source.getPageIndices())');
    expect(page).toContain('downloadBlobFile(finalBlob, filename)');
  });

  it('offers a lightweight CSV export with a local calendar date', () => {
    const workspace = read('vercel-app/app/web/inventory-workspace/InventoryWorkspace.tsx');

    expect(workspace).toContain("type ExportKind = 'csv' | 'xlsx' | 'docx' | 'pdf'");
    expect(workspace).toContain("await import('@/lib/inventory-csv')");
    expect(workspace).toContain('date: localDateStamp()');
    expect(workspace).toContain('<small>.csv</small>');
  });
});
