import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function source(path: string) {
  return readFileSync(resolve(root, path), 'utf8');
}

describe('annotated plan report exports', () => {
  it('composites canonical annotations after PDF.js renders the Expo web page', () => {
    const preRenderer = source('lib/pdfPreRender.web.ts');
    const publicApi = source('lib/pdfBase.ts');

    expect(preRenderer).toContain("from '@/lib/plan-annotations/canvas-renderer'");
    expect(preRenderer).toContain("from '@/lib/plan-annotations/image-rasterizer'");
    expect(preRenderer).toContain('await page.render({ canvasContext: ctx, viewport: vp }).promise;');
    expect(preRenderer).toContain('renderPlanAnnotationsToCanvas(ctx, canvas.width, canvas.height, annotations, 1);');
    expect(preRenderer).toContain('throw new PlanAnnotationRasterizationError');
    expect(publicApi).toContain('preRenderPdfPageToDataUrlImpl(pdfUri, renderW, annotations)');
    expect(publicApi).toContain('preRenderPlanImageWithAnnotationsToDataUrlImpl(resolvedImageUri, renderW, annotations)');
  });

  it('passes plan annotations through per-plan, global and reserve Expo web reports', () => {
    const plans = source('app/(tabs)/plans.tsx');
    const reserve = source('app/reserve/[id].tsx');

    expect(plans).toContain('preRenderPdfPageToDataUrl(exportUri, RENDER_W, planAnnotations ?? [])');
    expect(plans).toContain('preRenderPdfPageToDataUrl(pdfDataUrl, 720, plan.annotations ?? [])');
    expect(plans).toContain('preRenderPlanImageWithAnnotationsToDataUrl(dataUrl, 720, plan.annotations ?? [])');
    expect(plans).toContain('currentPlan?.annotations ?? [],');
    expect(plans).toContain('if ((plan.annotations?.length ?? 0) > 0) throw error;');
    expect(plans).toContain('requireAnnotatedPlanCapture(preRenderedPdfDataUrl, planAnnotations ?? [])');
    expect(plans).toContain('requireAnnotatedPlanCapture(dataUrl, plan.annotations ?? [])');
    expect(reserve).toContain('matchedPlan.annotations ?? [],');
    expect(reserve).toContain('preRenderPlanImageWithAnnotationsToDataUrl(');
    expect(reserve).toContain('requireAnnotatedPlanCapture(captured, matchedPlan.annotations ?? [])');
  });

  it('composites plan annotations into both Next.js report rasterizers', () => {
    const page = source('vercel-app/app/web/page.tsx');

    expect(page).toContain("from '../../../lib/plan-annotations/canvas-renderer'");
    expect(page).toContain("from '../../../lib/plan-annotations/image-rasterizer'");
    expect(page).toContain('preRenderPdfPageToDataUrl(clientUri, 720, plan?.annotations)');
    expect(page).toContain('renderPlanImageWithAnnotationsToDataUrl(embeddedImage, 720, plan.annotations)');
    expect(page).toContain('renderPlanAnnotationsToCanvas(context, canvas.width, canvas.height, annotations, 1);');
  });
});
