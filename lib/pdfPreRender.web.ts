import { getDocument } from '@/lib/pdfjs.web';
import { renderPlanAnnotationsToCanvas } from '@/lib/plan-annotations/canvas-renderer';
import {
  PlanAnnotationRasterizationError,
  renderPlanImageWithAnnotationsToDataUrl,
} from '@/lib/plan-annotations/image-rasterizer';
import { sanitizePlanDrawings } from '@/lib/plan-annotations/model';
import type { PlanDrawing } from '@/constants/types';

export async function preRenderPdfPageToDataUrlImpl(
  pdfUri: string,
  renderW: number,
  annotations: readonly PlanDrawing[] = [],
): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const hasAnnotations = sanitizePlanDrawings(annotations).length > 0;

  try {
    const srcArg = pdfUri.startsWith('data:')
      ? { data: atob(pdfUri.split(',')[1]) }
      : { url: pdfUri, withCredentials: false };
    const pdfDoc = await (getDocument(srcArg) as any).promise;
    const page = await pdfDoc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = renderW / vp1.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      if (hasAnnotations) throw new PlanAnnotationRasterizationError('Canvas is unavailable for annotated PDF export.');
      return null;
    }

    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    renderPlanAnnotationsToCanvas(ctx, canvas.width, canvas.height, annotations, 1);
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch (error) {
    if (hasAnnotations) {
      if (error instanceof PlanAnnotationRasterizationError) throw error;
      throw new PlanAnnotationRasterizationError(undefined, { cause: error });
    }
    return null;
  }
}

export async function preRenderPlanImageWithAnnotationsToDataUrlImpl(
  resolvedImageUri: string,
  renderW: number,
  annotations: readonly PlanDrawing[] = [],
): Promise<string | null> {
  return renderPlanImageWithAnnotationsToDataUrl(resolvedImageUri, renderW, annotations);
}
